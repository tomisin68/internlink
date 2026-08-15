import { toast } from './stores';

/**
 * Shares a link, using whatever the device actually has.
 *
 * `navigator.share` opens the native sheet on phones, which is where sharing
 * genuinely belongs — it reaches WhatsApp, which is how links travel here. On a
 * desktop browser without it, copying to the clipboard is the honest fallback.
 *
 * Returns how it was handled so the caller can word its own confirmation, and
 * treats a cancelled share sheet as a non-event rather than an error.
 */
export async function shareLink(args: {
  url: string;
  title: string;
  text?: string;
}): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: args.title, text: args.text, url: args.url });
      return 'shared';
    } catch (error) {
      // The user backing out of the sheet is a deliberate choice, not a failure
      // to report at them.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Anything else (a share sheet that refused the payload, a non-secure
      // context) falls through to the clipboard rather than dead-ending.
    }
  }

  return copyToClipboard(args.url) ? 'copied' : 'failed';
}

function copyToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }

  // Clipboard API needs a secure context. On plain HTTP — a LAN test build, an
  // in-app browser — this is the only thing that works.
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

/** The common case: share a post and say what happened. */
export async function sharePost(args: {
  url: string;
  authorName: string;
  body: string;
}): Promise<void> {
  const result = await shareLink({
    url: args.url,
    title: `${args.authorName} on InternLink`,
    text: args.body.slice(0, 160),
  });

  if (result === 'copied') toast.success('Link copied', 'Paste it anywhere to share this post.');
  if (result === 'failed') toast.error('Could not share', 'Copy the link from your address bar.');
}
