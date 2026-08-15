import type { Response } from 'express';
import type { ApiErrorCode, FieldErrors, Paginated } from '@internlink/shared-types';

/** Every successful body is `{ ok: true, data }` — see shared-types/api.ts. */
export function sendOk<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ ok: true, data });
}

export function sendCreated<T>(res: Response, data: T): Response {
  return sendOk(res, data, 201);
}

export function sendPage<T>(res: Response, page: Paginated<T>): Response {
  return sendOk(res, page);
}

export function sendError(
  res: Response,
  opts: {
    status: number;
    code: ApiErrorCode;
    message: string;
    fields?: FieldErrors;
    requestId?: string;
    retryAfterSeconds?: number;
  },
): Response {
  if (opts.retryAfterSeconds) res.setHeader('Retry-After', String(opts.retryAfterSeconds));
  return res.status(opts.status).json({
    ok: false,
    error: {
      code: opts.code,
      message: opts.message,
      ...(opts.fields ? { fields: opts.fields } : {}),
      ...(opts.requestId ? { requestId: opts.requestId } : {}),
      ...(opts.retryAfterSeconds ? { retryAfterSeconds: opts.retryAfterSeconds } : {}),
    },
  });
}
