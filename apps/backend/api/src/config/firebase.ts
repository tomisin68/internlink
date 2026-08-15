import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { env, hasFirebaseCredentials } from './env.js';
import { logger } from '../lib/logger.js';

let app: App | null = null;
let firestore: Firestore | null = null;
let auth: Auth | null = null;

/**
 * Firebase is initialised lazily rather than at import time.
 *
 * That keeps the module graph importable in tests and lets `/health` answer
 * even when credentials are missing — which is the state a fresh clone is in,
 * and the state you most want a diagnostic endpoint to survive.
 */
function ensureApp(): App {
  if (app) return app;

  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  // Running inside Cloud Functions / Cloud Run: the runtime provides a service
  // account automatically, and shipping an explicit key there would be strictly
  // worse — a credential to rotate, leak and forget about.
  // K_SERVICE is set by both runtimes; FUNCTION_TARGET by Functions specifically.
  if (isManagedRuntime()) {
    app = initializeApp({
      credential: applicationDefault(),
      projectId: env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT,
    });
    logger.info('Firebase Admin initialised with application-default credentials');
    return app;
  }

  if (!hasFirebaseCredentials) {
    throw new Error(
      'Firebase credentials are not configured. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in apps/backend/api/.env ' +
        '(see .env.example), or point at the emulators.',
    );
  }

  app = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID!,
      clientEmail: env.FIREBASE_CLIENT_EMAIL!,
      privateKey: env.FIREBASE_PRIVATE_KEY!,
    }),
    projectId: env.FIREBASE_PROJECT_ID!,
  });

  logger.info({ projectId: env.FIREBASE_PROJECT_ID }, 'Firebase Admin initialised');
  return app;
}

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(ensureApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export function firebaseAuth(): Auth {
  if (!auth) auth = getAuth(ensureApp());
  return auth;
}

/** True on Cloud Functions or Cloud Run, where credentials are ambient. */
export function isManagedRuntime(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
}

export function isFirebaseReady(): boolean {
  return hasFirebaseCredentials || isManagedRuntime() || Boolean(env.FIRESTORE_EMULATOR_HOST);
}

/** Collection names in one place so a typo is a compile error, not an empty query. */
export const Collections = {
  accounts: 'accounts',
  internProfiles: 'internProfiles',
  recruiterProfiles: 'recruiterProfiles',
  companies: 'companies',
  listings: 'listings',
  applications: 'applications',
  connections: 'connections',
  follows: 'follows',
  blocks: 'blocks',
  posts: 'posts',
  postReactions: 'postReactions',
  commentReactions: 'commentReactions',
  messageThreads: 'messageThreads',
  /** Subcollection name under a thread document. */
  messages: 'messages',
  /** Subcollection name under a post document. */
  comments: 'comments',
  notifications: 'notifications',
  moderationFlags: 'moderationFlags',
  adUnits: 'adUnits',
  adEvents: 'adEvents',
  rateLimits: 'rateLimits',
} as const;
