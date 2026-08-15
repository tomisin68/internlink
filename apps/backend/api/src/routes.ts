import { Router } from 'express';
import type { HealthPayload } from '@internlink/shared-types';
import { asyncHandler } from './lib/async-handler.js';
import { sendOk } from './lib/respond.js';
import { env, hasCloudinaryCredentials, hasResendCredentials } from './config/env.js';
import { db, isFirebaseReady } from './config/firebase.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { profilesRouter } from './modules/profiles/profiles.routes.js';
import { listingsRouter } from './modules/listings/listings.routes.js';
import { applicationsRouter } from './modules/applications/applications.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { messagingRouter } from './modules/messaging/messaging.routes.js';
import { networkRouter } from './modules/connections/connections.routes.js';
import { feedRouter } from './modules/feed/feed.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { shareRouter } from './modules/share/share.routes.js';

const startedAt = Date.now();

export const apiRouter = Router();

/**
 * GET /health — deliberately unauthenticated and dependency-tolerant.
 *
 * It reports `degraded` rather than failing when an optional integration is
 * unconfigured, so a load balancer keeps a usable instance in rotation while
 * still surfacing that, say, Resend is missing.
 */
apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const checks: HealthPayload['checks'] = {
      firebase: 'skipped',
      cloudinary: hasCloudinaryCredentials ? 'ok' : 'skipped',
      resend: hasResendCredentials ? 'ok' : 'skipped',
    };

    if (isFirebaseReady()) {
      try {
        // Cheapest possible round trip that proves credentials and network.
        await db().collection('_health').limit(1).get();
        checks.firebase = 'ok';
      } catch {
        checks.firebase = 'fail';
      }
    }

    const payload: HealthPayload = {
      status: checks.firebase === 'fail' ? 'degraded' : 'ok',
      version: env.API_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks,
    };

    sendOk(res, payload);
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/profiles', profilesRouter);
apiRouter.use('/listings', listingsRouter);
apiRouter.use('/applications', applicationsRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/messages', messagingRouter);
apiRouter.use('/network', networkRouter);
apiRouter.use('/feed', feedRouter);
apiRouter.use('/notifications', notificationsRouter);
// Share pages are mounted at the API root as well (see app.ts) — a public,
// permanent link should not carry an API version in it. Kept here too so a
// versioned client can still reach them.
apiRouter.use('/share', shareRouter);
