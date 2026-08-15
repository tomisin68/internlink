import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { initialsFrom } from '@/lib/format';

const SIZES = {
  xs: 'size-7 text-2xs',
  sm: 'size-9 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-14 text-base',
} as const;

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  /** FR-1106 — the tiered verification badge. */
  verified?: boolean;
  /** Company avatars are squircles; people are circles. */
  shape?: 'circle' | 'rounded';
  className?: string;
}

export function Avatar({
  name,
  src,
  size = 'md',
  verified = false,
  shape = 'circle',
  className,
}: AvatarProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden bg-brand-subtle font-semibold text-brand-fg select-none',
          shape === 'circle' ? 'rounded-full' : 'rounded-xl',
          SIZES[size],
        )}
      >
        {src ? (
          // alt="" because the name is always rendered next to the avatar in
          // every usage — announcing it twice is noise, not accessibility.
          <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          initialsFrom(name)
        )}
      </span>

      {verified && (
        <span
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-surface"
          title="Verified"
        >
          <BadgeCheck
            aria-label="Verified"
            role="img"
            className={cn('text-success', size === 'xs' || size === 'sm' ? 'size-3.5' : 'size-4')}
            strokeWidth={2.5}
          />
        </span>
      )}
    </span>
  );
}
