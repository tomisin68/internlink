import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../lib/errors.js';
import type { FieldErrors } from '@internlink/shared-types';

/**
 * Turns a ZodError into the `fields` map the client feeds straight into
 * react-hook-form's `setError`. Paths are dotted (`company.name`) so nested
 * wizard forms resolve to the right input without any client-side remapping.
 */
export function zodToFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_root';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

type Source = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* the request segment with the parsed result, so
 * downstream handlers get coerced, defaulted, trimmed values — not the raw
 * strings Express handed over.
 */
export function validate<S extends ZodTypeAny>(schema: S, source: Source = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(badRequest('Please check the highlighted fields.', zodToFieldErrors(result.error)));
      return;
    }

    // Express 5 makes req.query a getter-only property, so assigning to it
    // throws. Stash parsed query separately and read it via `validated()`.
    if (source === 'query') {
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
}

/** Typed accessor for a validated segment. */
export function validated<S extends ZodTypeAny>(req: Request, source: Source = 'body'): z.infer<S> {
  if (source === 'query') {
    return (req as Request & { validatedQuery?: unknown }).validatedQuery as z.infer<S>;
  }
  return req[source] as z.infer<S>;
}
