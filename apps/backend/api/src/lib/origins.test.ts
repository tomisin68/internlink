import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { resolveWebOrigin } from './origins.js';

/** A request stub that only answers the headers `resolveWebOrigin` reads. */
function request(headers: Record<string, string>): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

// The default from config/env.ts when nothing is set — CORS_ORIGINS defaults to
// http://localhost:5173 and WEB_APP_ORIGIN to the Hosting URL.
const FALLBACK = 'https://intern-project-38829.web.app';

describe('resolveWebOrigin', () => {
  it('falls back to the configured origin when no host header is present', () => {
    expect(resolveWebOrigin(request({}))).toBe(FALLBACK);
  });

  it('honours a forwarded host that is on the allowlist', () => {
    // Vercel sets this when it proxies to an external destination. Sending the
    // visitor back to the host they came from is what keeps their session.
    expect(resolveWebOrigin(request({ 'x-forwarded-host': 'localhost:5173' }))).toBe(
      'http://localhost:5173',
    );
  });

  it('prefers the forwarded host over the direct host', () => {
    const resolved = resolveWebOrigin(
      request({ 'x-forwarded-host': 'localhost:5173', host: 'internlink-api.onrender.com' }),
    );
    expect(resolved).toBe('http://localhost:5173');
  });

  it('refuses a host that is not on the allowlist', () => {
    // Otherwise this is an open redirect: the header is attacker-controlled on
    // a direct request, and the value ends up in a location.replace().
    expect(resolveWebOrigin(request({ 'x-forwarded-host': 'evil.example.com' }))).toBe(FALLBACK);
  });

  it('ignores everything after the first host in a proxy chain', () => {
    const resolved = resolveWebOrigin(
      request({ 'x-forwarded-host': 'localhost:5173, evil.example.com' }),
    );
    expect(resolved).toBe('http://localhost:5173');
  });

  it('does not let a lookalike host through on a prefix match', () => {
    expect(resolveWebOrigin(request({ 'x-forwarded-host': 'localhost:5173.evil.com' }))).toBe(
      FALLBACK,
    );
  });

  it('resolves the API host itself back to the configured web origin', () => {
    // A direct hit on the API — a crawler following the raw link — must still
    // point people at the app, not at the API.
    expect(resolveWebOrigin(request({ host: 'internlink-2g0u.onrender.com' }))).toBe(FALLBACK);
  });
});
