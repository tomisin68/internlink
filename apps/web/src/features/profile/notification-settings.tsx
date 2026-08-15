import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/use-push-notifications';

/**
 * FR-601 — the push switch.
 *
 * Rendered only when push can actually work. An environment with no VAPID key,
 * or a browser that cannot receive web push at all, gets nothing rather than a
 * toggle that fails silently — the same rule the uploaders follow.
 *
 * `denied` is its own state because it cannot be undone from here: once a user
 * refuses the browser prompt, only browser settings can reverse it, and a
 * button that re-asks would do nothing at all.
 */
export function NotificationSettings() {
  const { state, enable, disable, sendTest } = usePushNotifications();

  if (state === 'unsupported' || state === 'unconfigured') return null;

  return (
    <section className="panel mt-4 p-5">
      <h2 className="mb-1 text-sm font-semibold text-fg">Notifications</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Get a notification when someone you follow posts, when a message arrives, and when an
        application moves forward.
      </p>

      {state === 'denied' ? (
        <div className="flex items-start gap-3 rounded-xl bg-surface-sunken p-3.5">
          <BellOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
          <div>
            <p className="text-sm font-medium text-fg">Notifications are blocked</p>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Your browser is refusing them for this site. Turn them back on in the site settings
              beside the address bar — we cannot ask again from here.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state === 'on' ? (
            <>
              <Button size="sm" variant="outline" leftIcon={<BellRing />} onClick={() => void disable()}>
                Turn off
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void sendTest()}>
                Send a test
              </Button>
              <span className="text-xs font-medium text-success-fg">On for this device</span>
            </>
          ) : (
            <Button
              size="sm"
              leftIcon={state === 'enabling' ? <Loader2 className="animate-spin" /> : <Bell />}
              disabled={state === 'enabling'}
              onClick={() => void enable()}
            >
              {state === 'enabling' ? 'Waiting for permission…' : 'Turn on notifications'}
            </Button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-fg-subtle">
        This setting is per device. Turning it on here does not turn it on for your phone.
      </p>
    </section>
  );
}
