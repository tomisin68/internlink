import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The lift-on-hover is 1px. Anything more and a row of buttons feels jittery.
  primary:
    'bg-brand text-fg-on-brand shadow-sm hover:bg-brand-hover hover:shadow-[0_8px_28px_-6px_rgb(108_76_241_/_0.42)] hover:-translate-y-px active:translate-y-0 active:bg-brand-active',
  secondary:
    'bg-brand-subtle text-brand-fg hover:bg-brand-subtle-hover active:bg-brand-border',
  ghost: 'text-fg-muted hover:bg-surface-sunken hover:text-fg active:bg-border-default',
  outline:
    'border border-border-strong bg-surface text-fg hover:bg-surface-sunken hover:border-fg-faint active:bg-border-subtle',
  danger: 'bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90',
};

/**
 * Heights honour the 44px minimum touch target from priority 2 of the UX rules.
 * `sm` is 36px and is therefore reserved for pointer-dense contexts (table row
 * actions, chips) — never for a primary action on a mobile screen.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-7 text-base gap-2.5 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  /** Announced to screen readers while `isLoading`. */
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    loadingText,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // `aria-busy` rather than swapping the label: a screen reader user who
      // has just heard "Create account" should not have the button rename
      // itself mid-press.
      aria-busy={isLoading || undefined}
      disabled={disabled || isLoading}
      className={cn(
        'relative inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap',
        'transition-[background-color,box-shadow,transform,border-color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'disabled:pointer-events-none disabled:opacity-55',
        // Kills the double-tap-to-zoom delay on iOS for taps on buttons.
        'touch-manipulation select-none',
        SIZES[size],
        VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {isLoading && (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      )}
      {!isLoading && leftIcon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {leftIcon}
        </span>
      )}
      <span className={cn(isLoading && loadingText ? 'sr-only' : undefined)}>{children}</span>
      {isLoading && loadingText && <span>{loadingText}</span>}
      {!isLoading && rightIcon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {rightIcon}
        </span>
      )}
    </button>
  );
});

/**
 * A link that looks like a button.
 *
 * Genuinely a link, not a button with an onClick navigate: middle-click,
 * cmd-click and "open in new tab" all have to work, and a button element
 * silently breaks every one of them.
 */
export interface LinkButtonProps {
  to: string;
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function LinkButton({
  to,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={cn(
        'relative inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap',
        'transition-[background-color,box-shadow,transform,border-color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'touch-manipulation select-none',
        SIZES[size],
        VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {leftIcon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {leftIcon}
        </span>
      )}
      {children}
      {rightIcon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {rightIcon}
        </span>
      )}
    </Link>
  );
}

/**
 * Icon-only button. Requires `label` — an unlabelled icon button is the most
 * common accessibility failure in a product like this, so the type system
 * refuses to let one be built.
 */
export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'children'> {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className, size = 'md', variant = 'ghost', ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cn(
        'aspect-square px-0',
        size === 'sm' && 'w-9',
        size === 'md' && 'w-11',
        size === 'lg' && 'w-13',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="[&>svg]:size-5">
        {icon}
      </span>
    </Button>
  );
});
