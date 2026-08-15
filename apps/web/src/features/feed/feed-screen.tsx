import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Bookmark, Compass, Hash, Send } from 'lucide-react';
import type { PostMedia } from '@internlink/shared-types';
import { extractHashtags } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button, LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { MediaPicker } from '@/components/ui/media-picker';
import { MentionInput } from '@/components/ui/mention-input';
import { TagInput } from '@/components/ui/tag-input';
import { cn } from '@/lib/cn';
import { feedApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { PostList } from './post-card';

type Scope = 'for_you' | 'following' | 'saved';

const TABS: Array<{ id: Scope; label: string }> = [
  { id: 'for_you', label: 'For you' },
  { id: 'following', label: 'Following' },
  { id: 'saved', label: 'Saved' },
];

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id));

const EMPTY_COPY: Record<Scope, { title: string; description: string }> = {
  for_you: {
    title: 'Your feed is empty',
    description: 'Be the first to post something — or find a few people to follow.',
  },
  following: {
    title: 'Nothing from your network yet',
    description: 'Follow a few people and companies, and their updates will appear here.',
  },
  saved: {
    title: 'Nothing saved yet',
    description: 'Tap the bookmark on any post and it will be waiting for you here.',
  },
};

export function FeedScreen() {
  // Seeded from the URL so "Saved posts" elsewhere in the app can link straight
  // to the tab. It is state after that — switching tabs is not a navigation.
  const [params] = useSearchParams();
  const [scope, setScope] = useState<Scope>(() => {
    const requested = params.get('scope');
    return TAB_IDS.has(requested ?? '') ? (requested as Scope) : 'for_you';
  });
  const { account } = useSession();

  const cacheKey = queryKeys.feed(scope);
  const { data, isLoading } = useQuery({
    queryKey: cacheKey,
    queryFn: () => feedApi.getFeed({ scope }),
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Feed</h1>
        <div
          role="tablist"
          aria-label="Feed scope"
          className="mt-3 flex gap-1 rounded-xl bg-surface-sunken p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={scope === tab.id}
              onClick={() => setScope(tab.id)}
              className={cn(
                'flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-[160ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                scope === tab.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
              )}
            >
              {tab.id === 'saved' && <Bookmark aria-hidden="true" className="size-3.5" />}
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Saved is a shortlist you read, not a place you write from. */}
      {scope !== 'saved' && <Composer />}

      {isLoading && (
        <div className="mt-5 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-40 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel mt-5">
          <EmptyState
            icon={scope === 'saved' ? <Bookmark /> : <Compass />}
            title={EMPTY_COPY[scope].title}
            description={EMPTY_COPY[scope].description}
            action={
              scope === 'saved' ? (
                <Button size="sm" variant="outline" onClick={() => setScope('for_you')}>
                  Back to your feed
                </Button>
              ) : (
                <LinkButton to="/network" size="sm" variant="outline">
                  Find people
                </LinkButton>
              )
            }
          />
        </div>
      )}

      <div className="mt-5">
        <PostList
          items={data?.items ?? []}
          viewerId={account?.id ?? ''}
          cacheKey={cacheKey}
          // On the saved list "Popular on InternLink" is not why the post is
          // there — you put it there.
          showReason={scope !== 'saved'}
        />
      </div>
    </div>
  );
}

function Composer() {
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [asCompany, setAsCompany] = useState(false);
  const [allowResharing, setAllowResharing] = useState(true);
  const { account, company } = useSession();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      feedApi.createPost({
        kind: 'update',
        body: body.trim(),
        media,
        tags,
        // The server re-derives who was really tagged from the body; sending an
        // empty list keeps the client from pretending to be the authority.
        mentions: [],
        asCompany,
        allowResharing,
      }),
    onSuccess: () => {
      setBody('');
      setMedia([]);
      setTags([]);
      setShowTags(false);
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success('Posted');
    },
    onError: (error) => {
      toast.error(
        'Could not post',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  if (!account) return null;
  const canPostAsCompany = account.activeRole === 'recruiter' && Boolean(company);
  // A photo with no caption is a perfectly ordinary post.
  const canSubmit = Boolean(body.trim()) || media.length > 0;

  // Hashtags typed straight into the caption count. Showing them back as chips
  // is what makes that discoverable — otherwise the tag field looks like the
  // only way in, and people add the same tag twice.
  const inlineTags = extractHashtags(body);
  const allTags = [...new Set([...tags, ...inlineTags])];

  function submit(): void {
    if (canSubmit && !create.isPending) create.mutate();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="panel p-4"
    >
      <div className="flex gap-3">
        <Avatar
          name={asCompany && company ? company.name : account.displayName}
          src={asCompany && company ? company.logoUrl : account.photoUrl}
          size="sm"
          shape={asCompany ? 'rounded' : 'circle'}
        />
        <MentionInput
          value={body}
          onChange={setBody}
          rows={2}
          maxLength={3000}
          disabled={create.isPending}
          onSubmit={submit}
          placeholder="Share an update, tag someone with @, add a #topic…"
          aria-label="Write a post"
          className="min-h-11 w-full resize-none bg-transparent py-2 text-base placeholder:text-fg-faint focus:outline-none"
        />
      </div>

      <MediaPicker value={media} onChange={setMedia} disabled={create.isPending} />

      {showTags && (
        <div className="mt-3">
          <TagInput
            value={tags}
            onChange={setTags}
            max={12}
            placeholder="Add a topic and press Enter"
          />
        </div>
      )}

      {allTags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <li
              key={tag}
              className="rounded-lg bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-fg"
            >
              #{tag}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-3">
        <button
          type="button"
          onClick={() => setShowTags((v) => !v)}
          aria-expanded={showTags}
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <Hash aria-hidden="true" className="size-4" />
          Topics
        </button>

        {canPostAsCompany && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={asCompany}
              onChange={(e) => setAsCompany(e.target.checked)}
              className="size-4 cursor-pointer accent-[var(--brand)]"
            />
            Post as {company?.name}
          </label>
        )}

        {/* FR-1007 — the author decides whether their post can travel. Set at
            composition time, and changeable later from the post's own menu. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={allowResharing}
            onChange={(e) => setAllowResharing(e.target.checked)}
            className="size-4 cursor-pointer accent-[var(--brand)]"
          />
          Allow resharing
        </label>

        <span className="ml-auto text-xs text-fg-faint tabular-nums">{body.length}/3000</span>

        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          isLoading={create.isPending}
          rightIcon={<Send />}
        >
          Post
        </Button>
      </div>
    </form>
  );
}
