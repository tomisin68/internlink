import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type Toast } from '@/lib/stores';
import { cn } from '@/lib/cn';

const VARIANT_STYLE: Record<Toast['variant'], { ring: string; icon: typeof Info; tone: string }> = {
  default: { ring: 'border-border-default', icon: Info, tone: 'text-fg-muted' },
  success: { ring: 'border-success/40', icon: CheckCircle2, tone: 'text-success-fg' },
  error: { ring: 'border-danger/40', icon: XCircle, tone: 'text-danger-fg' },
  warning: { ring: 'border-warning/40', icon: AlertTriangle, tone: 'text-warning-fg' },
};

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const style = VARIANT_STYLE[toast.variant];
  const Icon = style.icon;

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // Exit is quicker than entry — a toast leaving should not hold attention.
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-surface-raised p-3.5 shadow-lg',
        style.ring,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', style.tone)} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-sm leading-snug text-fg-muted">{toast.description}</p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
            className="mt-2 cursor-pointer text-sm font-semibold text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </motion.li>
  );
}

/**
 * Bottom-right on desktop, bottom-centre on mobile where thumbs live.
 *
 * `aria-live="polite"` on the container means new toasts are announced without
 * stealing focus — critical, because a toast that grabs focus mid-form throws
 * the user out of the field they were typing in.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:justify-end sm:px-6"
    >
      <ul className="flex w-full max-w-sm flex-col-reverse gap-2.5">
        <AnimatePresence initial={false} mode="popLayout">
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
