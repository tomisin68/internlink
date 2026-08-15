import type { Account, Company, Post, PostAuthor, PostComment } from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';

/**
 * Refreshes the denormalised author block on posts and comments at read time.
 *
 * `PostAuthorSchema` explains why identity is stamped onto every post: a feed
 * page of twenty posts from twenty authors would otherwise cost twenty extra
 * document reads. The cost of that trade is staleness — someone who posts and
 * *then* adds a profile photo keeps showing up as initials forever, which is
 * exactly the bug people notice first because they see it on their own posts.
 *
 * This buys the accuracy back without giving up the read shape. One batched
 * lookup per page resolves every distinct author, so the amplification is
 * bounded by the number of *authors* on a page rather than the number of posts,
 * and a page where one person posted five times costs one read, not five.
 *
 * The stamped values remain the fallback: an author whose account has since
 * been deleted keeps the name their post was published under rather than
 * collapsing to a blank card.
 */

interface AuthorIdentity {
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  isVerified: boolean;
}

async function chunkedByIds<T>(
  collection: string,
  ids: string[],
  map: (id: string, data: Record<string, unknown>) => T,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  if (ids.length === 0) return results;

  // Firestore caps `in` at 30 values.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) => db().collection(collection).where('__name__', 'in', chunk).get()),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) results.set(doc.id, map(doc.id, doc.data()));
  }

  return results;
}

/**
 * Resolves current identity for a mixed set of person and company authors.
 *
 * Exported so callers that already hold a set of author IDs (the notification
 * enricher, for one) can reuse the same batched lookup rather than opening a
 * second path to the same data.
 */
export async function loadAuthorIdentities(
  authors: ReadonlyArray<Pick<PostAuthor, 'kind' | 'id'>>,
): Promise<Map<string, AuthorIdentity>> {
  const accountIds = [...new Set(authors.filter((a) => a.kind === 'account').map((a) => a.id))];
  const companyIds = [...new Set(authors.filter((a) => a.kind === 'company').map((a) => a.id))];

  const [accounts, companies, headlines] = await Promise.all([
    chunkedByIds(Collections.accounts, accountIds, (id, data) =>
      serialise<Account>({ id, ...data }),
    ),
    chunkedByIds(Collections.companies, companyIds, (id, data) =>
      serialise<Company>({ id, ...data }),
    ),
    // Headlines live on the intern profile, not the account, so a person's
    // subtitle needs the second collection. Recruiters have no headline here —
    // theirs is their company, which the post already carries.
    chunkedByIds(Collections.internProfiles, accountIds, (_id, data) =>
      typeof data.headline === 'string' ? data.headline : null,
    ),
  ]);

  const identities = new Map<string, AuthorIdentity>();

  for (const [id, account] of accounts) {
    identities.set(`account:${id}`, {
      name: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
      avatarUrl: account.photoUrl ?? null,
      headline: headlines.get(id) ?? null,
      isVerified: (account.verificationTiers ?? []).length > 0,
    });
  }

  for (const [id, company] of companies) {
    identities.set(`company:${id}`, {
      name: company.name,
      avatarUrl: company.logoUrl ?? null,
      headline: company.industry ?? null,
      isVerified: company.verificationStatus === 'verified',
    });
  }

  return identities;
}

function applyIdentity(
  author: PostAuthor,
  identities: Map<string, AuthorIdentity>,
): PostAuthor {
  const identity = identities.get(`${author.kind}:${author.id}`);
  if (!identity) return author;
  return { ...author, ...identity };
}

/** Every author referenced by a post, including the one it quotes. */
function authorsOf(post: Post): PostAuthor[] {
  return post.resharedFrom ? [post.author, post.resharedFrom.author] : [post.author];
}

export async function hydratePostAuthors(posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) return posts;

  const identities = await loadAuthorIdentities(posts.flatMap(authorsOf));

  return posts.map((post) => ({
    ...post,
    author: applyIdentity(post.author, identities),
    resharedFrom: post.resharedFrom
      ? { ...post.resharedFrom, author: applyIdentity(post.resharedFrom.author, identities) }
      : null,
  }));
}

export async function hydratePostAuthor(post: Post): Promise<Post> {
  return (await hydratePostAuthors([post]))[0]!;
}

export async function hydrateCommentAuthors<T extends PostComment>(comments: T[]): Promise<T[]> {
  if (comments.length === 0) return comments;

  const identities = await loadAuthorIdentities(comments.map((c) => c.author));
  return comments.map((comment) => ({
    ...comment,
    author: applyIdentity(comment.author, identities),
  }));
}
