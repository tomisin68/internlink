import type {
  Account,
  Application,
  ApplicationPublic,
  ApplicationStatus,
  Company,
  ConnectionRecord,
  CreateCommentInput,
  CreatePostInput,
  FeedItem,
  FollowCounts,
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
  PublicProfile,
  RecruiterProfile,
  Relationship,
  Thread,
  UpdateInternProfileInput,
  WorkMode,
} from '@internlink/shared-types';
import { api } from './api-client';

/** Query keys in one place so invalidation never misses a cache. */
export const queryKeys = {
  session: ['session'] as const,
  feed: (scope: string) => ['feed', scope] as const,
  matches: ['feed', 'matches'] as const,
  threads: (box: string) => ['messages', 'threads', box] as const,
  thread: (id: string) => ['messages', 'thread', id] as const,
  messages: (id: string) => ['messages', 'thread', id, 'messages'] as const,
  inboxSummary: ['messages', 'summary'] as const,
  connections: ['network', 'connections'] as const,
  pendingConnections: ['network', 'connections', 'pending'] as const,
  people: (scope: string, q: string) => ['network', 'people', scope, q] as const,
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
};

export type { Account };

export const feedApi = {
  getFeed: (scope: 'for_you' | 'following', limit = 20) =>
    api.get<{ items: FeedItem[]; hasMore: boolean }>(`/feed?scope=${scope}&limit=${limit}`),

  getMatches: (limit = 20, minScore = 25) =>
    api.get<{ items: MatchResult[]; profileReady: boolean }>(
      `/feed/matches?limit=${limit}&minScore=${minScore}`,
    ),

  createPost: (input: CreatePostInput) => api.post<Post>('/feed/posts', input),

  updatePost: (id: string, input: { allowResharing: boolean }) =>
    api.patch<Post>(`/feed/posts/${id}`, input),

  deletePost: (id: string) => api.delete<{ deleted: boolean }>(`/feed/posts/${id}`),

  toggleReaction: (id: string) =>
    api.post<{ hasReacted: boolean; reactionCount: number }>(`/feed/posts/${id}/reactions`),

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

  followAccount: (accountId: string) =>
    api.post<{ following: boolean }>(`/network/follows/accounts/${accountId}`),

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
    targetType: 'listing' | 'message' | 'post' | 'profile' | 'company';
    targetId: string;
    reason: string;
    detail?: string;
  }) => api.post<{ id: string; severity: string; message: string }>('/network/reports', input),
};
