import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export interface Step {
  id: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  /** Zero-based index of the step currently being filled in. */
  current: number;
  className?: string;
  onStepClick?: (index: number) => void;
}

/**
 * Progress indicator for the profile wizard — priority 8 of the UX rules calls
 * for one on any multi-step process.
 *
 * Completed steps are clickable so a user can go back and correct something
 * without losing their place; future steps are not, because jumping ahead past
 * required fields is how you get a half-written profile.
 */
export function Stepper({ steps, current, className, onStepClick }: StepperProps) {
  const percent = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;

  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      {/* Screen readers get the plain sentence; the graphic below is decorative
          detail they do not need read out node by node. */}
      <p className="sr-only" aria-live="polite">
        Step {current + 1} of {steps.length}: {steps[current]?.label}
      </p>

      <ol className="relative flex items-center justify-between" role="list">
        {/* Track sits behind the nodes, inset by half a node so it starts and
            ends at the centres rather than the edges. */}
        <div
          aria-hidden="true"
          className="absolute top-4 right-4 left-4 h-0.5 rounded-full bg-border-default"
        />
        <motion.div
          aria-hidden="true"
          className="absolute top-4 left-4 h-0.5 origin-left rounded-full bg-brand"
          style={{ right: '1rem' }}
          initial={false}
          animate={{ scaleX: percent / 100 }}
          transition={{ type: 'spring', stiffness: 260, damping: 32 }}
        />

        {steps.map((step, index) => {
          const isComplete = index < current;
          const isCurrent = index === current;
          const isClickable = Boolean(onStepClick) && isComplete;

          return (
            <li key={step.id} className="relative z-10 flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={!isClickable}
                onClick={isClickable ? () => onStepClick?.(index) : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${step.label}${isComplete ? ' — completed' : isCurrent ? ' — current step' : ''}`}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-[240ms]',
                  isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-default',
                  isComplete && 'border-brand bg-brand text-white',
                  isCurrent &&
                    'border-brand bg-surface text-brand-fg shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_14%,transparent)]',
                  !isComplete && !isCurrent && 'border-border-default bg-surface text-fg-faint',
                )}
              >
                {isComplete ? (
                  <Check aria-hidden="true" className="size-4" strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </button>

              <span
                className={cn(
                  'hidden max-w-24 text-center text-xs leading-tight sm:block',
                  isCurrent ? 'font-semibold text-fg' : 'text-fg-subtle',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ========================================================= Progress ring === */

interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}

/** FR-202's completeness indicator. */
export function ProgressRing({
  value,
  size = 56,
  strokeWidth = 5,
  className,
  label = 'Profile completeness',
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cn('relative inline-grid place-items-center', className)}
      role="img"
      aria-label={`${label}: ${clamped}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={clamped >= 80 ? 'var(--success)' : 'var(--brand)'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      </svg>
      <span className="absolute text-xs font-semibold text-fg tabular-nums">{clamped}%</span>
    </div>
  );
}
