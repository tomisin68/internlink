import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  CollectionReference,
  DocumentData,
  DocumentSnapshot,
  Query,
} from 'firebase-admin/firestore';
import type { Paginated } from '@internlink/shared-types';

/** Firestore stores Timestamps; the API contract says ISO-8601 strings. */
export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const serverTimestamp = () => FieldValue.serverTimestamp();

/**
 * Recursively converts Timestamps to ISO strings and strips `undefined`.
 *
 * Firestore rejects `undefined` outright, and a nested Timestamp that slips
 * through serialises as `{_seconds, _nanoseconds}` — which then fails Zod
 * parsing on the client with a message that points nowhere useful.
 */
export function serialise<T = DocumentData>(input: unknown): T {
  if (input === null || input === undefined) return input as T;
  if (input instanceof Timestamp) return input.toDate().toISOString() as T;
  if (input instanceof Date) return input.toISOString() as T;
  if (Array.isArray(input)) return input.map((v) => serialise(v)) as T;

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === undefined) continue;
      out[key] = serialise(value);
    }
    return out as T;
  }
  return input as T;
}

export function docToEntity<T>(snap: DocumentSnapshot): T | null {
  if (!snap.exists) return null;
  return serialise<T>({ id: snap.id, ...snap.data() });
}

/**
 * Cursor pagination (SRS §3.5). The cursor is the last document's ID, base64'd
 * so it reads as opaque and nobody starts hand-crafting one.
 *
 * `orderByField` must match the query's own ordering or Firestore will refuse
 * the startAfter.
 */
export function encodeCursor(docId: string): string {
  return Buffer.from(docId, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

/**
 * The collection is passed explicitly rather than dug out of the query, because
 * the only way to recover it from a `Query` is to read private `_queryOptions`
 * internals — which breaks silently on a firebase-admin upgrade.
 */
export async function paginateQuery<T>(
  collection: CollectionReference,
  buildQuery: (c: CollectionReference) => Query,
  opts: { limit: number; cursor?: string | undefined },
): Promise<Paginated<T>> {
  const base = buildQuery(collection);
  let query = base.limit(opts.limit + 1); // over-fetch by one to detect `hasMore`

  if (opts.cursor) {
    const anchor = await collection.doc(decodeCursor(opts.cursor)).get();
    // A stale cursor (document since deleted) falls through to page one rather
    // than erroring — an infinite-scroll list should never hard-fail on it.
    if (anchor.exists) query = query.startAfter(anchor);
  }

  const snap = await query.get();
  const docs = snap.docs.slice(0, opts.limit);
  const hasMore = snap.docs.length > opts.limit;
  const last = docs[docs.length - 1];

  return {
    items: docs.map((d) => serialise<T>({ id: d.id, ...d.data() })),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    hasMore,
  };
}
