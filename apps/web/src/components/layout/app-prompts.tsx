import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpFromLine, Bell, Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInstallPrompt, type InstallState } from '@/hooks/use-install-prompt';
import { usePushNotifications, type PushState } from '@/hooks/use-push-notifications';
import { toast } from '@/lib/stores';

/**
 * The two asks that only pay off when somebody actually sees them: install the
 * app, and turn notifications on.
 *
 * Both existed as capabilities and neither was ever offered. Install had no
 * `beforeinstallprompt` listener anywhere in the app, so the browser's own
 * dialog could not be opened from the product at all. Push had a card, but it
 * lived on the profile screen — a page people visit to edit their headline, not
 * one they pass through — so in practice nobody was asked, and "notifications"
 * came to mean the bell icon and nothing else.
 *
 * So they move to the shell, where every signed-in screen renders them. Four
 * rules keep that from being obnoxious:
 *
 *  1. One at a time, install first. On iOS that ordering is not a preference:
 *     Safari will not grant push to a browser tab, only to an installed app, so
 *     asking about notifications first is asking for a refusal.
 *  2. Dismissal sticks for a month, per prompt.
 *  3. Neither ever triggers a browser-level dialog on its own. The permission
 *     prompt can be answered once and `denied` is unrecoverable from inside the
 *     app, so it is only ever reached from a deliberate tap on ours.
 *  4. Not on an open message thread — see the shell. A floating card above the
 *     bottom bar would land straight on top of the composer.
 */

const INSTALL_DISMISSED_KEY = 'internlink.install.prompt.dismissed';
const PUSH_DISMISSED_KEY = 'internlink.push.prompt.dismissed';

/** How long a "not now" holds before a prompt is worth showing again. */
const SNOOZE_DAYS = 30;

function useSnooze(key: string): { snoozed: boolean; snooze: () => void } {
  // Starts closed. A card that flashes in on first paint and then hides itself
  // once localStorage has been read is worse than one that appears a frame late.
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      setSnoozed(false);
      return;
    }
    const age = Date.now() - Number(stored);
    setSnoozed(Number.isFinite(age) && age < SNOOZE_DAYS * 86_400_000);
  }, [key]);

  return {
    snoozed,
    snooze: () => {
      window.localStorage.setItem(key, String(Date.now()));
      setSnoozed(true);
    },
  };
}

/* ========================================================== presentation === */

function PromptCard({
  icon,
  title,
  children,
  actions,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <section className="panel flex items-start gap-3 p-4">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white [&>svg]:size-5"
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <div className="mt-0.5 text-sm text-fg-muted">{children}</div>
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </section>
  );
}

/**
 * Add to Home Screen, spelled out.
 *
 * iOS gives no API and fires no event, so a button here would be a lie. The
 * only honest thing to render is the three taps, carrying the actual Safari
 * glyphs so people can match them against what is on their screen.
 */
function IosInstructions() {
  return (
    <ol className="mt-2 space-y-1.5 text-sm text-fg-muted">
      <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="text-fg-subtle">1.</span>
        <span>Tap</span>
        <Share aria-hidden="true" className="size-4 shrink-0 text-brand-fg" />
        <span className="font-medium text-fg">Share</span>
        <span className="text-fg-subtle">in the Safari bar</span>
      </li>
      <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="text-fg-subtle">2.</span>
        <span>Choose</span>
        <SquarePlus aria-hidden="true" className="size-4 shrink-0 text-brand-fg" />
        <span className="font-medium text-fg">Add to Home Screen</span>
      </li>
      <li className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
        <span className="text-fg-subtle">3.</span>
        <span>Open InternLink from your Home Screen — notifications only work from there.</span>
      </li>
    </ol>
  );
}

/* ================================================================ prompts === */

/**
 * The install card.
 *
 * State comes from the parent rather than from its own `useInstallPrompt` call:
 * the shell needs the same answer to decide whether to render anything at all,
 * and two calls would mean two sets of window listeners racing for one
 * single-shot event.
 */
function InstallBanner({
  state,
  install,
  onDismiss,
  onInstalled,
}: {
  state: InstallState;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  onDismiss: () => void;
  onInstalled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  async function handleInstall(): Promise<void> {
    setBusy(true);
    const outcome = await install();
    setBusy(false);

    if (outcome === 'accepted') {
      onInstalled();
      return;
    }
    if (outcome === 'unavailable') {
      toast.info(
        'Install from your browser menu',
        'Look for “Install app” or “Add to Home screen”.',
      );
    }
    // A `dismissed` outcome is deliberately left alone: the browser's dialog
    // was opened and declined, which is not the same as never wanting to be
    // asked. Our own dismiss button is what snoozes the card.
  }

  if (state === 'manual-ios') {
    return (
      <PromptCard
        icon={<ArrowUpFromLine />}
        title="Add InternLink to your Home Screen"
        onDismiss={onDismiss}
        actions={
          showIosSteps ? (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Got it
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setShowIosSteps(true)}>
                Show me how
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Not now
              </Button>
            </>
          )
        }
      >
        {showIosSteps ? (
          <IosInstructions />
        ) : (
          <p>
            It opens full screen, loads faster, and it is the only way to get message
            notifications on iPhone and iPad.
          </p>
        )}
      </PromptCard>
    );
  }

  return (
    <PromptCard
      icon={<Download />}
      title="Install InternLink"
      onDismiss={onDismiss}
      actions={
        <>
          <Button size="sm" isLoading={busy} onClick={() => void handleInstall()}>
            Install
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
        </>
      }
    >
      <p>
        Keep it on your home screen — it opens full screen, works offline, and notifications
        arrive even when it is closed.
      </p>
    </PromptCard>
  );
}

function PushBanner({
  state,
  enable,
  onDismiss,
}: {
  state: PushState;
  enable: () => Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <PromptCard
      icon={<Bell />}
      title="Turn on notifications"
      onDismiss={onDismiss}
      actions={
        <>
          <Button size="sm" isLoading={state === 'enabling'} onClick={() => void enable()}>
            {state === 'enabling' ? 'Waiting for permission…' : 'Turn on'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
        </>
      }
    >
      <p>
        Know when someone messages you, comments on your post or tags you — even when InternLink
        is closed.
      </p>
    </PromptCard>
  );
}

/**
 * The floating slot, rendered once by the app shell.
 *
 * Fixed rather than inline, so it never reflows the screen underneath, and
 * offset by `--shell-nav` so it rides above the bottom bar instead of behind
 * it — the same measurement that had been missing from the message composer.
 */
export function AppPrompts() {
  const { state: installState, install } = useInstallPrompt();
  const { state: pushState, enable } = usePushNotifications();
  const installSnooze = useSnooze(INSTALL_DISMISSED_KEY);
  const pushSnooze = useSnooze(PUSH_DISMISSED_KEY);

  /**
   * Notifications are the more valuable ask, so they go first — except where
   * they cannot work yet.
   *
   * `needs-install` is iOS in a browser tab: Safari will not grant push to
   * anything but an installed app, so there installing *is* the notification
   * step and the order flips. Everywhere else — desktop Chrome, Android, a
   * browser with no install path at all — push works in a plain tab, and making
   * someone dismiss an install card first would be gatekeeping the fix behind
   * an unrelated ask.
   *
   * `denied` appears in neither branch. Nothing offered here can reverse it, so
   * the explanation belongs in settings, next to the switch it applies to.
   */
  const installRequiredForPush = pushState === 'needs-install';
  const canOfferInstall =
    !installSnooze.snoozed && (installState === 'available' || installState === 'manual-ios');
  const canOfferPush =
    !pushSnooze.snoozed && (pushState === 'off' || pushState === 'enabling');

  const showPush = canOfferPush && !installRequiredForPush;
  const showInstall = canOfferInstall && !showPush;

  if (!showInstall && !showPush) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--shell-nav)+0.75rem)] z-30 px-3">
      <div className="pointer-events-auto mx-auto w-full max-w-md shadow-lg lg:max-w-sm">
        {showPush ? (
          <PushBanner state={pushState} enable={enable} onDismiss={pushSnooze.snooze} />
        ) : (
          <InstallBanner
            state={installState}
            install={install}
            onDismiss={installSnooze.snooze}
            onInstalled={installSnooze.snooze}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The same install affordance, inline in settings and never snoozed.
 *
 * The floating card can be dismissed for a month; this is the copy that has to
 * still be there afterwards, so "how do I install this" stays answerable
 * without waiting out a snooze or clearing site data.
 */
export function InstallSettingsCard() {
  const { state, install } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  if (state === 'installed' || state === 'unavailable') return null;

  if (state === 'manual-ios') {
    return (
      <section className="panel mt-4 p-5">
        <h2 className="mb-1 text-sm font-semibold text-fg">Add to Home Screen</h2>
        <p className="text-sm text-fg-muted">
          Installing gets you a full-screen app — and on iPhone and iPad it is the only way to
          receive notifications while InternLink is closed.
        </p>
        <IosInstructions />
      </section>
    );
  }

  return (
    <section className="panel mt-4 p-5">
      <h2 className="mb-1 text-sm font-semibold text-fg">Install InternLink</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Keep it on your home screen. It opens full screen, works offline, and delivers
        notifications when the app is closed.
      </p>
      <Button
        size="sm"
        leftIcon={<Download />}
        isLoading={busy}
        onClick={() => {
          setBusy(true);
          void install().finally(() => setBusy(false));
        }}
      >
        Install
      </Button>
    </section>
  );
}
