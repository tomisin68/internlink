import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
// Named import, not default: pino-http is CJS, and under NodeNext resolution
// the module namespace object itself is not callable.
import { pinoHttp } from 'pino-http';
import { env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { apiRouter } from './routes.js';

function allowedCorsOrigins(): Set<string> {
  const origins = new Set(env.CORS_ORIGINS);

  if (env.FIREBASE_PROJECT_ID) {
    origins.add(`https://${env.FIREBASE_PROJECT_ID}.web.app`);
    origins.add(`https://${env.FIREBASE_PROJECT_ID}.firebaseapp.com`);
  }

  return origins;
}

export function createApp(): Express {
  const app = express();
  const corsOrigins = allowedCorsOrigins();

  // Behind a load balancer (§5.3) req.ip must come from X-Forwarded-For, or
  // every rate limit keys on the balancer's address and throttles everyone at
  // once. `1` = trust exactly one proxy hop.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs on the web app, which has a
      // completely different set of sources to allow.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header = same-origin, curl, or a mobile app. Allow.
        if (!origin) return callback(null, true);
        if (corsOrigins.has(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      exposedHeaders: ['x-request-id', 'retry-after'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestContext);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? '',
      // Health checks would otherwise dominate the log volume.
      autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return isProduction ? 'info' : 'debug';
      },
    }),
  );

  app.use(globalLimiter);

  app.use(`/${env.API_VERSION}`, apiRouter);

  // Unversioned alias so uptime monitors don't need to know the API version.
  app.get('/health', (_req, res) => {
    res.redirect(307, `/${env.API_VERSION}/health`);
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
