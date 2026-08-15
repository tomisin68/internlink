import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises to the error handler on its own, so this
 * is belt-and-braces rather than strictly required. It stays because it makes
 * the async-ness of a handler visible at the route table, and because it keeps
 * behaviour identical if a route is ever mounted on an Express 4 sub-app.
 */
/**
 * Reads a route parameter as a string.
 *
 * Express 5's types widen `req.params` values to `string | string[]`, because a
 * pattern can bind repeated segments. None of our routes do, so this narrows
 * once here rather than casting at twenty call sites.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export const asyncHandler =
  <Req extends Request = Request>(
    fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
