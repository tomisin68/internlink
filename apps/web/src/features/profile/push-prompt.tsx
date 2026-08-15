import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/use-push-notifications';

/**
 * The in-app ask, before the browser's own permission prompt.
 *
 * Push existed as a switch buried in settings, which meant almost nobody found
 * it and notifications only worked while the app was open. This is the prompt
 * that asks — but it is deliberately *our* prompt first, not the browser's.
 *
 * The browser's dialog can only be answered once. Firing it unprompted on page
 * load is the fastest way to a permanent `denied`, which cannot be undone from
 * inside the app at all. Asking in our own UI first means a "not now" is
 * recoverable: the browser prompt is only reached from a deliberate tap.
 *
 * Dismissal is remembered so this asks once, not on every visit.
 */
const DISMISSED_KEY = 'internlink.push.prompt.dismissed';

/** How long a "not now" holds before the prompt is worth showing again. */
const SNOOZE_DAYS = 30;

export function PushPrompt() {
  const { state, enable } = usePushNotifications();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(DISMISSED_KEY);
    if (!stored) {
      setDismissed(false);
      return;
    }
    const age = Date.now() - Number(stored);
    setDismissed(Number.isFinite(age) && age < SNOOZE_DAYS * 86_400_000);
  }, []);

  // Nothing to ask for if push cannot work here, is already on, or has been
  // refused at the browser level — `denied` is explained in settings instead.
  if (dismissed || state === 'on' || state === 'unsupported' || state === 'unconfigured') {
    return null;
  }
  if (state === 'denied') return null;

  function snooze(): void {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
  }

  return (
    <section className="panel mt-4 flex flex-wrap items-start gap-3 border-brand-border bg-brand-subtle p-4">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white"
      >
        <Bell className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-fg">Turn on notifications</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          Know when someone messages you, comments on your post or tags you — even when InternLink
          is closed.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" isLoading={state === 'enabling'} onClick={() => void enable()}>
            {state === 'enabling' ? 'Waiting for permission…' : 'Turn on'}
          </Button>
          <Button size="sm" variant="ghost" onClick={snooze}>
            Not now
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={snooze}
        aria-label="Dismiss"
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </section>
  );
}
