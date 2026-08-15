import type {
  Account,
  ConnectionRecord,
  Follow,
  FollowCounts,
  FollowTarget,
  Relationship,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso } from '../../lib/firestore.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { consumeQuota } from '../../lib/daily-quota.js';
import { getAccount } from '../auth/auth.service.js';

/**
 * FR-1006 — connections, follows and blocks.
 *
 * The connection document ID is derived from the two account IDs sorted and
 * joined, which makes a connection unique by construction. Two people pressing
 * "connect" on each other within the same second write the same document
 * instead of creating a mirrored pair that then needs reconciling — a bug class
 * that is very hard to notice and very annoying to clean up later.
 */
export function connectionId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

export function blockId(blockerId: string, blockedId: string): string {
  return `${blockerId}__${blockedId}`;
}

export async function getConnection(a: string, b: string): Promise<ConnectionRecord | null> {
  const snap = await db().collection(Collections.connections).doc(connectionId(a, b)).get();
  return docToEntity<ConnectionRecord>(snap);
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [aBlocksB, bBlocksA] = await Promise.all([
    db().collection(Collections.blocks).doc(blockId(a, b)).get(),
    db().collection(Collections.blocks).doc(blockId(b, a)).get(),
  ]);
  return aBlocksB.exists || bBlocksA.exists;
}

/** Every account ID this person is connected to. */
export async function connectedIds(accountId: string): Promise<string[]> {
  const snap = await db()
    .collection(Collections.connections)
    .where('participantIds', 'array-contains', accountId)
    .where('status', '==', 'accepted')
    .get();

  return snap.docs
    .map((d) => (d.data() as ConnectionRecord).participantIds.find((id) => id !== accountId))
    .filter((id): id is string => Boolean(id));
}

/**
 * Resolves how two accounts relate. Used by both the messaging gate (FR-505)
 * and feed affinity (FR-1007).
 *
 * Second-degree detection is capped: it walks the viewer's connections and
 * checks whether any of them connect to the target. That is one extra query
 * per *viewer*, not per candidate, because the caller is expected to hoist it —
 * see `buildRelationshipResolver`.
 */
export async function resolveRelationship(
  viewerId: string,
  targetId: string,
): Promise<Relationship> {
  if (viewerId === targetId) return 'self';
  if (await isBlockedEitherWay(viewerId, targetId)) return 'blocked';

  const connection = await getConnection(viewerId, targetId);
  if (connection?.status === 'accepted') return 'connected';
  if (connection?.status === 'pending') {
    return connection.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming';
  }

  const mine = await connectedIds(viewerId);
  if (mine.length > 0) {
    const theirs = new Set(await connectedIds(targetId));
    if (mine.some((id) => theirs.has(id))) return 'second_degree';
  }

  return 'none';
}

/** Requests involving this account that nobody has answered yet, either way. */
export async function pendingConnections(accountId: string): Promise<ConnectionRecord[]> {
  const snap = await db()
    .collection(Collections.connections)
    .where('participantIds', 'array-contains', accountId)
    .where('status', '==', 'pending')
    .get();

  return snap.docs
    .map((d) => docToEntity<ConnectionRecord>(d))
    .filter((c): c is ConnectionRecord => Boolean(c));
}

export interface RelationshipResolver {
  relationshipTo: (targetId: string) => Relationship;
  /** The connection document ID when a request is outstanding either way. */
  connectionIdFor: (targetId: string) => string | null;
  /** How many of the viewer's connections this person also connects to. */
  mutualCount: (targetId: string) => number;
  blockedIds: Set<string>;
  connections: Set<string>;
}

/**
 * Builds a resolver that answers relationship questions for many targets after
 * a fixed number of reads.
 *
 * The naive approach — calling `resolveRelationship` per feed item — is O(n)
 * round trips for a feed page. This does the viewer's own lookups once, then
 * answers from memory.
 */
export async function buildRelationshipResolver(viewerId: string): Promise<RelationshipResolver> {
  const [connections, pending, blocksOut, blocksIn] = await Promise.all([
    connectedIds(viewerId),
    pendingConnections(viewerId),
    db().collection(Collections.blocks).where('blockerId', '==', viewerId).get(),
    db().collection(Collections.blocks).where('blockedId', '==', viewerId).get(),
  ]);

  const connectionSet = new Set(connections);
  const blockedIds = new Set<string>([
    ...blocksOut.docs.map((d) => d.data().blockedId as string),
    ...blocksIn.docs.map((d) => d.data().blockerId as string),
  ]);

  const pendingByTarget = new Map<string, ConnectionRecord>();
  for (const record of pending) {
    const other = record.participantIds.find((id) => id !== viewerId);
    if (other) pendingByTarget.set(other, record);
  }

  // Second-degree needs the connections-of-connections set. Bounded to the
  // first 50 connections: beyond that the set stops discriminating (almost
  // everyone is second-degree) and the read cost stops being worth it.
  //
  // Counting how many paths reach each person costs nothing extra on the same
  // walk, and "3 mutual connections" is what makes a suggestion worth acting on.
  const sampled = connections.slice(0, 50);
  const mutuals = new Map<string, number>();
  if (sampled.length > 0) {
    const results = await Promise.all(sampled.map((id) => connectedIds(id)));
    for (const ids of results) {
      for (const id of ids) {
        if (id === viewerId) continue;
        mutuals.set(id, (mutuals.get(id) ?? 0) + 1);
      }
    }
  }

  return {
    connections: connectionSet,
    blockedIds,
    mutualCount: (targetId: string) => mutuals.get(targetId) ?? 0,
    connectionIdFor: (targetId: string) => pendingByTarget.get(targetId)?.id ?? null,
    relationshipTo: (targetId: string): Relationship => {
      if (targetId === viewerId) return 'self';
      if (blockedIds.has(targetId)) return 'blocked';
      if (connectionSet.has(targetId)) return 'connected';

      const request = pendingByTarget.get(targetId);
      if (request) {
        return request.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming';
      }

      if (!connectionSet.has(targetId) && (mutuals.get(targetId) ?? 0) > 0) return 'second_degree';
      return 'none';
    },
  };
}

/* ============================================================== mutations = */

export async function sendConnectionRequest(
  requesterId: string,
  recipientId: string,
  message?: string,
): Promise<ConnectionRecord> {
  if (requesterId === recipientId) throw conflict('You cannot connect with yourself.');

  const recipient = await getAccount(recipientId);
  if (!recipient) throw notFound('That person');
  if (await isBlockedEitherWay(requesterId, recipientId)) {
    // Deliberately indistinguishable from "not found" — telling someone they
    // have been blocked invites them to work around it.
    throw notFound('That person');
  }

  const existing = await getConnection(requesterId, recipientId);
  if (existing?.status === 'accepted') throw conflict('You are already connected.');
  if (existing?.status === 'pending') {
    // They already asked us — treat this as accepting rather than as a clash.
    if (existing.requesterId === recipientId) {
      return respondToConnection(requesterId, existing.id, true);
    }
    throw conflict('You have already sent a request to this person.');
  }

  await consumeQuota(requesterId, 'connection_request');

  const id = connectionId(requesterId, recipientId);
  const record: ConnectionRecord = {
    id,
    requesterId,
    recipientId,
    participantIds: [requesterId, recipientId].sort(),
    status: 'pending',
    message: message?.trim() || null,
    createdAt: nowIso(),
    respondedAt: null,
  };

  const { id: _omit, ...doc } = record;
  void _omit;
  await db().collection(Collections.connections).doc(id).set(doc);

  return record;
}

export async function respondToConnection(
  accountId: string,
  id: string,
  accept: boolean,
): Promise<ConnectionRecord> {
  const ref = db().collection(Collections.connections).doc(id);
  const record = docToEntity<ConnectionRecord>(await ref.get());
  if (!record) throw notFound('That request');

  // Only the person who received it may answer it.
  if (record.recipientId !== accountId) throw forbidden('That request is not yours to answer.');
  if (record.status !== 'pending') throw conflict('That request has already been answered.');

  const respondedAt = nowIso();
  const status = accept ? 'accepted' : 'declined';
  await ref.update({ status, respondedAt });

  return { ...record, status, respondedAt };
}

export async function removeConnection(accountId: string, otherId: string): Promise<void> {
  const id = connectionId(accountId, otherId);
  const record = await getConnection(accountId, otherId);
  if (!record) throw notFound('That connection');
  if (!record.participantIds.includes(accountId)) throw forbidden('That is not your connection.');
  await db().collection(Collections.connections).doc(id).delete();
}

export async function listConnections(accountId: string): Promise<Account[]> {
  const ids = await connectedIds(accountId);
  if (ids.length === 0) return [];

  // Firestore caps `in` at 30 values, so this batches. Beyond a few hundred
  // connections this wants replacing with a denormalised connection summary.
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));

  const results = await Promise.all(
    batches.map((batch) =>
      db().collection(Collections.accounts).where('__name__', 'in', batch).get(),
    ),
  );

  return results.flatMap((snap) =>
    snap.docs.map((d) => docToEntity<Account>(d)).filter((a): a is Account => Boolean(a)),
  );
}

export async function listPendingRequests(accountId: string): Promise<ConnectionRecord[]> {
  const snap = await db()
    .collection(Collections.connections)
    .where('recipientId', '==', accountId)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  return snap.docs
    .map((d) => docToEntity<ConnectionRecord>(d))
    .filter((c): c is ConnectionRecord => Boolean(c));
}

/* ================================================================ follows = */

/**
 * Follows cover both companies and people.
 *
 * The document ID stays `{followerId}__{targetId}` rather than gaining a type
 * segment, so every follow written before people were followable keeps its
 * identity and its idempotency. `targetType` is what disambiguates, and the
 * reader below backfills it from the legacy `companyId` field.
 */
function followDocId(followerId: string, targetId: string): string {
  return `${followerId}__${targetId}`;
}

export async function follow(
  followerId: string,
  targetType: FollowTarget,
  targetId: string,
): Promise<void> {
  if (targetType === 'account') {
    if (followerId === targetId) throw conflict('You cannot follow yourself.');
    const target = await getAccount(targetId);
    if (!target) throw notFound('That person');
    // Same reasoning as connection requests: a block is invisible to the person
    // blocked, so this is deliberately indistinguishable from "no such account".
    if (await isBlockedEitherWay(followerId, targetId)) throw notFound('That person');
  }

  await db()
    .collection(Collections.follows)
    .doc(followDocId(followerId, targetId))
    .set({
      followerId,
      targetType,
      targetId,
      companyId: targetType === 'company' ? targetId : null,
      createdAt: nowIso(),
    });
}

export async function unfollow(followerId: string, targetId: string): Promise<void> {
  await db().collection(Collections.follows).doc(followDocId(followerId, targetId)).delete();
}

/** Both follow sets in one read — the feed needs both on every request. */
export async function followedIds(accountId: string): Promise<{
  companies: Set<string>;
  accounts: Set<string>;
}> {
  const snap = await db()
    .collection(Collections.follows)
    .where('followerId', '==', accountId)
    .get();

  const companies = new Set<string>();
  const accounts = new Set<string>();

  for (const doc of snap.docs) {
    const data = doc.data() as Partial<Follow>;
    // Rows written before follows were generalised carry only `companyId`.
    const targetId = data.targetId ?? data.companyId;
    if (!targetId) continue;
    if ((data.targetType ?? 'company') === 'account') accounts.add(targetId);
    else companies.add(targetId);
  }

  return { companies, accounts };
}

export async function followedCompanyIds(accountId: string): Promise<Set<string>> {
  return (await followedIds(accountId)).companies;
}

export async function followerCount(targetId: string): Promise<number> {
  const snap = await db()
    .collection(Collections.follows)
    .where('targetId', '==', targetId)
    .count()
    .get();
  return snap.data().count;
}

export async function followCounts(accountId: string): Promise<FollowCounts> {
  const [followers, following] = await Promise.all([
    followerCount(accountId),
    db().collection(Collections.follows).where('followerId', '==', accountId).count().get(),
  ]);
  return { followers, following: following.data().count };
}

/* ================================================================= blocks = */

/** FR-509 — blocking also tears down any thread between the two accounts. */
export async function blockAccount(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw conflict('You cannot block yourself.');

  const batch = db().batch();

  batch.set(db().collection(Collections.blocks).doc(blockId(blockerId, blockedId)), {
    blockerId,
    blockedId,
    createdAt: nowIso(),
  });

  // A block that leaves the connection standing is not a block.
  batch.delete(db().collection(Collections.connections).doc(connectionId(blockerId, blockedId)));

  const threads = await db()
    .collection(Collections.messageThreads)
    .where('participantIds', 'array-contains', blockerId)
    .get();

  for (const doc of threads.docs) {
    const participants = (doc.data().participantIds as string[]) ?? [];
    if (participants.includes(blockedId)) {
      batch.update(doc.ref, { state: 'blocked', updatedAt: nowIso() });
    }
  }

  await batch.commit();
}

export async function unblockAccount(blockerId: string, blockedId: string): Promise<void> {
  await db().collection(Collections.blocks).doc(blockId(blockerId, blockedId)).delete();
}
