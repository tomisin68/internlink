import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Logo } from './logo';

/* ================================================================ Alert ==== */

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

const ALERT_STYLE: Record<AlertVariant, { wrap: string; icon: typeof Info; tone: string }> = {
  info: { wrap: 'bg-info-subtle border-info/30', icon: Info, tone: 'text-info-fg' },
  success: { wrap: 'bg-success-subtle border-success/30', icon: CheckCircle2, tone: 'text-success-fg' },
  warning: { wrap: 'bg-warning-subtle border-warning/30', icon: TriangleAlert, tone: 'text-warning-fg' },
  error: { wrap: 'bg-danger-subtle border-danger/30', icon: AlertCircle, tone: 'text-danger-fg' },
};

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant = 'info', title, children, className }: AlertProps) {
  const style = ALERT_STYLE[variant];
  const Icon = style.icon;

  return (
    <div
      // Errors are assertive: a failed sign-in must interrupt. Everything else
      // waits its turn.
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border p-3.5', style.wrap, className)}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4.5 shrink-0', style.tone)} />
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className={cn('font-semibold', style.tone)}>{title}</p>}
        <div className={cn('leading-snug text-fg-muted', title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

/* ======================================================== Loading screen === */

/**
 * Full-page loader shown while the session resolves.
 *
 * Deliberately not a spinner on a blank page: the logo plus a settled layout
 * reads as "loading InternLink", where a bare spinner reads as "something is
 * stuck". The fade-in delay stops it flashing on fast connections.
 */
export function LoadingScreen({ message = 'Getting things ready…' }: { message?: string }) {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-canvas px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex animate-[fadeIn_240ms_ease-out_120ms_both] flex-col items-center gap-5">
        <Logo size="lg" />
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-[bounce_1s_ease-in-out_infinite] rounded-full bg-brand motion-reduce:animate-none"
                style={{ animationDelay: `${i * 140}ms` }}
              />
            ))}
          </span>
          <p className="text-sm text-fg-subtle">{message}</p>
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

/* ========================================================== Empty state === */

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}>
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-2xl bg-brand-subtle text-brand-fg [&>svg]:size-6"
        >
          {icon}
        </span>
      )}
      <div>
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ============================================================== Divider === */

export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) {
    return <hr className={cn('border-t border-border-default', className)} />;
  }
  return (
    <div className={cn('flex items-center gap-3', className)} role="separator">
      <span className="h-px flex-1 bg-border-default" />
      <span className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{label}</span>
      <span className="h-px flex-1 bg-border-default" />
    </div>
  );
}
