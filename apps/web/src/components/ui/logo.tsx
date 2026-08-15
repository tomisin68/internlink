import { cn } from '@/lib/cn';

interface LogoProps {
  className?: string;
  /** Hides the wordmark, leaving just the mark. */
  markOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const MARK_SIZE = { sm: 'size-7', md: 'size-9', lg: 'size-11' };
const TEXT_SIZE = { sm: 'text-base', md: 'text-lg', lg: 'text-xl' };

export function Logo({ className, markOnly = false, size = 'md' }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 64 64"
        className={cn(MARK_SIZE[size], 'shrink-0')}
        role="img"
        aria-label={markOnly ? 'InternLink' : undefined}
        aria-hidden={markOnly ? undefined : 'true'}
      >
        <defs>
          {/* Unique gradient ID per render is unnecessary here — the gradient is
              identical everywhere, so a shared ID is correct and cheaper. */}
          <linearGradient id="internlink-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8f6dfa" />
            <stop offset="55%" stopColor="#6c4cf1" />
            <stop offset="100%" stopColor="#5a38d8" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#internlink-mark)" />
        <path
          d="M20 42V26a6 6 0 0 1 12 0v12a6 6 0 0 0 12 0V22"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="44" cy="22" r="5" fill="#ff6b5b" stroke="#ffffff" strokeWidth="3" />
      </svg>

      {!markOnly && (
        <span
          className={cn(
            'font-[family-name:var(--font-display)] font-semibold tracking-tight text-fg',
            TEXT_SIZE[size],
          )}
        >
          Intern<span className="text-brand-fg">Link</span>
        </span>
      )}
    </span>
  );
}
