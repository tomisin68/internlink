import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Mention } from '@internlink/shared-types';
import { cn } from '@/lib/cn';

/**
 * Post and comment bodies, with `#hashtags` and `@mentions` made live.
 *
 * The body is stored as plain text and marked up here rather than at write
 * time. Storing markup would mean a mention whose target changed their name
 * renders the old one forever, and it would make every consumer that is *not*
 * this component — the notification preview, the share text, the moderation
 * queue — responsible for stripping it back out.
 *
 * Matching is done in one pass with a single regex rather than by splitting on
 * whitespace: hashtags routinely sit against punctuation ("#react, #node") and
 * a whitespace split loses the trailing comma into the tag.
 */

/**
 * Hashtags and @-runs, in one alternation so their matches cannot overlap.
 *
 * The mention branch allows up to three capitalised-or-not words after the `@`
 * because display names have spaces in them; which of those words actually
 * belong to the mention is decided below against the resolved list, since only
 * the server knows who was really tagged.
 */
const TOKEN = /#[\p{L}\p{N}_]{2,48}|@[\p{L}\p{M}'.-]+(?:\s[\p{L}\p{M}'.-]+){0,2}/gu;

interface Segment {
  key: string;
  text: string;
  href: string | null;
}

function buildSegments(body: string, mentions: readonly Mention[]): Segment[] {
  const segments: Segment[] = [];
  // Longest first: "@Ada Lovelace" has to win over "@Ada", or the surname is
  // orphaned as plain text next to a link.
  const byName = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length);

  let cursor = 0;
  let index = 0;

  for (const match of body.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const token = match[0];

    if (token.startsWith('#')) {
      push(body.slice(cursor, start));
      segments.push({
        key: `t${index++}`,
        text: token,
        href: `/tag/${encodeURIComponent(token.slice(1).toLowerCase())}`,
      });
      cursor = start + token.length;
      continue;
    }

    // The regex greedily takes up to three words; only the part that matches a
    // real mention becomes a link, and the remainder falls back to plain text.
    const candidate = token.slice(1);
    const hit = byName.find((mention) =>
      candidate.toLowerCase().startsWith(mention.displayName.toLowerCase()),
    );
    if (!hit) continue;

    push(body.slice(cursor, start));
    segments.push({
      key: `m${index++}`,
      text: `@${hit.displayName}`,
      href: `/u/${hit.accountId}`,
    });
    cursor = start + 1 + hit.displayName.length;
  }

  push(body.slice(cursor));
  return segments;

  function push(text: string): void {
    if (text) segments.push({ key: `p${index++}`, text, href: null });
  }
}

export function RichText({
  body,
  mentions = [],
  className,
}: {
  body: string;
  mentions?: readonly Mention[];
  className?: string;
}) {
  const segments = useMemo(() => buildSegments(body, mentions), [body, mentions]);

  return (
    <p className={cn('whitespace-pre-wrap text-pretty', className)}>
      {segments.map((segment) =>
        segment.href ? (
          <Link
            key={segment.key}
            to={segment.href}
            // Stops a tap on a tag inside a post also triggering whatever the
            // surrounding card does with a click.
            onClick={(event) => event.stopPropagation()}
            className="font-medium text-brand-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {segment.text}
          </Link>
        ) : (
          <Fragment key={segment.key}>{segment.text}</Fragment>
        ),
      )}
    </p>
  );
}

/** The hashtag chips under a post, linking to their tag pages. */
export function HashtagList({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;

  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            to={`/tag/${encodeURIComponent(tag)}`}
            className="block rounded-lg bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-subtle-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
