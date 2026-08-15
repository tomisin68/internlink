import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, FileText, Search } from 'lucide-react';
import {
  APPLICATION_PIPELINE,
  type ApplicationPublic,
  type ApplicationStatus,
} from '@internlink/shared-types';
import { LinkButton } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { applicationsApi, queryKeys } from '@/lib/api-endpoints';

/**
 * FR-402 — the intern's side of the pipeline.
 *
 * Rendered as a progress track rather than a status word, because "Reviewed"
 * on its own tells a candidate nothing about how far through they are. The
 * track makes the remaining distance obvious at a glance.
 */
const STATUS_COPY: Record<ApplicationStatus, { label: string; blurb: string }> = {
  applied: { label: 'Applied', blurb: 'Sent — waiting for the company to look.' },
  reviewed: { label: 'Reviewed', blurb: 'They have read your application.' },
  interview: { label: 'Interview', blurb: 'You are being interviewed.' },
  offer: { label: 'Offer', blurb: 'They want to hire you.' },
  rejected: { label: 'Not this time', blurb: 'They went another way on this one.' },
};

export function ApplicationsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.myApplications,
    queryFn: applicationsApi.mine,
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Every role you have applied to, and exactly where each one stands.
        </p>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-32 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<FileText />}
            title="No applications yet"
            description="When you apply to a role it appears here, and updates as the company moves you along."
            action={
              <LinkButton to="/matches" variant="secondary" leftIcon={<Search />}>
                See your matches
              </LinkButton>
            }
          />
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {data?.items.map((application, index) => (
          <ApplicationCard key={application.id} application={application} index={index} />
        ))}
      </ul>
    </div>
  );
}

function ApplicationCard({
  application,
  index,
}: {
  application: ApplicationPublic;
  index: number;
}) {
  const isRejected = application.status === 'rejected';
  const currentIndex = APPLICATION_PIPELINE.indexOf(application.status);
  const copy = STATUS_COPY[application.status];

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.04, 0.2) }}
      className="panel p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/roles/${application.listingId}`}
            className="text-base font-semibold text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            View the role
          </Link>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Applied {relativeTime(application.createdAt)}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
            isRejected
              ? 'bg-surface-sunken text-fg-muted'
              : application.status === 'offer'
                ? 'bg-success-subtle text-success-fg'
                : 'bg-brand-subtle text-brand-fg',
          )}
        >
          {copy.label}
        </span>
      </div>

      {isRejected ? (
        <p className="mt-3 text-sm text-fg-muted">{copy.blurb}</p>
      ) : (
        <>
          <ol className="mt-4 flex items-center gap-1" aria-label="Application progress">
            {APPLICATION_PIPELINE.map((stage, i) => {
              const done = i <= currentIndex;
              return (
                <li key={stage} className="flex flex-1 flex-col gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 rounded-full transition-colors duration-500',
                      done ? 'bg-brand' : 'bg-border-default',
                    )}
                  />
                  <span
                    className={cn(
                      'flex items-center gap-1 text-2xs font-medium capitalize',
                      done ? 'text-brand-fg' : 'text-fg-faint',
                    )}
                  >
                    {i < currentIndex && (
                      <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                    )}
                    {STATUS_COPY[stage].label}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-sm text-fg-muted">{copy.blurb}</p>
        </>
      )}
    </motion.li>
  );
}
