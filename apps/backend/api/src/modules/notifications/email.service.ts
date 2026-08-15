import { env, hasResendCredentials } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * SRS §7.2 — transactional email over Resend.
 *
 * Called through `fetch` rather than the Resend SDK: the whole surface used
 * here is one POST, and a dependency that exists to wrap one HTTP call is a
 * dependency to keep updated for no benefit.
 *
 * Nothing here throws into a caller. Email is the *least* important delivery
 * channel — the in-app notification is already written and the push has already
 * gone — so a mail outage must never fail the action that triggered it.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is required; every client can render it, and spam filters
   *  treat an HTML-only message worse. */
  text: string;
  html: string;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!hasResendCredentials) {
    logger.debug({ to: message.to, subject: message.subject }, 'Email skipped — Resend not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY!}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      // A hung mail provider must not hold a request open. The notification is
      // already durable in Firestore; the email is the part we can afford to lose.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, to: message.to, detail: await response.text().catch(() => '') },
        'Resend rejected an email',
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ err: error, to: message.to }, 'Email send failed');
    return false;
  }
}

/* ================================================================ layout == */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The one email layout.
 *
 * Table-based and inline-styled because that is still what email clients
 * support — Outlook has no flexbox and Gmail strips `<style>` blocks. A
 * 600px-wide single column renders acceptably everywhere, which matters more
 * than looking sharp in one client and broken in three.
 */
function layout(args: { heading: string; body: string; ctaLabel: string; ctaHref: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fc;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e7f0;">
        <tr><td style="background:linear-gradient(115deg,#6c4cf1,#4c2fd0);padding:20px 24px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">InternLink</span>
        </td></tr>
        <tr><td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#1c1c28;">${escapeHtml(args.heading)}</h1>
          <div style="font-size:15px;line-height:1.6;color:#4a4a5e;">${args.body}</div>
        </td></tr>
        <tr><td style="padding:20px 24px 28px;">
          <a href="${escapeHtml(args.ctaHref)}" style="display:inline-block;background:#6c4cf1;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:15px;font-weight:600;">${escapeHtml(args.ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e7e7f0;font-size:12px;line-height:1.5;color:#8a8aa0;">
          You are receiving this because you have an InternLink account.
          <a href="${escapeHtml(env.WEB_APP_ORIGIN)}/profile" style="color:#6c4cf1;">Manage your notifications</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/* ============================================================= templates == */

export interface DigestEntry {
  title: string;
  detail: string;
  path: string;
}

/**
 * FR-603 — the batched digest.
 *
 * One email covering everything that happened, rather than one per event. A
 * professional network that emails on every reaction gets filtered to spam
 * within a week, and then the messages that actually matter go with it.
 */
export function digestEmail(args: {
  to: string;
  firstName: string;
  entries: DigestEntry[];
}): EmailMessage {
  const count = args.entries.length;
  const heading =
    count === 1 ? 'You have one update waiting' : `You have ${count} updates waiting`;

  const listHtml = args.entries
    .slice(0, 10)
    .map(
      (entry) =>
        `<li style="margin-bottom:10px;"><strong style="color:#1c1c28;">${escapeHtml(entry.title)}</strong><br>
         <span style="color:#6a6a80;">${escapeHtml(entry.detail)}</span></li>`,
    )
    .join('');

  const text = [
    `Hi ${args.firstName},`,
    '',
    heading,
    '',
    ...args.entries.slice(0, 10).map((entry) => `- ${entry.title}: ${entry.detail}`),
    '',
    `Open InternLink: ${env.WEB_APP_ORIGIN}/notifications`,
  ].join('\n');

  return {
    to: args.to,
    subject: heading,
    text,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(args.firstName)},</p>
             <ul style="margin:0;padding-left:18px;">${listHtml}</ul>`,
      ctaLabel: 'Open InternLink',
      ctaHref: `${env.WEB_APP_ORIGIN}/notifications`,
    }),
  };
}

/**
 * FR-604 — urgent events skip batching entirely.
 *
 * "Your interview is in an hour" is worthless in tomorrow's digest, which is
 * why the decision is made at emission time by the code with the context.
 */
export function urgentEmail(args: {
  to: string;
  firstName: string;
  heading: string;
  detail: string;
  path: string;
  ctaLabel: string;
}): EmailMessage {
  const href = `${env.WEB_APP_ORIGIN}${args.path}`;

  return {
    to: args.to,
    subject: args.heading,
    text: `Hi ${args.firstName},\n\n${args.detail}\n\n${args.ctaLabel}: ${href}`,
    html: layout({
      heading: args.heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(args.firstName)},</p>
             <p style="margin:0;">${escapeHtml(args.detail)}</p>`,
      ctaLabel: args.ctaLabel,
      ctaHref: href,
    }),
  };
}
