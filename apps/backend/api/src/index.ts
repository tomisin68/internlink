import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { hasFirebaseCredentials } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, version: env.API_VERSION },
    `InternLink API listening on http://localhost:${env.PORT}/${env.API_VERSION}`,
  );
  if (!hasFirebaseCredentials) {
    logger.warn(
      'Firebase credentials are not set — /health will report degraded and all ' +
        'authenticated routes will fail. Copy .env.example to .env to fix.',
    );
  }
});

/**
 * Graceful shutdown. Without this, a rolling deploy cuts in-flight requests
 * mid-write, which for a batched profile create means a company document with
 * no recruiter pointing at it.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  });
  // Don't hang forever on a stuck keep-alive connection.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
