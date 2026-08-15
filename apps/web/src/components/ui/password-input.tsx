import { forwardRef, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input, type InputProps } from './field';

/**
 * Strength is scored on the things that actually resist a guessing attack —
 * length above all — rather than on a checklist of character classes.
 *
 * It is advisory: the real gate is the Zod policy in shared-types. A meter that
 * blocks submission on top of validation just produces two conflicting sources
 * of truth about whether a password is acceptable.
 */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

const COMMON_PATTERNS = [
  /^password/i,
  /^12345/,
  /^qwerty/i,
  /^letmein/i,
  /^welcome/i,
  /^admin/i,
  /^internlink/i,
];

export function scorePassword(value: string): PasswordStrength {
  if (!value) return 0;
  if (COMMON_PATTERNS.some((p) => p.test(value))) return 1;

  let score = 0;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  if (value.length >= 18) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(value)).length;
  if (classes >= 3) score += 1;

  // A long string of one repeated character shouldn't read as strong.
  if (/^(.)\1+$/.test(value)) score = Math.min(score, 1);

  return Math.min(score, 4) as PasswordStrength;
}

const STRENGTH_META: Record<PasswordStrength, { label: string; bar: string; text: string }> = {
  0: { label: '', bar: 'bg-border-default', text: 'text-fg-subtle' },
  1: { label: 'Too easy to guess', bar: 'bg-danger', text: 'text-danger-fg' },
  2: { label: 'Getting there', bar: 'bg-warning', text: 'text-warning-fg' },
  3: { label: 'Strong', bar: 'bg-success', text: 'text-success-fg' },
  4: { label: 'Very strong', bar: 'bg-success', text: 'text-success-fg' },
};

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'rightSlot' | 'leftIcon'> {
  /** Shows the strength meter. Off for sign-in, on for sign-up. */
  showStrength?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ showStrength = false, value, className, ...props }, ref) {
    const [revealed, setRevealed] = useState(false);
    const strength = useMemo(() => scorePassword(String(value ?? '')), [value]);
    const meta = STRENGTH_META[strength];

    // `value` is forwarded only when the caller actually passed one. Defaulting
    // it to '' would silently turn every uncontrolled field (the confirm-password
    // input, which react-hook-form registers uncontrolled) into a controlled one
    // pinned to the empty string — the field would refuse to show typed text.
    const controlled = value !== undefined ? { value } : {};

    return (
      <div className="flex flex-col gap-2">
        <Input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          leftIcon={<Lock />}
          {...controlled}
          className={className}
          rightSlot={
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              // Not `aria-pressed` — the label already states what pressing it
              // will do, which is less ambiguous when read aloud.
              aria-label={revealed ? 'Hide password' : 'Show password'}
              title={revealed ? 'Hide password' : 'Show password'}
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors duration-[160ms] hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              {revealed ? (
                <EyeOff aria-hidden="true" className="size-4.5" />
              ) : (
                <Eye aria-hidden="true" className="size-4.5" />
              )}
            </button>
          }
          {...props}
        />

        {showStrength && String(value).length > 0 && (
          <div className="flex items-center gap-2.5">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors duration-300',
                    step <= strength ? meta.bar : 'bg-border-default',
                  )}
                />
              ))}
            </div>
            {/* aria-live so the assessment is announced as it changes, but
                polite so it never interrupts typing. */}
            <span className={cn('text-xs font-medium', meta.text)} aria-live="polite">
              {meta.label}
            </span>
          </div>
        )}
      </div>
    );
  },
);
