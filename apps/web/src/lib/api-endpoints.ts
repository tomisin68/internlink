import type {
  Account,
  Application,
  ApplicationPublic,
  ApplicationStatus,
  Company,
  CompanyCard,
  CompanyProfile,
  ConnectionRecord,
  CreateCommentInput,
  CreatePostInput,
  FeedItem,
  FollowCounts,
  ModerationFlag,
  ModerationFlagView,
  ModerationStats,
  ResolveFlagInput,
  UpdateCompanyInput,
  InboxSummary,
  InternProfile,
  Listing,
  MatchResult,
  Message,
  Paginated,
  PersonSummary,
  Post,
  PostComment,
  PostCommentThread,
  PostDetail,
  PostMedia,
  PostReactor,
  ProfileViews,
  PublicProfile,
  PushCapabilities,
  PushTokenInput,
  RecruiterProfile,
  Relationship,
  SearchResults,
  SessionPayload,
  Thread,
  UpdateAccountImagesInput,
  UpdateInternProfileInput,
  WorkMode,
} from '@internlink/shared-types';
import { api } from './api-client';

/** Query keys in one place so invalidation never misses a cache. */
export const queryKeys = {
  session: ['session'] as const,
  feed: (scope: string) => ['feed', scope] as const,
  /** A hashtag page and a profile's posts are both feeds with a filter. */
  tagFeed: (tag: string) => ['feed', 'tag', tag] as const,
  authorFeed: (accountId: string) => ['feed', 'author', accountId] as const,
  savedFeed: ['feed', 'saved'] as const,
  postReactors: (postId: string) => ['feed', 'posts', postId, 'reactors'] as const,
  mentionCandidates: (q: string) => ['feed', 'mentions', q] as const,
  search: (q: string, scope: string) => ['search', scope, q] as const,
  profileStats: ['profiles', 'me', 'stats'] as const,
  profileViews: ['profiles', 'me', 'views'] as const,
  matches: ['feed', 'matches'] as const,
  threads: (box: string) => ['messages', 'threads', box] as const,
  thread: (id: string) => ['messages', 'thread', id] as const,
  messages: (id: string) => ['messages', 'thread', id, 'messages'] as const,
  inboxSummary: ['messages', 'summary'] as const,
  connections: ['network', 'connections'] as const,
  pendingConnections: ['network', 'connections', 'pending'] as const,
  people: (scope: string, q: string) => ['network', 'people', scope, q] as const,
  companies: (q: string, verified: boolean) => ['companies', q, verified] as const,
  company: (id: string) => ['companies', id] as const,
  companyListings: (id: string) => ['companies', id, 'listings'] as const,
  companyPosts: (id: string) => ['companies', id, 'posts'] as const,
  moderationQueue: (status: string) => ['admin', 'moderation', status] as const,
  moderationStats: ['admin', 'moderation', 'stats'] as const,
  relationship: (id: string) => ['network', 'relationship', id] as const,
  followCounts: (id: string) => ['network', 'follows', id] as const,
  comments: (postId: string) => ['feed', 'posts', postId, 'comments'] as const,
  listings: (filters: string) => ['listings', filters] as const,
  listing: (id: string) => ['listings', id] as const,
  myListings: ['listings', 'mine'] as const,
  myApplications: ['applications', 'mine'] as const,
  pipeline: (listingId: string) => ['applications', 'listing', listingId] as const,
  internProfile: ['profiles', 'intern', 'me'] as const,
  publicProfile: (accountId: string) => ['profiles', 'public', accountId] as const,
  completeness: ['profiles', 'intern', 'completeness'] as const,
};

export interface ListingFilters {
  q?: string;
  skill?: string;
  workMode?: WorkMode | '';
  location?: string;
}

function toQuery(filters: ListingFilters): string {
  const params = new URLSearchParams();
  // Empty strings are dropped rather than sent — an empty `workMode=` would be
  // rejected by the enum on the server.
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  return params.toString();
}

export const listingsApi = {
  browse: (filters: ListingFilters = {}) => {
    const query = toQuery(filters);
    return api.get<Paginated<Listing>>(`/listings${query ? `?${query}` : ''}`);
  },

  get: (id: string) => api.get<{ listing: Listing; company: Company | null }>(`/listings/${id}`),

  mine: () => api.get<Paginated<Listing>>('/listings/mine/all'),

  create: (input: {
    title: string;
    description: string;
    skills: string[];
    /** FR-303 — a role post carries photos and video like any other post. */
    media?: PostMedia[];
    tags?: string[];
    location?: string | null;
    workMode: WorkMode;
    durationMonths?: number | null;
    status: 'draft' | 'active';
  }) => api.post<Listing>('/listings', input),
};

export const applicationsApi = {
  apply: (listingId: string, coverNote?: string) =>
    api.post<ApplicationPublic>('/applications', { listingId, coverNote: coverNote || null }),

  mine: () => api.get<Paginated<ApplicationPublic>>('/applications/mine'),

  forListing: (listingId: string) =>
    api.get<Paginated<Application>>(`/applications/listing/${listingId}`),

  setStatus: (id: string, status: ApplicationStatus) =>
    api.patch<Application>(`/applications/${id}/status`, { status }),
};

export const profileApiClient = {
  getIntern: () => api.get<InternProfile>('/profiles/intern/me'),

  updateIntern: (input: UpdateInternProfileInput) =>
    api.patch<InternProfile>('/profiles/intern/me', input),

  completeness: () =>
    api.get<{ score: number; missing: string[] }>('/profiles/intern/me/completeness'),

  getRecruiter: () =>
    api.get<{ profile: RecruiterProfile; company: Company | null }>('/profiles/recruiter/me'),

  /** Somebody else's profile, assembled for this viewer. */
  getPublic: (accountId: string) => api.get<PublicProfile>(`/profiles/${accountId}`),

  /**
   * The counts on your own profile header.
   *
   * A separate read from the session because these change constantly and the
   * session is cached for the whole visit.
   */
  myStats: () =>
    api.get<{
      followers: number;
      following: number;
      connections: number;
      posts: number;
      joinedAt: string | null;
    }>('/profiles/me/stats'),

  /** FR-1001 — who has looked at your profile. Yours only, by design. */
  myViews: () => api.get<ProfileViews>('/profiles/me/views'),

  /**
   * Profile photo and cover image. Returns the whole session so the header
   * updates everywhere at once, not just where the change was made.
   */
  updateImages: (input: UpdateAccountImagesInput) =>
    api.patch<SessionPayload>('/auth/me/images', input),
};

/** FR-601 — web push registration. */
export const pushApi = {
  status: () => api.get<PushCapabilities>('/notifications/push/status'),

  register: (input: PushTokenInput) =>
    api.post<{ registered: boolean }>('/notifications/push/tokens', input),

  unregister: (token: string) =>
    api.delete<{ registered: boolean }>('/notifications/push/tokens', { body: { token } }),

  /** Fires a push to your own devices, so setup is verifiable end to end. */
  test: () => api.post<{ sent: number; pruned: number }>('/notifications/push/test'),
};

export type { Account };

export interface FeedRequest {
  scope?: 'for_you' | 'following' | 'saved';
  /** Hashtag page. Normalised server-side, so a leading `#` is fine. */
  tag?: string;
  /** A single author's posts — what the profile "Posts" tab asks for. */
  authorId?: string;
  limit?: number;
}

export const feedApi = {
  getFeed: (request: FeedRequest | 'for_you' | 'following' = 'for_you', limit = 20) => {
    // The string form is the original signature, kept because the feed screen
    // and several callers still pass a bare scope.
    const options: FeedRequest =
      typeof request === 'string' ? { scope: request, limit } : { limit, ...request };

    const params = new URLSearchParams({
      scope: options.scope ?? 'for_you',
      limit: String(options.limit ?? 20),
    });
    if (options.tag) params.set('tag', options.tag);
    if (options.authorId) params.set('authorId', options.authorId);

    return api.get<{ items: FeedItem[]; hasMore: boolean }>(`/feed?${params}`);
  },

  getMatches: (limit = 20, minScore = 25) =>
    api.get<{ items: MatchResult[]; profileReady: boolean }>(
      `/feed/matches?limit=${limit}&minScore=${minScore}`,
    ),

  /** A single post — what a shared `/p/:id` link resolves to. */
  getPost: (id: string) => api.get<PostDetail>(`/feed/posts/${id}`),

  createPost: (input: CreatePostInput) => api.post<Post>('/feed/posts', input),

  updatePost: (id: string, input: { allowResharing: boolean }) =>
    api.patch<Post>(`/feed/posts/${id}`, input),

  deletePost: (id: string) => api.delete<{ deleted: boolean }>(`/feed/posts/${id}`),

  /**
   * A reaction on a reshare lands on the original — the server resolves that
   * and reports which post actually took it in `postId`.
   */
  toggleReaction: (id: string) =>
    api.post<{ hasReacted: boolean; reactionCount: number; postId: string }>(
      `/feed/posts/${id}/reactions`,
    ),

  /** FR-1007 — save a post. Idempotent toggle; the server owns the state. */
  toggleBookmark: (id: string) =>
    api.post<{ isBookmarked: boolean }>(`/feed/posts/${id}/bookmarks`),

  /** Who reacted — what the "Liked by…" line expands into. */
  listReactors: (id: string) =>
    api.get<{ items: PostReactor[] }>(`/feed/posts/${id}/reactions`),

  /** People the composer can tag. Scoped to your connections and follows. */
  mentionCandidates: (q: string) =>
    api.get<{ items: PostReactor[] }>(`/feed/mentions?q=${encodeURIComponent(q)}`),

  reshare: (id: string, input: { body?: string; asCompany?: boolean } = {}) =>
    api.post<Post>(`/feed/posts/${id}/reshares`, input),

  listComments: (id: string) =>
    api.get<{ items: PostCommentThread[] }>(`/feed/posts/${id}/comments`),

  addComment: (id: string, input: CreateCommentInput) =>
    api.post<PostComment>(`/feed/posts/${id}/comments`, input),

  toggleCommentReaction: (postId: string, commentId: string) =>
    api.post<{ hasLiked: boolean; likeCount: number }>(
      `/feed/posts/${postId}/comments/${commentId}/reactions`,
    ),

  deleteComment: (postId: string, commentId: string) =>
    api.delete<{ deleted: boolean }>(`/feed/posts/${postId}/comments/${commentId}`),
};

/** FR-1008 — company pages. */
export const companiesApi = {
  browse: (q = '', verifiedOnly = false) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (verifiedOnly) params.set('verifiedOnly', 'true');
    const query = params.toString();
    return api.get<{ items: CompanyCard[] }>(`/companies${query ? `?${query}` : ''}`);
  },

  get: (companyId: string) => api.get<CompanyProfile>(`/companies/${companyId}`),

  listings: (companyId: string) =>
    api.get<{ items: Listing[] }>(`/companies/${companyId}/listings`),

  posts: (companyId: string) => api.get<{ items: Post[] }>(`/companies/${companyId}/posts`),

  update: (companyId: string, input: UpdateCompanyInput) =>
    api.patch<Company>(`/companies/${companyId}`, input),
};

/** §9.3 — the moderation console. Every route is admin-only server-side. */
export const adminApi = {
  stats: () => api.get<ModerationStats>('/admin/moderation/stats'),

  queue: (status: 'open' | 'reviewing' | 'actioned' | 'dismissed' = 'open') =>
    api.get<{ items: ModerationFlagView[] }>(`/admin/moderation?status=${status}`),

  resolve: (flagId: string, input: ResolveFlagInput) =>
    api.post<ModerationFlag>(`/admin/moderation/${flagId}/resolve`, input),
};

export const messagingApi = {
  listThreads: (box: 'primary' | 'requests') =>
    api.get<Paginated<Thread>>(`/messages/threads?box=${box}`),

  summary: () => api.get<InboxSummary>('/messages/summary'),

  getThread: (id: string) => api.get<Thread>(`/messages/threads/${id}`),

  listMessages: (id: string, limit = 40) =>
    api.get<Paginated<Message>>(`/messages/threads/${id}/messages?limit=${limit}`),

  startThread: (input: { recipientId: string; body: string; applicationId?: string | null }) =>
    api.post<{ thread: Thread; message: Message }>('/messages/threads', input),

  sendMessage: (threadId: string, body: string) =>
    api.post<Message>(`/messages/threads/${threadId}/messages`, { body, attachments: [] }),

  markRead: (threadId: string) => api.post<{ read: boolean }>(`/messages/threads/${threadId}/read`),

  respondToRequest: (threadId: string, accept: boolean, block = false) =>
    api.post<Thread>(`/messages/threads/${threadId}/respond`, { accept, block }),

  setMuted: (threadId: string, muted: boolean) =>
    api.post<{ muted: boolean }>(`/messages/threads/${threadId}/mute`, { muted }),
};

/** A pending request, paired with who sent it. */
export interface PendingRequest {
  request: ConnectionRecord;
  person: PersonSummary;
}

export const networkApi = {
  connections: () => api.get<{ items: PersonSummary[] }>('/network/connections'),

  pending: () => api.get<{ items: PendingRequest[] }>('/network/connections/pending'),

  /** FR-1006 — people to connect with, ranked by mutual connections. */
  people: (scope: 'suggested' | 'all' = 'suggested', q = '') => {
    const params = new URLSearchParams({ scope });
    if (q) params.set('q', q);
    return api.get<{ items: PersonSummary[] }>(`/network/people?${params}`);
  },

  connect: (recipientId: string, message?: string) =>
    api.post<ConnectionRecord>('/network/connections', { recipientId, message }),

  respond: (id: string, accept: boolean) =>
    api.post<ConnectionRecord>(`/network/connections/${id}/respond`, { accept }),

  removeConnection: (accountId: string) =>
    api.delete<{ removed: boolean }>(`/network/connections/${accountId}`),

  relationship: (accountId: string) =>
    api.get<{ relationship: Relationship }>(`/network/relationship/${accountId}`),

  /** `mutual` is true when this was a follow *back* — worth saying out loud. */
  followAccount: (accountId: string) =>
    api.post<{ following: boolean; mutual: boolean }>(`/network/follows/accounts/${accountId}`),

  unfollowAccount: (accountId: string) =>
    api.delete<{ following: boolean }>(`/network/follows/accounts/${accountId}`),

  followCounts: (accountId: string) =>
    api.get<FollowCounts>(`/network/follows/counts/${accountId}`),

  follow: (companyId: string) =>
    api.post<{ following: boolean }>(`/network/follows/companies/${companyId}`),

  unfollow: (companyId: string) =>
    api.delete<{ following: boolean }>(`/network/follows/companies/${companyId}`),

  block: (accountId: string) => api.post<{ blocked: boolean }>(`/network/blocks/${accountId}`),

  report: (input: {
    targetType: 'listing' | 'message' | 'post' | 'comment' | 'profile' | 'company';
    targetId: string;
    /** The post a comment sits under — see `CreateReportSchema`. */
    parentId?: string | null;
    reason: string;
    detail?: string;
  }) => api.post<{ id: string; severity: string; message: string }>('/network/reports', input),
};

/** FR-1006 — one box across people, companies, posts and hashtags. */
export const searchApi = {
  run: (q: string, scope: 'all' | 'people' | 'companies' | 'posts' = 'all') =>
    api.get<SearchResults>(
      `/search?q=${encodeURIComponent(q)}&scope=${scope}&limit=20`,
    ),
};

export type { PostMedia };
