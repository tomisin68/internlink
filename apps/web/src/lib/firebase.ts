import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  setPersistence,
  GoogleAuthProvider,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) {
    if (!isFirebaseConfigured) {
      throw new Error(
        'Firebase is not configured. Copy apps/web/.env.example to .env.local and fill in the VITE_FIREBASE_* values.',
      );
    }
    app = initializeApp(config);
  }
  return app;
}

export function auth(): Auth {
  if (!authInstance) authInstance = getAuth(firebaseApp());
  return authInstance;
}

/**
 * Firestore, used for READS ONLY.
 *
 * Every write goes through the API — SRS §2.1 is API-first and §5.2 requires
 * RBAC enforced server-side. The security rules deny all client writes
 * outright, so a direct `setDoc` from here fails by design rather than by
 * oversight.
 *
 * What the client does use it for is realtime: a thread that updates as the
 * other person types beats polling every eight seconds, and the read path is
 * safe to expose because rules scope it to documents the user may already see.
 */
export function db(): Firestore {
  if (!firestoreInstance) firestoreInstance = getFirestore(firebaseApp());
  return firestoreInstance;
}

/**
 * Analytics is initialised lazily and defensively.
 *
 * `getAnalytics` throws in environments without the APIs it needs — SSR,
 * some in-app browsers, and any context where cookies are blocked. `isSupported()`
 * is the documented guard; without it an analytics failure takes the whole app
 * down on exactly the devices least able to recover.
 */
let analyticsInstance: Analytics | null = null;

export async function initAnalytics(): Promise<Analytics | null> {
  if (analyticsInstance) return analyticsInstance;
  if (!isFirebaseConfigured || !config.measurementId) return null;

  try {
    if (!(await isSupported())) return null;
    analyticsInstance = getAnalytics(firebaseApp());
    return analyticsInstance;
  } catch {
    return null;
  }
}

/**
 * FR-105 — sessions persist per device.
 *
 * `local` survives a browser restart, which is what an installed PWA needs;
 * `session` is offered for shared machines via the "remember me" toggle. This
 * must be set *before* the sign-in call or Firebase uses the default.
 */
export async function applyPersistence(remember: boolean): Promise<void> {
  await setPersistence(auth(), remember ? browserLocalPersistence : browserSessionPersistence);
}

export const googleProvider = new GoogleAuthProvider();
// Always show the chooser. Silently reusing a signed-in Google account is
// disorienting on a shared device.
googleProvider.setCustomParameters({ prompt: 'select_account' });

/** Current user's ID token, refreshed when the role claim has just changed. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth().currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
