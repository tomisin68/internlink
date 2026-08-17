import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  GraduationCap,
  LogOut,
  MapPin,
  Moon,
  Pencil,
  Shield,
  Sun,
  SunMoon,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { compactCount, longRelativeTime, monthYear } from '@/lib/format';
import { profileApiClient, queryKeys } from '@/lib/api-endpoints';
import { useSession, useSignOut } from '@/features/auth/use-auth';
import { useThemeStore } from '@/lib/stores';
import { CompletenessCard } from './completeness-card';
import { ProfileEditor } from './profile-editor';
import { ProfileHeaderEditor } from './profile-header-editor';
import { ProfilePosts } from './profile-posts';
import { InstallSettingsCard } from '@/components/layout/app-prompts';
import { NotificationSettings } from './notification-settings';

type Tab = 'profile' | 'posts' | 'views';

export function ProfileScreen() {
  const { account, internProfile, company } = useSession();
  const signOut = useSignOut();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');

  const { data: completeness } = useQuery({
    queryKey: queryKeys.completeness,
    queryFn: profileApiClient.completeness,
    enabled: account?.activeRole === 'intern' && Boolean(internProfile),
  });

  // The counts live outside the session payload because they change constantly
  // and the session is cached for the whole visit.
  const { data: stats } = useQuery({
    queryKey: queryKeys.profileStats,
    queryFn: profileApiClient.myStats,
    enabled: Boolean(account),
  });

  if (!account) return null;
  const isIntern = account.activeRole === 'intern';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <article className="panel overflow-hidden">
        <ProfileHeaderEditor account={account} />

        <div className="px-5 pb-5">
          <h1 className="mt-3 text-xl font-bold tracking-tight">{account.displayName}</h1>

          {isIntern && internProfile?.headline && (
            <p className="mt-1 text-sm text-fg-muted">{internProfile.headline}</p>
          )}

          {!isIntern && company && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <Building2 aria-hidden="true" className="size-4" />
              {company.name}
            </p>
          )}

          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-subtle">
            <li className="flex items-center gap-1.5 capitalize">
              {isIntern ? (
                <GraduationCap aria-hidden="true" className="size-4" />
              ) : (
                <Briefcase aria-hidden="true" className="size-4" />
              )}
              {account.activeRole}
            </li>
            {internProfile?.location && (
              <li className="flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                {internProfile.location}
              </li>
            )}
            {internProfile?.school && (
              <li className="flex items-center gap-1.5">
                <GraduationCap aria-hidden="true" className="size-4" />
                {internProfile.school}
              </li>
            )}
            <li className="flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-4" />
              Joined {monthYear(stats?.joinedAt ?? account.createdAt)}
            </li>
          </ul>

          {/* The same numbers everyone else sees on your profile. Their absence
              here was the odd part: you were the only person who could not. */}
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="followers" value={stats?.followers} />
            <Stat label="following" value={stats?.following} />
            <Stat label="connections" value={stats?.connections} />
            <Stat label="posts" value={stats?.posts} />
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {isIntern && internProfile && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={editing ? <Check /> : <Pencil />}
                onClick={() => {
                  setEditing((v) => !v);
                  setTab('profile');
                }}
              >
                {editing ? 'Done editing' : 'Edit profile'}
              </Button>
            )}
            <Link
              to={`/u/${account.id}`}
              className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Eye aria-hidden="true" className="size-4" />
              View as others see it
            </Link>
          </div>
        </div>
      </article>

      {!editing && (
        <div
          role="tablist"
          aria-label="Profile sections"
          className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1"
        >
          {(
            [
              { id: 'profile', label: 'Profile' },
              { id: 'posts', label: `Posts${stats?.posts ? ` · ${stats.posts}` : ''}` },
              { id: 'views', label: 'Viewers' },
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
      )}

      {editing && isIntern && internProfile && (
        <ProfileEditor profile={internProfile} onDone={() => setEditing(false)} />
      )}

      {!editing && tab === 'posts' && (
        <ProfilePosts
          accountId={account.id}
          viewerId={account.id}
          emptyTitle="You have not posted yet"
          emptyDescription="Share an update from your feed and it will show up here."
        />
      )}

      {!editing && tab === 'views' && <ProfileViewers />}

      {!editing && tab === 'profile' && (
        <>
          {/* FR-202 — what is missing, ranked by how much it matters. */}
          {isIntern && completeness && (
            <CompletenessCard
              score={completeness.score}
              missing={completeness.missing}
              // Every remaining item except the photo is edited in the panel
              // below, and the photo has its own control in the header.
              onAction={(key) => {
                if (key !== 'photo') setEditing(true);
              }}
            />
          )}

          {isIntern && internProfile && (
            <>
              {internProfile.about && (
                <section className="panel mt-4 p-5">
                  <h2 className="mb-2 text-sm font-semibold text-fg">About</h2>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
                    {internProfile.about}
                  </p>
                </section>
              )}

              {internProfile.skills.length > 0 && (
                <section className="panel mt-4 p-5">
                  <h2 className="mb-2.5 text-sm font-semibold text-fg">Skills</h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {internProfile.skills.map((skill) => (
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

              {internProfile.experience.length > 0 && (
                <section className="panel mt-4 p-5">
                  <h2 className="mb-3 text-sm font-semibold text-fg">Experience</h2>
                  <ul className="flex flex-col gap-4">
                    {internProfile.experience.map((entry) => (
                      <li key={entry.id} className="flex gap-3">
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
                          <Briefcase aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-fg">{entry.title}</p>
                          <p className="text-sm text-fg-muted">{entry.company}</p>
                          <p className="mt-0.5 text-xs text-fg-subtle">
                            {entry.startDate} —{' '}
                            {entry.isCurrent ? 'Present' : (entry.endDate ?? 'Present')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {internProfile.education.length > 0 && (
                <section className="panel mt-4 p-5">
                  <h2 className="mb-3 text-sm font-semibold text-fg">Education</h2>
                  <ul className="flex flex-col gap-4">
                    {internProfile.education.map((entry) => (
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

              {internProfile.cvUrl && (
                <section className="panel mt-4 p-5">
                  <h2 className="mb-2 text-sm font-semibold text-fg">CV</h2>
                  <a
                    href={internProfile.cvUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-fg underline-offset-4 hover:underline"
                  >
                    {internProfile.cvFileName ?? 'View your CV'}
                  </a>
                </section>
              )}

              {/* FR-1004 — visible to recruiters only, never broadcast. */}
              {internProfile.openToOpportunities && (
                <Alert variant="success" className="mt-4">
                  <span className="flex items-center gap-1.5">
                    <Eye aria-hidden="true" className="size-4" />
                    Open to opportunities — recruiters can see this; nobody else can.
                  </span>
                </Alert>
              )}
            </>
          )}

          {/* The bottom bar is capped at five destinations, so these live here
              on mobile. On desktop they are in the rail. */}
          <nav aria-label="More" className="panel mt-4 divide-y divide-border-subtle">
            <MoreLink to="/feed?scope=saved" icon={<Bookmark />} label="Saved posts" />
            <MoreLink to="/companies" icon={<Building2 />} label="Companies" />
            {account.activeRole === 'recruiter' && company && (
              <MoreLink to={`/c/${company.id}`} icon={<Building2 />} label="Your company page" />
            )}
            {account.activeRole === 'admin' && (
              <MoreLink to="/admin/moderation" icon={<Shield />} label="Moderation" />
            )}
          </nav>

          <NotificationSettings />
          <InstallSettingsCard />

          <SettingsPanel onSignOut={() => void signOut()} />
        </>
      )}
    </div>
  );
}

/**
 * FR-1001 — who looked at your profile.
 *
 * Names rather than a bare count, because "12 people viewed your profile" is a
 * number you can do nothing with, and the point of the feature is that one of
 * them might be worth messaging.
 */
function ProfileViewers() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.profileViews,
    queryFn: profileApiClient.myViews,
  });

  if (isLoading) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data || data.viewers.length === 0) {
    return (
      <div className="panel mt-4">
        <EmptyState
          icon={<Eye />}
          title="No profile views yet"
          description="When someone opens your profile, they will show up here."
        />
      </div>
    );
  }

  return (
    <section className="mt-4">
      <p className="mb-2 text-sm text-fg-muted">
        {data.total} {data.total === 1 ? 'person' : 'people'} in the last {data.windowDays} days.
      </p>
      <ul className="flex flex-col gap-2">
        {data.viewers.map((viewer) => (
          <li key={viewer.person.id}>
            <Link
              to={`/u/${viewer.person.id}`}
              className="panel flex items-center gap-3 p-3 transition-colors hover:border-brand-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Avatar
                name={viewer.person.displayName}
                src={viewer.person.photoUrl}
                size="md"
                verified={viewer.person.isVerified}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">
                  {viewer.person.displayName}
                </span>
                {viewer.person.headline && (
                  <span className="block truncate text-xs text-fg-subtle">
                    {viewer.person.headline}
                  </span>
                )}
                <span className="mt-0.5 block text-2xs text-fg-faint">
                  {longRelativeTime(viewer.viewedAt)}
                  {viewer.count > 1 && ` · ${viewer.count} times`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-semibold text-fg tabular-nums">
        {value === undefined ? '—' : compactCount(value)}
      </dd>
      <span aria-hidden="true" className="text-sm text-fg-subtle">
        {label}
      </span>
    </div>
  );
}

function MoreLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-fg transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      <span aria-hidden="true" className="text-fg-subtle [&>svg]:size-4.5">
        {icon}
      </span>
      {label}
      <ChevronRight aria-hidden="true" className="ml-auto size-4 text-fg-faint" />
    </Link>
  );
}

function SettingsPanel({ onSignOut }: { onSignOut: () => void }) {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: SunMoon },
  ] as const;

  return (
    <section className="panel mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">Appearance</h2>

      <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-xl bg-surface-sunken p-1">
        {options.map((option) => (
          <button
            key={option.value}
            role="radio"
            aria-checked={preference === option.value}
            onClick={() => setPreference(option.value)}
            className={cn(
              'flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              preference === option.value
                ? 'bg-surface text-fg shadow-xs'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <option.icon aria-hidden="true" className="size-4" />
            {option.label}
          </button>
        ))}
      </div>

      <Button variant="ghost" leftIcon={<LogOut />} onClick={onSignOut} className="mt-4 text-danger-fg">
        Sign out
      </Button>
    </section>
  );
}
