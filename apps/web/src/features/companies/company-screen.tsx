import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Building2,
  Globe,
  MapPin,
  Pencil,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { CompanyProfile } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, LoadingScreen } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { isCompanyVerified } from '@/lib/verification';
import { compactCount, relativeTime } from '@/lib/format';
import { companiesApi, networkApi, queryKeys } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

type Tab = 'about' | 'roles' | 'posts' | 'people';

/**
 * FR-1008 — a company's public page.
 *
 * The follow button was already wired to the API before this screen existed;
 * there was simply nowhere to press it. Everything viewer-relative — following
 * state, whether this person may edit — arrives resolved with the payload, so
 * the screen renders one shape without a second request.
 */
export function CompanyScreen() {
  const { companyId = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('about');
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.company(companyId),
    queryFn: () => companiesApi.get(companyId),
    enabled: Boolean(companyId),
  });

  if (isLoading) return <LoadingScreen message="Loading company…" />;

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="panel">
          <EmptyState
            icon={<Building2 />}
            title="Company not available"
            description={
              error instanceof ApiRequestError ? error.message : 'This page may have been removed.'
            }
            action={
              <Button size="sm" variant="outline" onClick={() => navigate('/companies')}>
                Browse companies
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const { company, canEdit } = data;
  const isVerified = isCompanyVerified(company);

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
        <div className="h-24 bg-[linear-gradient(115deg,var(--color-violet-600),var(--color-violet-800))]" />

        <div className="px-5 pb-5">
          <span className="-mt-9 inline-block rounded-xl ring-4 ring-[var(--bg-surface)]">
            <Avatar name={company.name} src={company.logoUrl} size="lg" shape="rounded" />
          </span>

          <h1 className="mt-3 flex items-center gap-2 text-xl font-bold tracking-tight">
            {company.name}
            {isVerified && (
              <BadgeCheck
                aria-label="Verified company"
                role="img"
                className="size-5 text-success"
                strokeWidth={2.5}
              />
            )}
          </h1>

          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-subtle">
            {company.industry && (
              <li className="flex items-center gap-1.5">
                <Briefcase aria-hidden="true" className="size-4" />
                {company.industry}
              </li>
            )}
            {company.headquarters && (
              <li className="flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                {company.headquarters}
              </li>
            )}
            {company.sizeBand && (
              <li className="flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-4" />
                {company.sizeBand} people
              </li>
            )}
            {company.website && (
              <li>
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <Globe aria-hidden="true" className="size-4" />
                  Website
                </a>
              </li>
            )}
          </ul>

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="followers" value={data.followerCount} />
            <Stat label="open roles" value={data.openRoleCount} />
          </dl>

          {/* FR-302 — an unverified employer cannot publish, and a candidate
              deserves to know that before they invest in an application. */}
          {!isVerified && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-xs text-fg-muted">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              This employer has not completed verification yet.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <FollowButton companyId={company.id} isFollowing={data.isFollowing} />
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Pencil />}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? 'Cancel' : 'Edit page'}
              </Button>
            )}
          </div>
        </div>
      </article>

      {canEdit && editing && (
        <CompanyEditor profile={data} onDone={() => setEditing(false)} />
      )}

      <div
        role="tablist"
        aria-label="Company sections"
        className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1"
      >
        {(
          [
            { id: 'about', label: 'About' },
            { id: 'roles', label: 'Roles' },
            { id: 'posts', label: 'Posts' },
            { id: 'people', label: 'People' },
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

      {tab === 'about' && (
        <section className="panel mt-4 p-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">About</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
            {company.description || 'This company has not written an About section yet.'}
          </p>
        </section>
      )}

      {tab === 'roles' && <CompanyRoles companyId={company.id} />}
      {tab === 'posts' && <CompanyPosts companyId={company.id} />}

      {tab === 'people' && (
        <section className="mt-4 flex flex-col gap-2">
          {data.people.length === 0 && (
            <div className="panel">
              <EmptyState
                icon={<Users />}
                title="Nobody listed yet"
                description="Recruiters at this company will appear here."
              />
            </div>
          )}
          {data.people.map((person) => (
            <Link
              key={person.id}
              to={`/u/${person.id}`}
              className="panel group flex items-center gap-3 p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Avatar
                name={person.displayName}
                src={person.photoUrl}
                size="md"
                verified={person.isVerified}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg group-hover:underline">
                  {person.displayName}
                </p>
                <p className="truncate text-xs text-fg-subtle">
                  {person.headline ?? 'Recruiter'}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
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

function FollowButton({ companyId, isFollowing }: { companyId: string; isFollowing: boolean }) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () =>
      isFollowing ? networkApi.unfollow(companyId) : networkApi.follow(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.company(companyId) });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
      void queryClient.invalidateQueries({ queryKey: ['network'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast.success(isFollowing ? 'Unfollowed' : 'Following', 'Their posts will show in your feed.');
    },
    onError: () => toast.error('Could not change that'),
  });

  return (
    <Button
      size="sm"
      variant={isFollowing ? 'outline' : 'primary'}
      isLoading={toggle.isPending}
      onClick={() => toggle.mutate()}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  );
}

function CompanyRoles({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.companyListings(companyId),
    queryFn: () => companiesApi.listings(companyId),
  });

  if (isLoading) return <div className="skeleton mt-4 h-24 w-full rounded-2xl" />;

  if ((data?.items.length ?? 0) === 0) {
    return (
      <div className="panel mt-4">
        <EmptyState
          icon={<Briefcase />}
          title="No open roles"
          description="Follow this company to hear when they post one."
        />
      </div>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {data?.items.map((listing) => (
        <li key={listing.id}>
          <Link
            to={`/roles/${listing.id}`}
            className="panel group block p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <p className="text-sm font-semibold text-fg group-hover:underline">{listing.title}</p>
            <p className="mt-0.5 text-xs text-fg-subtle capitalize">
              {listing.workMode}
              {listing.location ? ` · ${listing.location}` : ''}
              {listing.publishedAt ? ` · ${relativeTime(listing.publishedAt)}` : ''}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CompanyPosts({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.companyPosts(companyId),
    queryFn: () => companiesApi.posts(companyId),
  });

  if (isLoading) return <div className="skeleton mt-4 h-24 w-full rounded-2xl" />;

  if ((data?.items.length ?? 0) === 0) {
    return (
      <div className="panel mt-4">
        <EmptyState
          icon={<Building2 />}
          title="No posts yet"
          description="Updates this company shares will appear here."
        />
      </div>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {data?.items.map((post) => (
        <li key={post.id}>
          <Link
            to={`/p/${post.id}`}
            className="panel group block p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <p className="line-clamp-3 text-sm whitespace-pre-wrap text-fg group-hover:underline">
              {post.body || 'Shared media'}
            </p>
            <p className="mt-1.5 text-2xs text-fg-faint">{relativeTime(post.createdAt)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** FR-306 — owners and hiring managers may edit; viewers may not. */
function CompanyEditor({ profile, onDone }: { profile: CompanyProfile; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { company } = profile;

  const [description, setDescription] = useState(company.description ?? '');
  const [industry, setIndustry] = useState(company.industry ?? '');
  const [headquarters, setHeadquarters] = useState(company.headquarters ?? '');
  const [website, setWebsite] = useState(company.website ?? '');
  const [sizeBand, setSizeBand] = useState(company.sizeBand ?? '');

  const save = useMutation({
    mutationFn: () =>
      companiesApi.update(company.id, {
        description: description || null,
        industry: industry || null,
        headquarters: headquarters || null,
        website: website || null,
        sizeBand: (sizeBand || null) as CompanyProfile['company']['sizeBand'],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.company(company.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast.success('Company page updated');
      onDone();
    },
    onError: (error) => {
      toast.error(
        'Could not save',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  return (
    <section className="panel mt-4 flex flex-col gap-4 p-5">
      <Field label="About" hint="What the company does, and what an intern would work on.">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={4000}
        />
      </Field>

      <Field label="Industry">
        <Input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={80} />
      </Field>

      <Field label="Headquarters">
        <Input
          value={headquarters}
          onChange={(e) => setHeadquarters(e.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label="Website" hint="Include https://">
        <Input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://example.com"
        />
      </Field>

      <Field label="Company size">
        <Select value={sizeBand} onChange={(e) => setSizeBand(e.target.value as typeof sizeBand)}>
          <option value="">Not set</option>
          {(['1-10', '11-50', '51-200', '201-1000', '1000+'] as const).map((band) => (
            <option key={band} value={band}>
              {band} people
            </option>
          ))}
        </Select>
      </Field>

      <Button onClick={() => save.mutate()} isLoading={save.isPending} className="self-start">
        Save changes
      </Button>
    </section>
  );
}
