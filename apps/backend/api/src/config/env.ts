import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, and then treated as trusted.
 *
 * The alternative — reading `process.env.X` at the call site — means a missing
 * Cloudinary secret surfaces as a 500 on someone's first avatar upload rather
 * than as a refusal to start. Fail loudly, early, on the machine doing the
 * deploying.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_VERSION: z.string().default('v1'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z
      .string()
      .optional()
      // .env files can't hold real newlines, so the key arrives with literal
      // backslash-n. Restore them or the PEM parser rejects the key outright.
      .transform((v) => v?.replace(/\\n/g, '\n')),

    FIRESTORE_EMULATOR_HOST: z.string().optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_UPLOAD_FOLDER: z.string().default('internlink'),
    /**
     * An *unsigned* preset. Needs no API secret, so uploads keep working in
     * environments that hold no Cloudinary credentials at all — which is what
     * the whole feed-media path depends on.
     */
    CLOUDINARY_UPLOAD_PRESET: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().default('InternLink <noreply@internlink.app>'),

    /**
     * Where the web app lives. Used to build absolute share links and to bounce
     * a share-page visitor into the app, so it must be the canonical public
     * origin, not the API's own.
     */
    WEB_APP_ORIGIN: z.string().url().default('https://intern-project-38829.web.app'),

    /**
     * The PUBLIC half of the Web Push VAPID pair (Firebase console → Project
     * settings → Cloud Messaging → Web Push certificates). Public by design —
     * it ships to browsers. The private half stays inside Firebase; the Admin
     * SDK signs with the service account, so there is no private key here.
     */
    FIREBASE_VAPID_KEY: z.string().optional(),

    /**
     * Shared secret for the scheduled-job endpoints. Without it those routes
     * refuse every call — an unauthenticated "notify everyone" endpoint is a
     * spam cannon pointed at your own users.
     */
    CRON_SECRET: z.string().optional(),

    NEW_ACCOUNT_RESTRICTION_HOURS: z.coerce.number().int().min(0).default(24),
    MAX_CONNECTION_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(40),
    MAX_COLD_MESSAGES_PER_DAY: z.coerce.number().int().positive().default(15),
  })
  .superRefine((env, ctx) => {
    // Credentials are optional in development so a fresh clone boots and serves
    // /health without anyone hunting for a service-account file. In production
    // their absence is a hard failure.
    if (env.NODE_ENV !== 'production') return;

    const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const;
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        });
      }
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console -- the logger itself depends on env.
  console.error(`\nInvalid environment configuration:\n${detail}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';

/** True when we have enough to talk to Firebase (or an emulator). */
export const hasFirebaseCredentials = Boolean(
  env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY,
);

export const hasCloudinaryCredentials = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);

/** Enough to upload from the browser without the API signing anything. */
export const hasCloudinaryUnsigned = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_UPLOAD_PRESET,
);

export const hasAnyCloudinary = hasCloudinaryCredentials || hasCloudinaryUnsigned;

export const hasResendCredentials = Boolean(env.RESEND_API_KEY);

/** Web push needs the public VAPID key to reach the browser. */
export const hasPushCredentials = Boolean(env.FIREBASE_VAPID_KEY);
