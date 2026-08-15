import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * How each completeness key from the API reads to a person, plus what it is
 * worth. The weights mirror `profiles.service.ts` — shown because "add three
 * skills, +18%" is a reason to act and "your profile is 62% complete" is not.
 */
const ITEMS: Record<string, { label: string; hint: string; weight: number }> = {
  name: { label: 'Add your full name', hint: 'Recruiters search by it', weight: 5 },
  photo: { label: 'Add a profile photo', hint: 'Profiles with one get noticed first', weight: 10 },
  headline: { label: 'Write a headline', hint: 'One line on what you do', weight: 12 },
  about: { label: 'Write an About section', hint: 'A short paragraph is plenty', weight: 10 },
  location: { label: 'Add your location', hint: 'Drives your location match score', weight: 5 },
  skills: { label: 'Add at least three skills', hint: 'The biggest single factor in matching', weight: 18 },
  education: { label: 'Add your school', hint: 'Connects you to people from it', weight: 15 },
  experience: { label: 'Add any experience', hint: 'Projects and volunteering count', weight: 10 },
  cv: { label: 'Upload your CV', hint: 'Lets you apply in one tap', weight: 10 },
  portfolio: { label: 'Add a portfolio link', hint: 'GitHub, Behance, a personal site', weight: 5 },
};

/**
 * FR-202 — profile completeness.
 *
 * A ring showing a number is a score, not a task. This shows the same number as
 * a bar with the next few actions underneath, each with what it is worth,
 * because the useful question is never "how complete am I" — it is "what do I
 * do next, and is it worth doing".
 *
 * Only the top three are listed. A checklist of ten unfinished items reads as a
 * chore and gets ignored; three feels finishable, and finishing them re-ranks
 * what is left.
 */
export function CompletenessCard({
  score,
  missing,
  onAction,
}: {
  score: number;
  missing: string[];
  onAction?: (key: string) => void;
}) {
  const complete = missing.length === 0;
  const next = missing.slice(0, 3);
  const remaining = missing.length - next.length;

  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">
            {complete ? 'Your profile is complete' : 'Finish your profile'}
          </h2>
          <span
            className={cn(
              'text-2xl font-bold tabular-nums',
              complete ? 'text-success' : 'text-brand-fg',
            )}
          >
            {score}%
          </span>
        </div>

        {/* A bar rather than a ring: it reads left-to-right like progress, and
            it has somewhere to put the next step underneath it. */}
        <div
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile completeness"
          className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-[600ms] ease-[cubic-bezier(0.2,0,0,1)]',
              complete ? 'bg-success' : 'bg-[linear-gradient(90deg,var(--color-violet-500),var(--color-violet-700))]',
            )}
            style={{ width: `${Math.max(score, 2)}%` }}
          />
        </div>

        <p className="mt-2.5 text-sm text-fg-muted">
          {complete
            ? 'You will rank as highly as your profile can in recruiter searches and matches.'
            : 'A fuller profile ranks higher in recruiter searches and in your matches.'}
        </p>
      </div>

      {!complete && (
        <ul className="border-t border-border-subtle">
          {next.map((key) => {
            const item = ITEMS[key] ?? { label: key, hint: '', weight: 0 };
            const isInteractive = Boolean(onAction);

            const content = (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-2xs font-bold text-fg-subtle tabular-nums">
                  +{item.weight}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{item.label}</span>
                  {item.hint && (
                    <span className="block truncate text-xs text-fg-subtle">{item.hint}</span>
                  )}
                </span>
                {isInteractive && (
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-faint" />
                )}
              </>
            );

            return (
              <li key={key} className="border-b border-border-subtle last:border-b-0">
                {isInteractive ? (
                  <button
                    type="button"
                    onClick={() => onAction?.(key)}
                    className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-3">{content}</div>
                )}
              </li>
            );
          })}

          {remaining > 0 && (
            <li className="px-5 py-2.5 text-xs text-fg-subtle">
              {remaining} more after {next.length === 1 ? 'this' : 'these'}
            </li>
          )}
        </ul>
      )}

      {complete && (
        <p className="flex items-center gap-2 border-t border-border-subtle bg-success-subtle px-5 py-3 text-sm font-medium text-success-fg">
          <Check aria-hidden="true" className="size-4" />
          Nothing left to add
        </p>
      )}
    </section>
  );
}
