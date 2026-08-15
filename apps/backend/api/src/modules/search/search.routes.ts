import { Router } from 'express';
import {
  SearchQuerySchema,
  type CompanyCard,
  type Post,
  type SearchResults,
} from '@internlink/shared-types';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { searchPeople } from '../connections/people.service.js';
import { followedCompanyIds } from '../connections/connections.service.js';
import { hydratePostAuthors } from '../posts/author-hydration.js';

export const searchRouter = Router();

searchRouter.use(requireAuth);

/** How much recent content a text search reads before filtering it. */
const POST_POOL = 400;
const COMPANY_POOL = 200;

/**
 * GET /v1/search — FR-1006, one box across people, companies, posts and tags.
 *
 * Everything here is matched in-process over bounded pools. Firestore cannot do
 * substring search, so the alternatives were a prefix match on a single field
 * (which is what "I searched for your name and nothing showed" felt like) or an
 * external index. Reading a pool and filtering it is the honest middle for
 * launch volumes, and it degrades predictably: the results get less complete as
 * the corpus grows, rather than the feature breaking.
 *
 * A hashtag search is exact rather than fuzzy — `#react` means that tag, and
 * offering near-misses would make the tag pages inconsistent with each other.
 */
searchRouter.get(
  '/',
  validate(SearchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { accountId } = req.auth;
    const query = validated<typeof SearchQuerySchema>(req, 'query');

    const term = query.q.trim().toLowerCase();
    const isTagSearch = query.q.trim().startsWith('#');
    const bareTag = term.replace(/^#/, '');
    const wants = (scope: 'people' | 'companies' | 'posts') =>
      query.scope === 'all' || query.scope === scope;

    const [people, companies, postResults] = await Promise.all([
      wants('people') && !isTagSearch
        ? searchPeople(accountId, query.q, query.limit)
        : Promise.resolve([]),
      wants('companies') && !isTagSearch
        ? searchCompanies(accountId, term, query.limit)
        : Promise.resolve([]),
      wants('posts')
        ? searchPosts(isTagSearch ? null : term, bareTag, query.limit)
        : Promise.resolve({ posts: [], hashtags: [] }),
    ]);

    const payload: SearchResults = {
      people,
      companies,
      posts: postResults.posts,
      hashtags: postResults.hashtags,
    };

    sendOk(res, payload);
  }),
);

async function searchCompanies(
  viewerId: string,
  term: string,
  limit: number,
): Promise<CompanyCard[]> {
  const [snap, following] = await Promise.all([
    db().collection(Collections.companies).orderBy('createdAt', 'desc').limit(COMPANY_POOL).get(),
    followedCompanyIds(viewerId).catch(() => new Set<string>()),
  ]);

  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string })
    .filter((company) =>
      [company.name, company.industry, company.headquarters]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(term)),
    )
    .slice(0, limit)
    .map((company) => ({
      id: company.id,
      name: (company.name as string) ?? '',
      logoUrl: (company.logoUrl as string | null) ?? null,
      industry: (company.industry as string | null) ?? null,
      headquarters: (company.headquarters as string | null) ?? null,
      isVerified: company.verificationStatus === 'verified',
      isFollowing: following.has(company.id),
      // Counting open roles per company would be a query each. The browse
      // screen is where that number matters; a search result is a way in.
      openRoleCount: 0,
    }));
}

/**
 * Posts matching free text, plus the hashtags the term itself names.
 *
 * Flagged posts are excluded here rather than filtered by the caller: search is
 * a way around the feed's visibility rules if it is not, and a post held for
 * review turning up in search is exactly the leak that matters.
 */
async function searchPosts(
  term: string | null,
  tag: string,
  limit: number,
): Promise<{ posts: Post[]; hashtags: Array<{ tag: string; postCount: number }> }> {
  const snap = await db()
    .collection(Collections.posts)
    .orderBy('createdAt', 'desc')
    .limit(POST_POOL)
    .get();

  const pool = snap.docs
    .map((doc) => serialise<Post>({ id: doc.id, ...doc.data() }))
    .filter((post) => !post.isFlagged);

  const needle = term ?? tag;
  const matched = pool.filter((post) => {
    if (post.tags?.some((postTag) => postTag === tag)) return true;
    if (!term) return false;
    return (
      post.body.toLowerCase().includes(term) ||
      post.author.name.toLowerCase().includes(term) ||
      (post.tags ?? []).some((postTag) => postTag.includes(term))
    );
  });

  // Tag counts come from the same pool, so they are "recent posts carrying this
  // tag" rather than an all-time total. Saying 12 when the true number is 400
  // would be worse than saying nothing, which is why the UI labels it "recent".
  const counts = new Map<string, number>();
  for (const post of pool) {
    for (const postTag of post.tags ?? []) {
      if (!postTag.includes(needle)) continue;
      counts.set(postTag, (counts.get(postTag) ?? 0) + 1);
    }
  }

  const hashtags = [...counts.entries()]
    .map(([name, postCount]) => ({ tag: name, postCount }))
    .sort((a, b) => b.postCount - a.postCount)
    .slice(0, 8);

  return { posts: await hydratePostAuthors(matched.slice(0, limit)), hashtags };
}
