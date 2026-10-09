import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

export interface FirebaseLocalSettings {
  firebase: FirebaseOptions;
  vapidKey?: string;
}

const SETTINGS_KEY = 'sansyar-firebase-settings-v1';

function readSavedSettings(): Partial<FirebaseLocalSettings> | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(SETTINGS_KEY);
    return value ? (JSON.parse(value) as Partial<FirebaseLocalSettings>) : null;
  } catch {
    return null;
  }
}

const savedSettings = readSavedSettings();
const env = import.meta.env;
const envFirebase: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
};
const envHasConfig = Boolean(
  envFirebase.apiKey && envFirebase.authDomain && envFirebase.projectId && envFirebase.appId,
);

export const firebaseConfig: FirebaseOptions | null = envHasConfig
  ? envFirebase
  : savedSettings?.firebase ?? null;

export const hasFirebaseConfig = Boolean(
  firebaseConfig?.apiKey && firebaseConfig?.authDomain && firebaseConfig?.projectId && firebaseConfig?.appId,
);
export const vapidKey = (env.VITE_FIREBASE_VAPID_KEY || savedSettings?.vapidKey || '').trim();

export const firebaseApp = hasFirebaseConfig
  ? (getApps().find((app) => app.name === 'sansyar') ?? initializeApp(firebaseConfig!, 'sansyar'))
  : null;

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const storage = firebaseApp && firebaseConfig?.storageBucket ? getStorage(firebaseApp) : null;
export const firebaseReady = Boolean(auth && db && hasFirebaseConfig);

export function saveFirebaseSettings(settings: FirebaseLocalSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getCurrentFirebaseSettings(): FirebaseLocalSettings {
  return {
    firebase: firebaseConfig ?? {},
    vapidKey,
  };
}
