const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

initializeApp();
const db = getFirestore();
const functionRegion = 'europe-west1';
const activeDeadlineStatuses = new Set(['pending', 'awaiting_payment', 'needs_correction']);
const accountUidOf = (record) => typeof record?.accountUid === 'string' && record.accountUid
  ? record.accountUid
  : String(record?.createdByUid || '');

function expiryReason(kind) {
  if (kind === 'initial_review') return 'باشگاه در مهلت ۳۰ دقیقه‌ای تأیید اولیه نکرد.';
  if (kind === 'correction') return 'مهلت ۱۵ دقیقه‌ای اصلاح پرداخت تمام شد.';
  return 'مهلت ۱۵ دقیقه‌ای پرداخت تمام شد.';
}

exports.expireBookingHolds = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Asia/Tehran',
  region: functionRegion,
  maxInstances: 1,
  timeoutSeconds: 300,
}, async () => {
  const now = Timestamp.now();
  const dueBookings = await db.collectionGroup('bookings')
    .where('phaseDeadlineAt', '<=', now)
    .limit(250)
    .get();
  let expiredCount = 0;

  for (const bookingSnapshot of dueBookings.docs) {
    const bookingRef = bookingSnapshot.ref;
    const clubRef = bookingRef.parent.parent;
    if (!clubRef || clubRef.parent.id !== 'clubs') continue;
    const bookingId = bookingSnapshot.id;
    const clubId = clubRef.id;
    const didExpire = await db.runTransaction(async (transaction) => {
      const [freshSnapshot, clubSnapshot] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(clubRef),
      ]);
      if (!freshSnapshot.exists || !clubSnapshot.exists) return false;
      const booking = freshSnapshot.data();
      if (!activeDeadlineStatuses.has(booking.status)
        || !(booking.phaseDeadlineAt instanceof Timestamp)
        || booking.phaseDeadlineAt.toMillis() > Date.now()) return false;

      const balanceUid = accountUidOf(booking);
      const balanceLockRef = balanceUid ? clubRef.collection('accountBalanceLocks').doc(balanceUid) : null;
      if (balanceLockRef) await transaction.get(balanceLockRef);
      const ownerUid = String(clubSnapshot.data().createdByUid || '');
      const reason = expiryReason(booking.phaseDeadlineKind);
      transaction.update(bookingRef, {
        status: 'expired',
        expiredAt: FieldValue.serverTimestamp(),
        expiryReason: reason,
        balanceHoldToman: 0,
        phaseDeadlineAt: null,
        phaseDeadlineKind: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(clubRef.collection('publicSchedule').doc(bookingId));
      for (const lockId of Array.isArray(booking.lockIds) ? booking.lockIds : []) {
        transaction.delete(clubRef.collection('slotLocks').doc(String(lockId)));
      }

      const notificationCollection = clubRef.collection('notifications');
      const recipients = new Set([balanceUid, ownerUid].filter(Boolean));
      for (const recipientUid of recipients) {
        const notificationRef = notificationCollection.doc();
        transaction.set(notificationRef, {
          id: notificationRef.id,
          recipientUid,
          bookingId,
          type: 'booking_expired',
          title: 'مهلت رزرو تمام شد',
          body: `${booking.courtName} · ${booking.startTime} تا ${booking.endTime} · ${reason} سانس آزاد شد.`,
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });
      }
      if (balanceLockRef) {
        transaction.set(balanceLockRef, { uid: balanceUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      logger.info(`Expired booking ${clubId}/${bookingId}.`);
      return true;
    });
    if (didExpire) expiredCount += 1;
  }

  if (expiredCount) logger.info(`Expired ${expiredCount} overdue booking hold(s).`);
});

exports.reserveRecurringBookings = onCall({
  region: functionRegion,
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'برای ثبت رزرو وارد شو.');
  const uid = request.auth.uid;
  const clubId = typeof request.data?.clubId === 'string' ? request.data.clubId : '';
  const courtId = typeof request.data?.courtId === 'string' ? request.data.courtId : '';
  const startTime = typeof request.data?.startTime === 'string' ? request.data.startTime : '';
  const endTime = typeof request.data?.endTime === 'string' ? request.data.endTime : '';
  const sport = request.data?.sport;
  const bookedForName = typeof request.data?.bookedForName === 'string' ? request.data.bookedForName.trim() : '';
  const note = typeof request.data?.note === 'string' ? request.data.note.trim() : '';
  const priceToman = request.data?.priceToman;
  const requestedAccountUid = request.data?.accountUid;
  const dates = request.data?.dates;
  const validSlots = new Set([
    '00:00|01:30', '01:30|03:00', '03:00|04:30', '04:30|06:00',
    '06:00|07:30', '07:30|09:00', '09:00|10:30', '10:30|12:00',
    '12:00|13:30', '13:30|15:00', '15:00|16:30', '16:30|18:00',
    '18:00|19:30', '19:30|21:00', '21:00|22:30', '22:30|24:00',
  ]);
  const isISODate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };

  if (!clubId || clubId.length > 150 || clubId.includes('/')) throw new HttpsError('invalid-argument', 'شناسهٔ باشگاه معتبر نیست.');
  if (!courtId || courtId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(courtId)) throw new HttpsError('invalid-argument', 'شناسهٔ زمین معتبر نیست.');
  if (!validSlots.has(`${startTime}|${endTime}`)) throw new HttpsError('invalid-argument', 'بازهٔ سانس معتبر نیست.');
  if (!['volleyball', 'futsal', 'other'].includes(sport)) throw new HttpsError('invalid-argument', 'نوع ورزش معتبر نیست.');
  if (!bookedForName || bookedForName.length > 100) throw new HttpsError('invalid-argument', 'نام رزروکننده را تا ۱۰۰ نویسه وارد کن.');
  if (!Number.isInteger(priceToman) || priceToman < 0 || priceToman > 1000000000) throw new HttpsError('invalid-argument', 'مبلغ رزرو معتبر نیست.');
  if (note.length > 1000) throw new HttpsError('invalid-argument', 'یادداشت حداکثر ۱۰۰۰ نویسه باشد.');
  if (requestedAccountUid !== undefined && requestedAccountUid !== null
    && (typeof requestedAccountUid !== 'string' || !requestedAccountUid || requestedAccountUid.length > 150 || requestedAccountUid.includes('/'))) {
    throw new HttpsError('invalid-argument', 'حساب بازیکن انتخاب‌شده معتبر نیست.');
  }
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 100
    || dates.some((date) => !isISODate(date))
    || new Set(dates).size !== dates.length
    || dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
    throw new HttpsError('invalid-argument', 'تاریخ‌های تکرار معتبر نیستند.');
  }

  const accountUid = typeof requestedAccountUid === 'string' ? requestedAccountUid : uid;
  const createdByEmail = typeof request.auth.token.email === 'string' ? request.auth.token.email.slice(0, 254) : '';
  const clubRef = db.collection('clubs').doc(clubId);
  const ownerMemberRef = clubRef.collection('members').doc(uid);
  const accountMemberRef = clubRef.collection('members').doc(accountUid);

  return db.runTransaction(async (transaction) => {
    const [clubSnapshot, ownerMemberSnapshot, accountMemberSnapshot] = await Promise.all([
      transaction.get(clubRef),
      transaction.get(ownerMemberRef),
      accountUid === uid ? Promise.resolve(null) : transaction.get(accountMemberRef),
    ]);
    if (!clubSnapshot.exists) throw new HttpsError('not-found', 'باشگاه پیدا نشد.');
    const club = clubSnapshot.data();
    const ownerMember = ownerMemberSnapshot.exists ? ownerMemberSnapshot.data() : null;
    if (club.createdByUid !== uid || !ownerMember || ownerMember.uid !== uid || ownerMember.active !== true || ownerMember.role !== 'owner') {
      throw new HttpsError('permission-denied', 'فقط صاحب فعال باشگاه می‌تواند رزرو تکرارشونده ثبت کند.');
    }
    if (accountUid !== uid) {
      const accountMember = accountMemberSnapshot?.exists ? accountMemberSnapshot.data() : null;
      if (!accountMember || accountMember.uid !== accountUid || accountMember.active !== true || accountMember.role !== 'player') {
        throw new HttpsError('failed-precondition', 'حساب انتخاب‌شده عضو فعال بازیکن در این باشگاه نیست.');
      }
    }

    const court = Array.isArray(club.courts)
      ? club.courts.find((item) => item && item.id === courtId && typeof item.name === 'string')
      : null;
    if (!court || !court.name.trim() || court.name.length > 100) {
      throw new HttpsError('failed-precondition', 'زمین انتخاب‌شده دیگر فعال نیست.');
    }
    if (priceToman !== Number(club.defaultSessionPriceToman ?? 0)) {
      throw new HttpsError('failed-precondition', 'نرخ سانس با نرخ فعلی باشگاه هماهنگ نیست؛ صفحه را تازه کن و دوباره تلاش کن.');
    }

    const bookingsCollection = clubRef.collection('bookings');
    const scheduleCollection = clubRef.collection('publicSchedule');
    const sessionsCollection = clubRef.collection('sessions');
    const locksCollection = clubRef.collection('slotLocks');
    const slotRefs = dates.map((date) => locksCollection.doc(`${courtId}_${date}_${startTime}`));
    const slotSnapshots = await Promise.all(slotRefs.map((ref) => transaction.get(ref)));
    const conflictDates = [];
    const createdDates = [];

    dates.forEach((date, index) => {
      if (slotSnapshots[index].exists) {
        conflictDates.push(date);
        return;
      }
      const lockId = `${courtId}_${date}_${startTime}`;
      const bookingRef = bookingsCollection.doc();
      const publicRef = scheduleCollection.doc(bookingRef.id);
      const sessionRef = sessionsCollection.doc();
      transaction.create(slotRefs[index], {
        bookingId: bookingRef.id,
        courtId,
        date,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(bookingRef, {
        date,
        startTime,
        endTime,
        courtId,
        courtName: court.name,
        sport,
        bookedForName,
        priceToman,
        note,
        status: 'booked',
        lockIds: [lockId],
        accountUid,
        accountBalanceAppliedToman: 0,
        balanceHoldToman: 0,
        paymentReportedAmountToman: 0,
        paymentLedgerId: null,
        sessionRecordId: sessionRef.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdByUid: uid,
        createdByEmail,
      });
      transaction.create(publicRef, {
        date,
        startTime,
        endTime,
        courtId,
        courtName: court.name,
        status: 'booked',
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(sessionRef, {
        bookingId: bookingRef.id,
        date,
        priceToman,
        status: 'scheduled',
        note: `رزرو قطعی · ${court.name} · ${startTime} تا ${endTime}`,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: uid,
        accountUid,
        createdByEmail,
      });
      createdDates.push(date);
    });

    return { createdCount: createdDates.length, createdDates, conflictDates };
  });
});

exports.applyBookingBalance = onCall({ region: functionRegion }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'برای استفاده از ماندهٔ حساب وارد شو.');
  const bookingId = typeof request.data?.bookingId === 'string' ? request.data.bookingId : '';
  const clubId = typeof request.data?.clubId === 'string' ? request.data.clubId : '';
  if (!bookingId || bookingId.length > 150) throw new HttpsError('invalid-argument', 'شناسهٔ رزرو معتبر نیست.');
  if (!clubId || clubId.length > 150 || clubId.includes('/')) throw new HttpsError('invalid-argument', 'شناسهٔ باشگاه معتبر نیست.');

  const uid = request.auth.uid;
  const clubRef = db.collection('clubs').doc(clubId);
  const bookingRef = clubRef.collection('bookings').doc(bookingId);
  const memberRef = clubRef.collection('members').doc(uid);
  const balanceLockRef = clubRef.collection('accountBalanceLocks').doc(uid);
  const paymentsCollection = clubRef.collection('payments');
  const sessionsCollection = clubRef.collection('sessions');
  const bookingsCollection = clubRef.collection('bookings');
  const ownOrLegacyQueries = (collection) => [
    collection.where('accountUid', '==', uid),
    collection.where('createdByUid', '==', uid),
  ];

  return db.runTransaction(async (transaction) => {
    const [lockSnapshot, bookingSnapshot, clubSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(balanceLockRef),
      transaction.get(bookingRef),
      transaction.get(clubRef),
      transaction.get(memberRef),
    ]);
    if (!bookingSnapshot.exists) throw new HttpsError('not-found', 'رزرو پیدا نشد.');
    if (!clubSnapshot.exists) throw new HttpsError('failed-precondition', 'تنظیمات باشگاه پیدا نشد.');
    if (!memberSnapshot.exists || memberSnapshot.data().uid !== uid || memberSnapshot.data().active !== true || memberSnapshot.data().role !== 'player') {
      throw new HttpsError('permission-denied', 'فقط عضو فعالِ بازیکن می‌تواند از ماندهٔ حساب استفاده کند.');
    }

    const booking = bookingSnapshot.data();
    const ownerUid = String(clubSnapshot.data().createdByUid || '');
    if (accountUidOf(booking) !== uid || !ownerUid || ownerUid === uid) {
      throw new HttpsError('permission-denied', 'فقط بازیکنِ صاحب این رزرو می‌تواند از ماندهٔ حساب استفاده کند.');
    }
    if (!['awaiting_payment', 'needs_correction'].includes(booking.status)) {
      throw new HttpsError('failed-precondition', 'رزرو در مرحلهٔ استفاده از ماندهٔ حساب نیست.');
    }
    if (!(booking.phaseDeadlineAt instanceof Timestamp) || booking.phaseDeadlineAt.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', 'مهلت پرداخت یا اصلاح تمام شده است.');
    }

    const paymentQueries = ownOrLegacyQueries(paymentsCollection);
    const sessionQueries = ownOrLegacyQueries(sessionsCollection);
    const bookingQueries = ownOrLegacyQueries(bookingsCollection);
    const querySnapshots = await Promise.all([
      ...paymentQueries.map((query) => transaction.get(query)),
      ...sessionQueries.map((query) => transaction.get(query)),
      ...bookingQueries.map((query) => transaction.get(query)),
    ]);
    const mergeDocs = (snapshots) => {
      const docs = new Map();
      snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
        const record = item.data();
        if (accountUidOf(record) === uid) docs.set(item.ref.path, item);
      }));
      return [...docs.values()];
    };
    const [payments, sessions, userBookings] = [
      mergeDocs(querySnapshots.slice(0, 2)),
      mergeDocs(querySnapshots.slice(2, 4)),
      mergeDocs(querySnapshots.slice(4, 6)),
    ];
    const confirmedPayments = payments.reduce((sum, item) =>
      sum + (item.data().status === 'confirmed' ? Number(item.data().amountToman || 0) : 0), 0);
    const chargeableSessions = sessions.reduce((sum, item) =>
      sum + (['attended', 'late_cancel', 'no_show'].includes(item.data().status) ? Number(item.data().priceToman || 0) : 0), 0);
    const currentHolds = userBookings.reduce((sum, item) => sum + Math.max(0, Number(item.data().balanceHoldToman || 0)), 0);
    const oldHold = Math.max(0, Number(booking.balanceHoldToman || 0));
    const currentApplied = Math.max(0, Number(booking.accountBalanceAppliedToman || 0));
    const price = Math.max(0, Number(booking.priceToman || 0));
    const remainingPrice = Math.max(0, price - currentApplied);
    const availableBeforeThisBooking = confirmedPayments - chargeableSessions - currentHolds + oldHold;
    const appliedNow = Math.min(remainingPrice, Math.max(0, availableBeforeThisBooking));
    if (price <= 0 || remainingPrice <= 0 || appliedNow <= 0) {
      throw new HttpsError('failed-precondition', 'اعتبار قابل‌استفاده‌ای برای این رزرو باقی نمانده است.');
    }

    const totalApplied = currentApplied + appliedNow;
    const newHold = oldHold + appliedNow;
    const remainingDue = Math.max(0, price - totalApplied);
    const fullyCovered = remainingDue === 0;
    const notificationCollection = clubRef.collection('notifications');
    const notificationRef = notificationCollection.doc();
    const slot = `${booking.courtName} · ${booking.date} · ${booking.startTime} تا ${booking.endTime}`;
    const notificationType = fullyCovered ? 'payment_reported' : 'booking_balance_applied';
    const notificationTitle = fullyCovered ? 'پرداخت از ماندهٔ حساب' : 'بخشی از مانده برای رزرو کنار گذاشته شد';
    const notificationBody = fullyCovered
      ? `${slot} · مبلغ ${totalApplied} تومان از اعتبار حساب استفاده شد؛ برای تأیید نهایی بررسی کن.`
      : `${slot} · ${appliedNow} تومان از اعتبار حساب استفاده شد؛ ${remainingDue} تومان باقی مانده تا بازیکن پرداخت و اعلام کند.`;

    transaction.update(bookingRef, {
      accountBalanceAppliedToman: totalApplied,
      balanceHoldToman: newHold,
      ...(fullyCovered ? {
        status: 'payment_submitted',
        paymentReportedAmountToman: 0,
        paymentReportedAt: FieldValue.serverTimestamp(),
        paymentNote: 'پرداخت کامل از اعتبار ماندهٔ حساب.',
        phaseDeadlineAt: null,
        phaseDeadlineKind: null,
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(balanceLockRef, {
      uid,
      updatedAt: FieldValue.serverTimestamp(),
      ...(lockSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.set(notificationRef, {
      id: notificationRef.id,
      recipientUid: ownerUid,
      bookingId,
      type: notificationType,
      title: notificationTitle,
      body: notificationBody,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    });

    return { appliedToman: appliedNow, totalAppliedToman: totalApplied, remainingToman: remainingDue, fullyCovered };
  });
});

exports.sendBookingPush = onDocumentCreated({
  document: 'clubs/{clubId}/notifications/{notificationId}',
  region: functionRegion,
}, async (event) => {
  const notification = event.data?.data();
  if (!notification?.recipientUid) return;
  const tokenCollection = db.collection('clubs').doc(event.params.clubId).collection('pushTokens');
  const tokenSnapshot = await tokenCollection.where('recipientUid', '==', notification.recipientUid).get();
  if (tokenSnapshot.empty) return;

  const registrations = tokenSnapshot.docs.filter((item) => typeof item.data().token === 'string' && item.data().token.length > 20);
  for (let offset = 0; offset < registrations.length; offset += 500) {
    const chunk = registrations.slice(offset, offset + 500);
    const response = await getMessaging().sendEachForMulticast({
      tokens: chunk.map((item) => item.data().token),
      data: {
        title: String(notification.title || 'به‌روزرسانی رزرو'),
        body: String(notification.body || 'وضعیت رزرو تغییر کرده است.'),
        bookingId: String(notification.bookingId || ''),
        notificationId: String(notification.id || event.params.notificationId),
      },
      webpush: { headers: { Urgency: 'high' } },
    });

    const cleanup = db.batch();
    let cleanupCount = 0;
    response.responses.forEach((result, index) => {
      const code = result.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        cleanup.delete(chunk[index].ref);
        cleanupCount += 1;
      }
    });
    if (cleanupCount) await cleanup.commit();
  }
});
