import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ActiveRole, Role } from '@internlink/shared-types';

/** What `requireAuth` attaches to the request once a token checks out. */
export interface AuthContext {
  accountId: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
  activeRole: ActiveRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

/**
 * Stamps every request with an ID and echoes it back on the response.
 *
 * This is the thread that ties "the app said something went wrong" to the
 * single log line that explains why — the error handler puts the same ID in
 * the response body.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
