import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, Ban, Check, Clock, Shield, ShieldOff, Trash2 } from 'lucide-react';
import type { ModerationAction, ModerationFlagView } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { adminApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

type Status = 'open' | 'actioned' | 'dismissed';

/**
 * §9.3 — the moderation queue.
 *
 * Guarded here for the sake of the UI only; the API refuses every one of these
 * routes without the `admin` role claim, and the Firestore rules refuse client
 * reads of the flag collection outright. Hiding a screen is not access control.
 */
export function ModerationScreen() {
  const { account } = useSession();
  const [status, setStatus] = useState<Status>('open');

  const { data: stats } = useQuery({
    queryKey: queryKeys.moderationStats,
    queryFn: adminApi.stats,
    refetchInterval: 60_000,
    enabled: account?.activeRole === 'admin',
  });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.moderationQueue(status),
    queryFn: () => adminApi.queue(status),
    enabled: account?.activeRole === 'admin',
  });

  if (account && account.activeRole !== 'admin') return <Navigate to="/home" replace />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Shield aria-hidden="true" className="size-6 text-brand" />
          Moderation
        </h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Critical first, then oldest. Scam and fraud outrank conduct regardless of where they were
          reported.
        </p>

        {stats && (
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Open" value={String(stats.open)} />
            <StatTile label="Critical" value={String(stats.critical)} tone={stats.critical > 0 ? 'danger' : 'default'} />
            <StatTile label="Actioned today" value={String(stats.actionedToday)} />
            <StatTile
              label="Oldest open"
              value={stats.oldestOpenHours > 0 ? `${stats.oldestOpenHours}h` : '—'}
              // §9.3 targets a same-day response on critical reports; a queue
              // aging past a day is the number that should look wrong.
              tone={stats.oldestOpenHours > 24 ? 'danger' : 'default'}
            />
          </dl>
        )}

        <div
          role="tablist"
          aria-label="Queue"
          className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1"
        >
          {(
            [
              { id: 'open', label: 'Open' },
              { id: 'actioned', label: 'Actioned' },
              { id: 'dismissed', label: 'Dismissed' },
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={status === entry.id}
              onClick={() => setStatus(entry.id)}
              className={cn(
                'h-9 flex-1 cursor-pointer rounded-lg text-sm font-medium transition-colors duration-[160ms]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                status === entry.id ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading && <div className="skeleton h-40 w-full rounded-2xl" />}

      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Check />}
            title={status === 'open' ? 'Queue is clear' : 'Nothing here'}
            description={
              status === 'open'
                ? 'No reports are waiting on a decision.'
                : 'Resolved reports will appear here.'
            }
          />
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {data?.items.map((entry) => (
          <FlagCard key={entry.flag.id} entry={entry} status={status} />
        ))}
      </ul>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="panel p-3">
      <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          tone === 'danger' ? 'text-danger-fg' : 'text-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-danger-subtle text-danger-fg',
  high: 'bg-warning-subtle text-warning-fg',
  normal: 'bg-surface-sunken text-fg-muted',
};

/**
 * The escalation ladder (FR-1107).
 *
 * Ordered least to most severe, and each action says what it does rather than
 * what it is called — "hides the post" is checkable against the content on
 * screen in a way that "remove_content" is not.
 */
const ACTIONS: Array<{
  id: ModerationAction;
  label: string;
  effect: string;
  icon: typeof Check;
  destructive?: boolean;
}> = [
  { id: 'dismiss', label: 'Dismiss', effect: 'No action. Closes the report.', icon: Check },
  { id: 'warn', label: 'Warn', effect: 'Records a warning. Nothing changes yet.', icon: AlertTriangle },
  {
    id: 'remove_content',
    label: 'Remove content',
    effect: 'Hides it from everyone but the author.',
    icon: Trash2,
    destructive: true,
  },
  {
    id: 'restrict_account',
    label: 'Restrict',
    effect: 'Caps what the account can do.',
    icon: ShieldOff,
    destructive: true,
  },
  {
    id: 'suspend_account',
    label: 'Suspend',
    effect: 'Signs them out and blocks access.',
    icon: ShieldOff,
    destructive: true,
  },
  { id: 'ban_account', label: 'Ban', effect: 'Permanent. Signs out every session.', icon: Ban, destructive: true },
];

function FlagCard({ entry, status }: { entry: ModerationFlagView; status: Status }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [note, setNote] = useState('');
  const { flag, target } = entry;

  const resolve = useMutation({
    mutationFn: () => adminApi.resolve(flag.id, { action: action!, note: note.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Report resolved');
    },
    onError: (error) => {
      toast.error(
        'Could not resolve that',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const selected = ACTIONS.find((a) => a.id === action);
  // §9.3 — anything beyond a dismissal is an action against a person and has to
  // carry a reason. The server enforces this too; the UI just says so first.
  const needsNote = Boolean(action && action !== 'dismiss');
  const canSubmit = Boolean(action) && (!needsNote || note.trim().length > 0);

  return (
    <li className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-2.5">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-2xs font-bold tracking-wide uppercase',
            SEVERITY_STYLE[flag.severity] ?? SEVERITY_STYLE.normal,
          )}
        >
          {flag.severity}
        </span>
        <span className="text-xs font-medium text-fg">{flag.reason.replace(/_/g, ' ')}</span>
        <span className="text-2xs text-fg-subtle">
          {flag.targetType} · {flag.source === 'auto_flag' ? 'auto-flagged' : 'reported'}
          {entry.reporterName ? ` by ${entry.reporterName}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-1 text-2xs text-fg-faint">
          <Clock aria-hidden="true" className="size-3" />
          {relativeTime(flag.createdAt)}
        </span>
      </header>

      <div className="p-4">
        {target ? (
          <>
            <p className="text-sm font-semibold text-fg">{target.title}</p>
            {target.body && (
              <p className="mt-1 line-clamp-6 text-sm whitespace-pre-wrap text-fg-muted">
                {target.body}
              </p>
            )}
            {target.mediaUrl && (
              <img
                src={target.mediaUrl}
                alt=""
                loading="lazy"
                className="mt-2 max-h-48 rounded-xl border border-border-subtle object-cover"
              />
            )}
            {target.authorId && (
              <Link
                to={`/u/${target.authorId}`}
                className="mt-2 inline-block text-xs text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                View {target.authorName ?? 'the author'}
              </Link>
            )}
          </>
        ) : (
          // Usually means the author deleted it after being reported — itself
          // a useful signal, so it is stated rather than left blank.
          <p className="text-sm text-fg-subtle">
            This content is no longer available. It may have been deleted since the report.
          </p>
        )}

        {flag.detail && (
          <p className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-fg-muted">
            <span className="font-semibold">Reason given:</span> {flag.detail}
          </p>
        )}

        {flag.matchedRules.length > 0 && (
          <p className="mt-2 text-2xs text-fg-faint">
            Matched rules: {flag.matchedRules.join(', ')}
          </p>
        )}
      </div>

      {status === 'open' && (
        <div className="border-t border-border-subtle p-4">
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.map((entryAction) => (
              <button
                key={entryAction.id}
                type="button"
                onClick={() => setAction(action === entryAction.id ? null : entryAction.id)}
                aria-pressed={action === entryAction.id}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors duration-[160ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  action === entryAction.id
                    ? entryAction.destructive
                      ? 'border-danger bg-danger-subtle text-danger-fg'
                      : 'border-brand bg-brand-subtle text-brand-fg'
                    : 'border-border-default text-fg-muted hover:bg-surface-sunken hover:text-fg',
                )}
              >
                <entryAction.icon aria-hidden="true" className="size-3.5" />
                {entryAction.label}
              </button>
            ))}
          </div>

          {selected && (
            <>
              <p className="mt-2.5 text-xs text-fg-subtle">{selected.effect}</p>

              <Field
                label="Moderator note"
                hint={
                  needsNote
                    ? 'Required. This is the record of why the action was taken.'
                    : 'Optional.'
                }
                className="mt-3"
              >
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={1000}
                />
              </Field>

              <Button
                size="sm"
                variant={selected.destructive ? 'danger' : 'primary'}
                className="mt-3"
                disabled={!canSubmit}
                isLoading={resolve.isPending}
                onClick={() => resolve.mutate()}
              >
                Apply {selected.label.toLowerCase()}
              </Button>
            </>
          )}
        </div>
      )}

      {status !== 'open' && flag.reviewedAt && (
        <p className="border-t border-border-subtle px-4 py-2.5 text-2xs text-fg-subtle">
          Resolved {relativeTime(flag.reviewedAt)}
        </p>
      )}
    </li>
  );
}
