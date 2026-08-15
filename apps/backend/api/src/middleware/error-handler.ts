import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { sendError } from '../lib/respond.js';
import { zodToFieldErrors } from './validate.js';
import { isProduction } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, {
    status: 404,
    code: 'not_found',
    message: `No route matches ${req.method} ${req.path}.`,
    requestId: req.requestId,
  });
}

/**
 * The single place an error becomes a response body.
 *
 * Two rules hold here without exception:
 *   1. Only AppError messages reach the client. Everything else becomes a
 *      generic 500, because an unexpected throw's message is as likely to
 *      contain a Firestore path or a stack frame as anything useful.
 *   2. Every 5xx is logged at error level with the request ID that the client
 *      also receives, so a support ticket resolves to one log line.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    const log = error.status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log(
      {
        requestId: req.requestId,
        code: error.code,
        status: error.status,
        path: req.path,
        method: req.method,
        accountId: req.auth?.accountId,
        internal: error.internal,
      },
      error.message,
    );

    sendError(res, {
      status: error.status,
      code: error.code,
      message: error.message,
      fields: error.fields,
      requestId: req.requestId,
      retryAfterSeconds: error.retryAfterSeconds,
    });
    return;
  }

  // A Zod error this deep means a *response* failed validation, or a schema was
  // parsed outside the validate() middleware. Either way it is our bug.
  if (error instanceof ZodError) {
    logger.error(
      { requestId: req.requestId, issues: error.issues, path: req.path },
      'Unhandled ZodError escaped a route handler',
    );
    sendError(res, {
      status: 500,
      code: 'internal_error',
      message: 'Something went wrong on our end. Try again.',
      fields: isProduction ? undefined : zodToFieldErrors(error),
      requestId: req.requestId,
    });
    return;
  }

  logger.error(
    {
      requestId: req.requestId,
      err: error,
      path: req.path,
      method: req.method,
      accountId: req.auth?.accountId,
    },
    'Unhandled error',
  );

  sendError(res, {
    status: 500,
    code: 'internal_error',
    message: 'Something went wrong on our end. Try again.',
    requestId: req.requestId,
  });
}
