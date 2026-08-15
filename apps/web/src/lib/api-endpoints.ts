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
  InboxSummary,
  InternProfile,
  Listing,
  MatchResult,
  Message,
  Paginated,
  Post,
  PostComment,
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
  relationship: (id: string) => ['network', 'relationship', id] as const,
  comments: (postId: string) => ['feed', 'posts', postId, 'comments'] as const,
  listings: (filters: string) => ['listings', filters] as const,
  listing: (id: string) => ['listings', id] as const,
  myListings: ['listings', 'mine'] as const,
  myApplications: ['applications', 'mine'] as const,
  pipeline: (listingId: string) => ['applications', 'listing', listingId] as const,
  internProfile: ['profiles', 'intern', 'me'] as const,
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

  deletePost: (id: string) => api.delete<{ deleted: boolean }>(`/feed/posts/${id}`),

  toggleReaction: (id: string) =>
    api.post<{ hasReacted: boolean; reactionCount: number }>(`/feed/posts/${id}/reactions`),

  listComments: (id: string) =>
    api.get<{ items: PostComment[] }>(`/feed/posts/${id}/comments`),

  addComment: (id: string, input: CreateCommentInput) =>
    api.post<PostComment>(`/feed/posts/${id}/comments`, input),
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

export const networkApi = {
  connections: () => api.get<{ items: unknown[] }>('/network/connections'),

  pending: () => api.get<{ items: ConnectionRecord[] }>('/network/connections/pending'),

  connect: (recipientId: string, message?: string) =>
    api.post<ConnectionRecord>('/network/connections', { recipientId, message }),

  respond: (id: string, accept: boolean) =>
    api.post<ConnectionRecord>(`/network/connections/${id}/respond`, { accept }),

  relationship: (accountId: string) =>
    api.get<{ relationship: Relationship }>(`/network/relationship/${accountId}`),

  follow: (companyId: string) => api.post<{ following: boolean }>(`/network/follows/${companyId}`),

  unfollow: (companyId: string) =>
    api.delete<{ following: boolean }>(`/network/follows/${companyId}`),

  block: (accountId: string) => api.post<{ blocked: boolean }>(`/network/blocks/${accountId}`),

  report: (input: {
    targetType: 'listing' | 'message' | 'post' | 'profile' | 'company';
    targetId: string;
    reason: string;
    detail?: string;
  }) => api.post<{ id: string; severity: string; message: string }>('/network/reports', input),
};
