import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  Clock,
  Flag,
  GraduationCap,
  Link2,
  Lock,
  MapPin,
  MessageSquare,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { PersonSummary, PublicProfile } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingScreen } from '@/components/ui/feedback';
import { ImageLightbox } from '@/components/ui/media-lightbox';
import { ReportDialog } from '@/components/ui/report-dialog';
import { cn } from '@/lib/cn';
import { compactCount, monthYear } from '@/lib/format';
import { messagingApi, networkApi, profileApiClient, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { ProfilePosts } from './profile-posts';

type Tab = 'about' | 'posts';

/**
 * Someone else's profile — FR-1001, reached by tapping a name or avatar
 * anywhere in the app.
 *
 * Every viewer-relative decision (connect vs pending vs message, follow state,
 * FR-1105 visibility) is resolved server-side and arrives with the payload, so
 * this screen renders one shape and never has to guess which button is correct.
 */
export function PublicProfileScreen() {
  const { accountId = '' } = useParams();
  const { account } = useSession();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);
  const [tab, setTab] = useState<Tab>('about');
  const [reporting, setReporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.publicProfile(accountId),
    queryFn: () => profileApiClient.getPublic(accountId),
    enabled: Boolean(accountId),
  });

  // Your own profile is the editable one — no point rendering a read-only copy.
  if (account && accountId === account.id) return <Navigate to="/profile" replace />;

  if (isLoading) return <LoadingScreen message="Loading profile…" />;

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="panel">
          <EmptyState
            icon={<UserPlus />}
            title="Profile not available"
            description={
              error instanceof ApiRequestError
                ? error.message
                : 'This person may have left InternLink.'
            }
            action={
              <Button size="sm" variant="outline" onClick={() => navigate(-1)}>
                Go back
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const { person, profile, company, stats } = data;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </button>

      <article className="panel overflow-hidden">
        <div className="h-28 overflow-hidden sm:h-36">
          {person.bannerUrl ? (
            <button
              type="button"
              onClick={() => setViewing({ src: person.bannerUrl!, alt: 'Cover image' })}
              className="block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <img src={person.bannerUrl} alt="" className="size-full object-cover" />
            </button>
          ) : (
            <div className="size-full bg-[linear-gradient(115deg,var(--color-violet-600),var(--color-violet-800))]" />
          )}
        </div>

        <div className="px-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                person.photoUrl &&
                setViewing({ src: person.photoUrl, alt: `${person.displayName}'s photo` })
              }
              disabled={!person.photoUrl}
              aria-label={person.photoUrl ? 'View profile photo' : undefined}
              className="-mt-9 inline-block cursor-zoom-in rounded-full ring-4 ring-[var(--bg-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-default"
            >
              <Avatar
                name={person.displayName}
                src={person.photoUrl}
                size="lg"
                verified={person.isVerified}
              />
            </button>

            <button
              type="button"
              onClick={() => setReporting(true)}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-fg-subtle transition-colors hover:bg-danger-subtle hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Flag aria-hidden="true" className="size-3.5" />
              Report
            </button>
          </div>

          <h1 className="mt-3 text-xl font-bold tracking-tight">{person.displayName}</h1>

          {person.headline && <p className="mt-1 text-sm text-fg-muted">{person.headline}</p>}

          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-subtle">
            <li className="flex items-center gap-1.5 capitalize">
              {person.activeRole === 'intern' ? (
                <GraduationCap aria-hidden="true" className="size-4" />
              ) : (
                <Briefcase aria-hidden="true" className="size-4" />
              )}
              {person.activeRole}
            </li>
            {company && (
              <li className="flex items-center gap-1.5">
                <Building2 aria-hidden="true" className="size-4" />
                {company.name}
              </li>
            )}
            {(profile?.location ?? person.location) && (
              <li className="flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                {profile?.location ?? person.location}
              </li>
            )}
            {profile?.school && (
              <li className="flex items-center gap-1.5">
                <GraduationCap aria-hidden="true" className="size-4" />
                {profile.school}
              </li>
            )}
            {/* "Been here since March 2024" is a trust signal on a marketplace
                where a brand-new account is the shape most scams take. */}
            <li className="flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-4" />
              Joined {monthYear(data.joinedAt)}
            </li>
          </ul>

          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="followers" value={stats.followers} />
            <Stat label="following" value={stats.following} />
            <Stat label="connections" value={stats.connections} />
            <Stat label="posts" value={stats.posts} />
          </dl>

          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
            {person.mutualConnections > 0 && (
              <span>
                {person.mutualConnections} mutual{' '}
                {person.mutualConnections === 1 ? 'connection' : 'connections'}
              </span>
            )}
            {person.followsYou && (
              <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-medium text-fg-muted">
                Follows you
              </span>
            )}
          </p>

          <ProfileActions person={person} />
        </div>
      </article>

      <div
        role="tablist"
        aria-label="Profile sections"
        className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1"
      >
        {(
          [
            { id: 'about', label: 'About' },
            { id: 'posts', label: `Posts${stats.posts > 0 ? ` · ${stats.posts}` : ''}` },
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'h-9 flex-1 cursor-pointer rounded-lg text-sm font-medium transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              tab === entry.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <ProfilePosts
          accountId={person.id}
          viewerId={account?.id ?? ''}
          emptyTitle={`${person.displayName} has not posted yet`}
          emptyDescription="When they share an update, it will show up here."
        />
      ) : (
        <AboutTab data={data} />
      )}

      {viewing && (
        <ImageLightbox src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}

      {reporting && (
        <ReportDialog
          targetType="profile"
          targetId={person.id}
          subject={`${person.displayName}’s profile`}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}

function AboutTab({ data }: { data: PublicProfile }) {
  const { profile } = data;

  const isEmpty =
    !data.profileHiddenReason &&
    !profile?.about &&
    !profile?.skills.length &&
    !profile?.experience.length &&
    !profile?.education.length &&
    !profile?.portfolioLinks.length;

  return (
    <>
      {data.profileHiddenReason && (
        <section className="panel mt-4 flex items-start gap-3 p-5">
          <Lock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
          <div>
            <h2 className="text-sm font-semibold text-fg">This profile is private</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {data.profileHiddenReason === 'connections_only'
                ? 'Only their connections can see the full profile. Send a request to see more.'
                : 'Only recruiters can see the full profile.'}
            </p>
          </div>
        </section>
      )}

      {isEmpty && (
        <div className="panel mt-4">
          <EmptyState
            icon={<Briefcase />}
            title="Nothing here yet"
            description="This profile has not been filled in."
          />
        </div>
      )}

      {profile?.about && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">About</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
            {profile.about}
          </p>
        </section>
      )}

      {profile && profile.skills.length > 0 && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-2.5 text-sm font-semibold text-fg">Skills</h2>
          <ul className="flex flex-wrap gap-1.5">
            {profile.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-lg bg-brand-subtle px-2.5 py-1 text-sm font-medium text-brand-fg"
              >
                {skill}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && profile.experience.length > 0 && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Experience</h2>
          <ul className="flex flex-col gap-4">
            {profile.experience.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
                  <Briefcase aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{entry.title}</p>
                  <p className="text-sm text-fg-muted">{entry.company}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                    <Clock aria-hidden="true" className="size-3" />
                    {entry.startDate} — {entry.isCurrent ? 'Present' : (entry.endDate ?? 'Present')}
                  </p>
                  {entry.description && (
                    <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
                      {entry.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && profile.education.length > 0 && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Education</h2>
          <ul className="flex flex-col gap-4">
            {profile.education.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
                  <GraduationCap aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{entry.school}</p>
                  {(entry.degree || entry.fieldOfStudy) && (
                    <p className="text-sm text-fg-muted">
                      {[entry.degree, entry.fieldOfStudy].filter(Boolean).join(', ')}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-fg-subtle tabular-nums">
                    {entry.startYear} — {entry.endYear ?? 'Present'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && profile.portfolioLinks.length > 0 && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-2.5 text-sm font-semibold text-fg">Links</h2>
          <ul className="flex flex-col gap-1.5">
            {profile.portfolioLinks.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <Link2 aria-hidden="true" className="size-4" />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-semibold text-fg tabular-nums">{compactCount(value)}</dd>
      <span aria-hidden="true" className="text-sm text-fg-subtle">
        {label}
      </span>
    </div>
  );
}

/**
 * Connect, Follow and Message.
 *
 * Connect and Follow are deliberately separate controls: connecting is mutual,
 * needs approval and unlocks messaging; following is one-sided and instant.
 * Collapsing them into one button would mean every "I just want their posts"
 * became a request someone else has to action.
 */
function ProfileActions({ person }: { person: PersonSummary }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.publicProfile(person.id) });
    void queryClient.invalidateQueries({ queryKey: ['network'] });
  }

  const connect = useMutation({
    mutationFn: () => networkApi.connect(person.id),
    onSuccess: () => {
      refresh();
      toast.success('Request sent', `${person.displayName} will see it in their requests.`);
    },
    onError: (error) => {
      toast.error(
        'Could not send that request',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const accept = useMutation({
    mutationFn: () => networkApi.respond(person.connectionId!, true),
    onSuccess: () => {
      refresh();
      toast.success('Connected');
    },
    onError: () => toast.error('Could not accept that request'),
  });

  const toggleFollow = useMutation({
    mutationFn: () =>
      person.isFollowing
        ? networkApi.unfollowAccount(person.id)
        : networkApi.followAccount(person.id),
    onSuccess: (result) => {
      refresh();
      if (person.isFollowing) {
        toast.success(`Unfollowed ${person.displayName}`);
        return;
      }
      const mutual = 'mutual' in result && result.mutual;
      toast.success(
        mutual
          ? `You and ${person.displayName} now follow each other`
          : `Following ${person.displayName}`,
        mutual ? 'Their posts will show up in your feed.' : undefined,
      );
    },
    onError: () => toast.error('Could not change that'),
  });

  const message = useMutation({
    mutationFn: () =>
      messagingApi.startThread({ recipientId: person.id, body: 'Hi — good to connect.' }),
    onSuccess: (result) => navigate(`/messages/${result.thread.id}`),
    onError: (error) => {
      toast.error(
        'Could not open a conversation',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  // "Follow back" is a materially easier decision than "Follow", and naming it
  // is the difference between a prompt and a chore.
  const followLabel = person.isFollowing
    ? 'Following'
    : person.followsYou
      ? 'Follow back'
      : 'Follow';

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {person.relationship === 'connected' && (
        <Button size="sm" variant="outline" leftIcon={<UserCheck />} disabled>
          Connected
        </Button>
      )}

      {person.relationship === 'pending_outgoing' && (
        <Button size="sm" variant="outline" leftIcon={<Clock />} disabled>
          Request sent
        </Button>
      )}

      {person.relationship === 'pending_incoming' && person.connectionId && (
        <Button
          size="sm"
          leftIcon={<Check />}
          isLoading={accept.isPending}
          onClick={() => accept.mutate()}
        >
          Accept request
        </Button>
      )}

      {(person.relationship === 'none' || person.relationship === 'second_degree') && (
        <Button
          size="sm"
          leftIcon={<UserPlus />}
          isLoading={connect.isPending}
          onClick={() => connect.mutate()}
        >
          Connect
        </Button>
      )}

      <Button
        size="sm"
        variant={person.isFollowing ? 'outline' : 'secondary'}
        isLoading={toggleFollow.isPending}
        onClick={() => toggleFollow.mutate()}
      >
        {followLabel}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        leftIcon={<MessageSquare />}
        isLoading={message.isPending}
        onClick={() => message.mutate()}
      >
        Message
      </Button>
    </div>
  );
}
