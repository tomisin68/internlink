import type { Post } from '@internlink/shared-types';

/**
 * The public permalink for a post.
 *
 * `/p/:id` is deliberately short and version-free: it is a URL people paste
 * into WhatsApp, and it has to keep working forever. On the Vercel host that
 * path is rewritten to the API's share endpoint, which serves real Open Graph
 * tags so the link unfurls with the post's own media — crawlers do not run JS,
 * so an SPA that sets its meta tags after mount unfurls as a blank card.
 */
export function postPath(postId: string): string {
  return `/p/${postId}`;
}

export function postShareUrl(postId: string): string {
  return `${window.location.origin}${postPath(postId)}`;
}

/**
 * What a reshare quotes is the original, so a share link on a reshare should
 * point at the post that actually holds the content.
 */
export function canonicalPostId(post: Pick<Post, 'id' | 'resharedFrom'>): string {
  return post.resharedFrom?.postId ?? post.id;
}
