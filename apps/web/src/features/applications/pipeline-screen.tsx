import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, MessageSquare, Users } from 'lucide-react';
import {
  APPLICATION_PIPELINE,
  type Application,
  type ApplicationStatus,
} from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { applicationsApi, listingsApi, messagingApi, queryKeys } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

const STAGES: ApplicationStatus[] = [...APPLICATION_PIPELINE, 'rejected'];

const STAGE_LABEL: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  reviewed: 'Reviewed',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

/**
 * FR-403 — the recruiter's pipeline for one role.
 *
 * Grouped by stage as columns on desktop, stacked on mobile. Moving someone is
 * a single tap on the next stage rather than a dropdown: the whole job of this
 * screen is moving people along, and that should be the cheapest action on it.
 */
export function PipelineScreen() {
  const { listingId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: listingData } = useQuery({
    queryKey: queryKeys.listing(listingId),
    queryFn: () => listingsApi.get(listingId),
    enabled: Boolean(listingId),
  });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.pipeline(listingId),
    queryFn: () => applicationsApi.forListing(listingId),
    enabled: Boolean(listingId),
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus }) =>
      applicationsApi.setStatus(id, status),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline(listingId) });
      // FR-405 — the candidate is notified by the API, so say so. A recruiter
      // moving someone to "rejected" should know that lands as an email.
      toast.success(
        `Moved to ${STAGE_LABEL[variables.status]}`,
        'The candidate has been notified.',
      );
    },
    onError: (error) => {
      toast.error(
        'Could not move that candidate',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const byStage = STAGES.map((stage) => ({
    stage,
    items: (data?.items ?? []).filter((a) => a.status === stage),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-0">
      <button
        type="button"
        onClick={() => navigate('/roles')}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to roles
      </button>

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          {listingData?.listing.title ?? 'Pipeline'}
        </h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          {data?.items.length ?? 0} candidate{data?.items.length === 1 ? '' : 's'} · tap a stage to
          move someone
        </p>
      </header>

      {isLoading && <div className="skeleton h-64 w-full rounded-2xl" />}

      {!isLoading && data?.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Users />}
            title="No applicants yet"
            description="Once people apply they land here, and you can move them through the pipeline."
          />
        </div>
      )}

      {!isLoading && (data?.items.length ?? 0) > 0 && (
        <div className="grid gap-4 lg:grid-cols-5">
          {byStage.map(({ stage, items }) => (
            <section key={stage} className="min-w-0">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                {STAGE_LABEL[stage]}
                <span className="rounded-full bg-surface-sunken px-1.5 text-xs text-fg-muted tabular-nums">
                  {items.length}
                </span>
              </h2>

              <ul className="flex flex-col gap-2">
                {items.map((application) => (
                  <CandidateCard
                    key={application.id}
                    application={application}
                    onMove={(status) => move.mutate({ id: application.id, status })}
                    isMoving={move.isPending}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  application,
  onMove,
  isMoving,
}: {
  application: Application;
  onMove: (status: ApplicationStatus) => void;
  isMoving: boolean;
}) {
  const nextStages = STAGES.filter((s) => s !== application.status);

  return (
    <li className="panel p-3">
      <div className="flex items-start gap-2.5">
        <Avatar name={application.internAccountId} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">Candidate</p>
          <p className="text-2xs text-fg-subtle">{relativeTime(application.createdAt)}</p>
        </div>
      </div>

      {application.coverNote && (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-muted">
          {application.coverNote}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1">
        {application.cvUrl && (
          <a
            href={application.cvUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken px-2 py-1 text-2xs font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <FileText aria-hidden="true" className="size-3" />
            CV
          </a>
        )}
        <MessageCandidateButton accountId={application.internAccountId} />
      </div>

      {/* FR-404 — internal notes are recruiter-only. The API strips them from
          the intern's view; this is the one place they surface. */}
      {application.internalNotes.length > 0 && (
        <p className="mt-2 rounded-lg bg-warning-subtle px-2 py-1 text-2xs text-warning-fg">
          {application.internalNotes.length} private note
          {application.internalNotes.length === 1 ? '' : 's'}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1 border-t border-border-subtle pt-2.5">
        {nextStages.map((stage) => (
          <button
            key={stage}
            type="button"
            disabled={isMoving}
            onClick={() => onMove(stage)}
            className={cn(
              'cursor-pointer rounded-lg px-2 py-1 text-2xs font-medium transition-colors duration-[160ms] disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              stage === 'rejected'
                ? 'text-danger-fg hover:bg-danger-subtle'
                : 'text-brand-fg hover:bg-brand-subtle',
            )}
          >
            → {STAGE_LABEL[stage]}
          </button>
        ))}
      </div>
    </li>
  );
}

function MessageCandidateButton({ accountId }: { accountId: string }) {
  const navigate = useNavigate();

  const start = useMutation({
    mutationFn: () =>
      messagingApi.startThread({
        recipientId: accountId,
        body: 'Hi — thanks for applying. Do you have time for a quick chat this week?',
      }),
    onSuccess: (result) => navigate(`/messages/${result.thread.id}`),
    onError: () => toast.error('Could not open a conversation'),
  });

  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={<MessageSquare />}
      isLoading={start.isPending}
      onClick={() => start.mutate()}
      className="h-auto px-2 py-1 text-2xs"
    >
      Message
    </Button>
  );
}
