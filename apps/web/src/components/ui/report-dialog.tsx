import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Flag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { networkApi } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

/**
 * FR-702 — reporting a post, comment, profile or company.
 *
 * The reasons are the moderation queue's own enum rather than a free-text box.
 * §9.3 routes by severity, and it can only do that if the reporter picks from a
 * list the triage rules understand — "other" plus a paragraph is the fallback,
 * not the default.
 *
 * The confirmation says what happens next, because "Reported" on its own reads
 * as "and nothing will come of it", which is exactly the impression that stops
 * people reporting the second time.
 */

type Target = 'post' | 'comment' | 'profile' | 'company' | 'listing' | 'message';

const REASONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: 'scam_or_fraud',
    label: 'Scam or fraud',
    hint: 'A fake role, a fake company, or an attempt to take money.',
  },
  {
    value: 'asks_for_payment',
    label: 'Asks for payment',
    hint: 'A fee for an application, training, or a guaranteed placement.',
  },
  { value: 'impersonation', label: 'Impersonation', hint: 'Pretending to be someone else.' },
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Threats or abuse.' },
  {
    value: 'discrimination',
    label: 'Discrimination',
    hint: 'Excludes people by tribe, gender, religion or disability.',
  },
  {
    value: 'sexual_or_romantic',
    label: 'Sexual or romantic advances',
    hint: 'Unwanted advances in a professional context.',
  },
  { value: 'spam', label: 'Spam', hint: 'Repetitive, irrelevant or bulk content.' },
  {
    value: 'off_platform_data_request',
    label: 'Asks for personal data off-platform',
    hint: 'Bank details, BVN, or a move to WhatsApp before any process.',
  },
  { value: 'other', label: 'Something else', hint: 'Tell us what is wrong.' },
];

export function ReportDialog({
  targetType,
  targetId,
  parentId,
  subject,
  onClose,
}: {
  targetType: Target;
  targetId: string;
  /**
   * The post a comment belongs to, or the thread a message belongs to.
   *
   * Subcollection documents cannot be found from an ID alone, and a report the
   * moderator cannot read is a report that gets dismissed.
   */
  parentId?: string;
  /** What is being reported, in words — "Ada's post", "this company". */
  subject: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const submit = useMutation({
    mutationFn: () =>
      networkApi.report({
        targetType,
        targetId,
        parentId: parentId ?? null,
        reason: reason!,
        detail: detail.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success('Thanks for reporting', result.message);
      onClose();
    },
    onError: (error) => {
      toast.error(
        'Could not send that report',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Report ${subject}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(0_0_0_/_0.5)] p-0 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border-default bg-surface shadow-lg sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-border-subtle p-5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger-subtle text-danger-fg"
          >
            <Flag className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">Report {subject}</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Our team reviews every report. The person you are reporting is not told who sent it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">What is wrong?</legend>
            <ul className="flex flex-col gap-1">
              {REASONS.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={reason === option.value}
                    onClick={() => setReason(option.value)}
                    className={cn(
                      'w-full cursor-pointer rounded-xl border p-3 text-left transition-colors duration-[160ms]',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
                      reason === option.value
                        ? 'border-brand-border bg-brand-subtle'
                        : 'border-border-subtle hover:bg-surface-sunken',
                    )}
                  >
                    <span className="block text-sm font-medium text-fg">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-fg-subtle">{option.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>

          <Field
            label="Anything else?"
            hint="Optional, but it helps us act faster."
            className="mt-4"
            labelAccessory={
              <span className="text-xs text-fg-subtle tabular-nums">{detail.length}/1000</span>
            }
          >
            <Textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What happened?"
            />
          </Field>
        </div>

        <footer className="flex gap-2 border-t border-border-subtle p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
          <Button
            variant="danger"
            disabled={!reason}
            isLoading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Send report
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
