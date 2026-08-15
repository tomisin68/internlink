import pino from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: isProduction ? 'info' : 'debug',
  // Pretty output locally; structured JSON in production so the log shipper
  // can index it.
  transport: isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  base: { env: env.NODE_ENV },
  redact: {
    // §5.2 requires PII access to be logged, not the PII itself.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.idToken',
      'password',
      'idToken',
      'privateKey',
    ],
    censor: '[redacted]',
  },
});
