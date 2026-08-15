import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  Flag,
  MapPin,
  Send,
  Timer,
  Users,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button, IconButton } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { relativeTime } from '@/lib/format';
import {
  applicationsApi,
  listingsApi,
  networkApi,
  queryKeys,
} from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

export function RoleDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { account } = useSession();
  const [coverNote, setCoverNote] = useState('');
  const [showApply, setShowApply] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.listing(id),
    queryFn: () => listingsApi.get(id),
    enabled: Boolean(id),
  });

  const { data: myApplications } = useQuery({
    queryKey: queryKeys.myApplications,
    queryFn: applicationsApi.mine,
    enabled: account?.activeRole === 'intern',
  });

  const apply = useMutation({
    mutationFn: () => applicationsApi.apply(id, coverNote),
    onSuccess: () => {
      setShowApply(false);
      setCoverNote('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.myApplications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matches });
      toast.success('Application sent', 'You can track it under Applications.');
    },
    onError: (error) => {
      toast.error(
        'Could not apply',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const report = useMutation({
    mutationFn: () =>
      networkApi.report({ targetType: 'listing', targetId: id, reason: 'scam_or_fraud' }),
    onSuccess: (result) => toast.success('Report received', result.message),
  });

  if (isLoading || !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
        <div className="skeleton h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const { listing, company } = data;
  const hasApplied = myApplications?.items.some((a) => a.listingId === listing.id) ?? false;
  const isIntern = account?.activeRole === 'intern';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </button>

      <article className="panel p-5">
        <header className="flex items-start gap-4">
          <Avatar
            name={company?.name ?? 'Company'}
            src={company?.logoUrl}
            size="lg"
            shape="rounded"
            verified={company?.verificationStatus === 'verified'}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-tight font-bold text-balance">{listing.title}</h1>
            <p className="mt-1 text-sm font-medium text-fg-muted">
              {company?.name ?? 'Unknown company'}
            </p>

            <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-subtle">
              <li className="flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                {listing.workMode === 'remote'
                  ? 'Remote'
                  : (listing.location ?? 'Location not stated')}
              </li>
              {listing.durationMonths && (
                <li className="flex items-center gap-1.5">
                  <Timer aria-hidden="true" className="size-4" />
                  {listing.durationMonths} months
                </li>
              )}
              <li className="flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-4" />
                {listing.applicationCount} applicant{listing.applicationCount === 1 ? '' : 's'}
              </li>
            </ul>
          </div>
        </header>

        {/* FR-704 — the verification badge is a trust signal, so it earns real
            estate rather than a small tick. Its absence is stated too. */}
        {company && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-sunken px-3.5 py-2.5">
            {company.verificationStatus === 'verified' ? (
              <>
                <BadgeCheck aria-hidden="true" className="size-4.5 shrink-0 text-success" />
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-success-fg">Verified company</span> — CAC
                  registration confirmed by our team.
                </p>
              </>
            ) : (
              <>
                <Building2 aria-hidden="true" className="size-4.5 shrink-0 text-warning" />
                <p className="text-sm text-fg-muted">
                  This company has not completed verification yet.
                </p>
              </>
            )}
          </div>
        )}

        {listing.skills.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-fg">Skills they are looking for</h2>
            <ul className="flex flex-wrap gap-1.5">
              {listing.skills.map((skill) => (
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

        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">About the role</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
            {listing.description}
          </p>
        </section>

        {listing.publishedAt && (
          <p className="mt-5 text-xs text-fg-faint">Posted {relativeTime(listing.publishedAt)}</p>
        )}
      </article>

      {/* §9.2 — the pay-to-play warning sits on every role, not just flagged
          ones. It costs nothing and it is the single most common scam here. */}
      <Alert variant="warning" className="mt-4">
        A legitimate employer will never ask you to pay for a job, an interview or
        &ldquo;processing&rdquo;. Report anyone who does.
      </Alert>

      {isIntern && (
        <div className="mt-5">
          {hasApplied ? (
            <div className="panel flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-subtle text-success-fg">
                <Check aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">You have applied</p>
                <p className="text-sm text-fg-muted">Track it under Applications.</p>
              </div>
            </div>
          ) : showApply ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                apply.mutate();
              }}
              className="panel p-4"
            >
              <label htmlFor="cover-note" className="mb-2 block text-sm font-medium text-fg">
                Add a note (optional)
              </label>
              <textarea
                id="cover-note"
                value={coverNote}
                onChange={(e) => setCoverNote(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Why this role, and what you would bring to it."
                className="w-full resize-y rounded-xl border border-border-default bg-surface px-3.5 py-3 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
              />
              <p className="mt-2 text-xs text-fg-subtle">
                Your profile and CV are sent automatically.
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="submit" isLoading={apply.isPending} rightIcon={<Send />}>
                  Send application
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowApply(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              {/* FR-401 — one tap from here to applied. */}
              <Button size="lg" onClick={() => setShowApply(true)} className="flex-1 sm:flex-none">
                Apply now
              </Button>
              <IconButton
                label="Report this listing"
                icon={<Flag />}
                variant="ghost"
                onClick={() => report.mutate()}
                isLoading={report.isPending}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
