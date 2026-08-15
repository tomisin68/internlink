import { Router } from 'express';
import type { Post } from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { resolveWebOrigin } from '../../lib/origins.js';
import * as posts from '../posts/posts.service.js';

/**
 * Server-rendered share pages, for link unfurlers.
 *
 * WhatsApp, Twitter, Slack and Facebook fetch a URL and read its `<head>`.
 * None of them run JavaScript, so an SPA that writes its meta tags after mount
 * unfurls as a blank card with the app's generic title — which is exactly what
 * a shared post must not look like.
 *
 * This route serves real HTML with the tags already in it, then bounces a human
 * visitor into the app. Mounted at the API root rather than under /v1 because a
 * share link is a public, permanent, human-facing URL and should not carry an
 * API version in it.
 *
 * The web host points /p/:id here (see vercel.json). On a host that cannot
 * proxy, /p/:id falls through to the SPA instead: the link still works for
 * people, it just does not unfurl.
 */
export const shareRouter = Router();

/** Escapes text for an HTML attribute. Post bodies are user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarise(post: Post): string {
  const text = post.body.trim().replace(/\s+/g, ' ');
  if (text) return text.length > 200 ? `${text.slice(0, 197)}…` : text;

  const media = post.media ?? [];
  if (media.some((m) => m.kind === 'video')) return 'Shared a video on InternLink.';
  if (media.length > 1) return `Shared ${media.length} photos on InternLink.`;
  if (media.length === 1) return 'Shared a photo on InternLink.';
  return 'See this post on InternLink.';
}

/**
 * Picks the card image.
 *
 * A video's poster frame is used rather than the video itself for `og:image` —
 * unfurlers need a still, and Cloudinary derives one from the same asset by
 * swapping the extension. `og:video` is added alongside it so the platforms
 * that can play inline do.
 */
function mediaTags(post: Post): string {
  const media = post.media ?? [];
  const video = media.find((m) => m.kind === 'video');
  const image = media.find((m) => m.kind === 'image');
  const tags: string[] = [];

  const imageUrl = image?.url ?? video?.thumbnailUrl ?? post.mediaUrl ?? null;

  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    tags.push('<meta name="twitter:card" content="summary_large_image">');
    if (image?.width) tags.push(`<meta property="og:image:width" content="${image.width}">`);
    if (image?.height) tags.push(`<meta property="og:image:height" content="${image.height}">`);
  } else {
    tags.push('<meta name="twitter:card" content="summary">');
  }

  if (video) {
    tags.push(`<meta property="og:video" content="${escapeHtml(video.url)}">`);
    tags.push(`<meta property="og:video:secure_url" content="${escapeHtml(video.url)}">`);
    tags.push('<meta property="og:video:type" content="video/mp4">');
    if (video.width) tags.push(`<meta property="og:video:width" content="${video.width}">`);
    if (video.height) tags.push(`<meta property="og:video:height" content="${video.height}">`);
    tags.push('<meta name="twitter:card" content="player">');
  }

  return tags.join('\n    ');
}

function sharePage(args: {
  title: string;
  description: string;
  canonical: string;
  redirectTo: string;
  extraTags?: string;
}): string {
  const { title, description, canonical, redirectTo } = args;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">

    <meta property="og:site_name" content="InternLink">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    ${args.extraTags ?? ''}

    <!-- A crawler stops at the head. A person continues into the app. The
         redirect is scripted rather than a 302 so unfurlers, which follow
         redirects, still read the tags above. -->
    <script>window.location.replace(${JSON.stringify(redirectTo)});</script>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; display: grid;
             place-items: center; min-height: 100vh; background: #f8f8fc; color: #1c1c28; }
      a { color: #6c4cf1; }
    </style>
  </head>
  <body>
    <noscript><p>Continue to <a href="${escapeHtml(redirectTo)}">InternLink</a>.</p></noscript>
  </body>
</html>`;
}

shareRouter.get(
  '/p/:postId',
  asyncHandler(async (req, res) => {
    const postId = param(req, 'postId');
    // Bounce back to whichever host the visitor actually came from. Sending a
    // Vercel visitor to the Firebase origin would drop their session — Firebase
    // Auth persistence is per-origin.
    const target = `${resolveWebOrigin(req)}/p/${postId}`;
    const post = await posts.getPost(postId).catch(() => null);

    // A deleted or hidden post still returns a page rather than a 404: the link
    // has already been shared, and an unfurler showing "InternLink" beats a
    // broken-link card. The app itself explains what happened.
    if (!post || post.isFlagged) {
      res
        .status(200)
        .type('html')
        .send(
          sharePage({
            title: 'InternLink',
            description:
              'Find internships and entry-level roles, or hire the interns who will grow your team.',
            canonical: target,
            redirectTo: target,
          }),
        );
      return;
    }

    // Cached at the edge: a link pasted into a group chat is fetched once per
    // unfurler and then by every person who taps it.
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.type('html').send(
      sharePage({
        title: `${post.author.name} on InternLink`,
        description: summarise(post),
        canonical: target,
        redirectTo: target,
        extraTags: mediaTags(post),
      }),
    );
  }),
);

shareRouter.get(
  '/u/:accountId',
  asyncHandler(async (req, res) => {
    const target = `${resolveWebOrigin(req)}/u/${param(req, 'accountId')}`;

    // Deliberately generic. A profile card that unfurls someone's name, photo
    // and headline into a group chat leaks more than the person sharing it
    // intended — FR-1105 governs who may see a profile, and a link preview
    // bypasses every check it makes.
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.type('html').send(
      sharePage({
        title: 'InternLink',
        description: 'See this profile on InternLink.',
        canonical: target,
        redirectTo: target,
      }),
    );
  }),
);
