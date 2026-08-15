import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronUp, X } from 'lucide-react';
import type { PostAuthor, PostMedia } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { VideoPlayer } from '@/components/ui/video-player';
import { cn } from '@/lib/cn';

/** One entry in the viewer — the media plus who it belongs to. */
export interface LightboxItem {
  media: PostMedia;
  author: PostAuthor;
  postId: string;
  caption: string;
}

/**
 * Fullscreen media viewer.
 *
 * Vertical scroll-snap, so swiping up moves to the next item and keeps going
 * past the end of the post you opened — the whole feed's media in one column.
 * That is the gesture people arrive with from every short-video app, and it is
 * cheaper and smoother than a JS-driven pager: the browser owns the momentum.
 *
 * Rendered through a portal so it escapes the feed card's stacking context.
 * Without that, the `position: relative` on a post card would trap it.
 */
export function MediaLightbox({
  items,
  startIndex,
  onClose,
}: {
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(startIndex);
  // One mute decision for the session: unmuting a video and then swiping should
  // not silently re-mute the next one.
  const [muted, setMuted] = useState(true);

  // Jump to the tapped item before paint, so the viewer never flashes item one.
  useEffect(() => {
    const track = trackRef.current;
    const child = track?.children[startIndex] as HTMLElement | undefined;
    if (track && child) track.scrollTop = child.offsetTop - track.offsetTop;
  }, [startIndex]);

  // The page behind must not scroll while a fullscreen layer is open — on iOS
  // that is the difference between a viewer and a viewer that drifts sideways.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const move = useCallback((delta: number) => {
    const track = trackRef.current;
    if (!track) return;
    setIndex((current) => {
      const next = Math.max(0, Math.min(track.children.length - 1, current + delta));
      const child = track.children[next] as HTMLElement | undefined;
      if (child) track.scrollTo({ top: child.offsetTop - track.offsetTop, behavior: 'smooth' });
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        move(1);
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        move(-1);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [move, onClose]);

  function handleScroll(): void {
    const track = trackRef.current;
    if (!track) return;
    const height = track.clientHeight || 1;
    const next = Math.round(track.scrollTop / height);
    setIndex((current) => (current === next ? current : Math.min(next, items.length - 1)));
  }

  const active = items[index];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-50 bg-black"
    >
      <ul
        ref={trackRef}
        onScroll={handleScroll}
        className="h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <li
            key={`${item.postId}-${item.media.url}-${i}`}
            className="flex h-dvh snap-start items-center justify-center"
          >
            {item.media.kind === 'video' ? (
              <VideoPlayer
                item={item.media}
                isActive={i === index}
                muted={muted}
                onToggleMuted={() => setMuted((v) => !v)}
                variant="lightbox"
                className="size-full"
              />
            ) : (
              <img
                src={item.media.url}
                alt={item.caption || ''}
                // Neighbours load eagerly so a swipe lands on a decoded image
                // rather than on a grey box.
                loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'}
                className="max-h-dvh w-full object-contain"
              />
            )}
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------- chrome -- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 bg-[linear-gradient(to_bottom,rgb(0_0_0_/_0.62),transparent)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        {active && (
          <Link
            to={`/u/${active.author.id}`}
            onClick={onClose}
            className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Avatar
              name={active.author.name}
              src={active.author.avatarUrl}
              size="sm"
              shape={active.author.kind === 'company' ? 'rounded' : 'circle'}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">
                {active.author.name}
              </span>
              <span className="block text-2xs text-white/70 tabular-nums">
                {index + 1} of {items.length}
              </span>
            </span>
          </Link>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          className="pointer-events-auto flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[rgb(255_255_255_/_0.14)] text-white backdrop-blur-sm transition-colors hover:bg-[rgb(255_255_255_/_0.24)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {active?.caption && active.media.kind === 'image' && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-3 bg-[linear-gradient(to_top,rgb(0_0_0_/_0.72),transparent)] px-4 pt-10 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm text-white/90">
          {active.caption}
        </p>
      )}

      {/* Swiping up is not discoverable on a first visit; a nudge that fades
          after the first move is enough to teach it once. */}
      {index === 0 && items.length > 1 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-1 text-white/70 motion-safe:animate-pulse">
          <ChevronUp aria-hidden="true" className="size-5" />
          <span className="text-2xs font-medium">Swipe up for more</span>
        </p>
      )}
    </div>,
    document.body,
  );
}

/** A single image, shown on its own — used for avatars and banners. */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0_/_0.92)] p-6',
        'motion-safe:animate-[fade-in_160ms_ease-out]',
      )}
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-2xl object-contain" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-3 flex size-10 cursor-pointer items-center justify-center rounded-full bg-[rgb(255_255_255_/_0.14)] text-white backdrop-blur-sm transition-colors hover:bg-[rgb(255_255_255_/_0.24)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>,
    document.body,
  );
}
