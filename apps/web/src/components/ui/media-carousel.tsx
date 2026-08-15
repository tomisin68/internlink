import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { PostMedia } from '@internlink/shared-types';
import { cn } from '@/lib/cn';
import { VideoPlayer, aspectRatioFor, formatTime } from '@/components/ui/video-player';

/**
 * A post's media, as a swipeable carousel.
 *
 * Scroll-snap rather than a JS-driven track: it gives native momentum, native
 * swipe physics and keyboard scrolling for free, and it keeps working if the
 * JS that drives the arrows has not hydrated yet. The dots and arrows are
 * layered on top of a plain horizontally-scrolling list.
 */
export function MediaCarousel({
  media,
  className,
  onOpen,
}: {
  media: PostMedia[];
  className?: string;
  /** Opens the fullscreen viewer at this index. */
  onOpen?: (index: number) => void;
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  // One mute state for the whole carousel: unmuting a video and then swiping to
  // the next one should not silently re-mute you.
  const [muted, setMuted] = useState(true);

  const scrollTo = useCallback((next: number) => {
    const track = trackRef.current;
    const child = track?.children[next] as HTMLElement | undefined;
    if (!track || !child) return;
    track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }, []);

  // Derive the active slide from scroll position rather than tracking it in the
  // click handler — that way a swipe, an arrow press and a keyboard scroll all
  // update the dots through the same path.
  function handleScroll(): void {
    const track = trackRef.current;
    if (!track) return;
    const width = track.clientWidth || 1;
    const next = Math.round(track.scrollLeft / width);
    setIndex((current) => (current === next ? current : Math.min(next, media.length - 1)));
  }

  if (media.length === 0) return null;

  const single = media.length === 1;

  return (
    <div className={cn('relative', className)}>
      <ul
        ref={trackRef}
        onScroll={handleScroll}
        aria-label={single ? undefined : `Media, ${media.length} items`}
        className={cn(
          'flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl border border-border-subtle bg-surface-sunken',
          // The scrollbar is noise on a media strip; swipe and the arrows are
          // the affordances that matter.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {media.map((item, i) => (
          <li key={`${item.url}-${i}`} className="w-full shrink-0 snap-center">
            {item.kind === 'image' ? (
              <button
                type="button"
                onClick={() => onOpen?.(i)}
                aria-label="View photo fullscreen"
                disabled={!onOpen}
                className="block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-default"
              >
                <img
                  src={item.url}
                  alt=""
                  loading="lazy"
                  style={{ aspectRatio: aspectRatioFor(item) }}
                  className="w-full bg-surface-sunken object-cover"
                />
              </button>
            ) : (
              <VideoPlayer
                item={item}
                isActive={i === index}
                muted={muted}
                onToggleMuted={() => setMuted((v) => !v)}
                onExpand={onOpen ? () => onOpen(i) : undefined}
              />
            )}
          </li>
        ))}
      </ul>

      {!single && (
        <>
          <CarouselArrow side="left" disabled={index === 0} onClick={() => scrollTo(index - 1)} />
          <CarouselArrow
            side="right"
            disabled={index === media.length - 1}
            onClick={() => scrollTo(index + 1)}
          />

          <p
            aria-live="polite"
            className="pointer-events-none absolute top-2 right-2 rounded-full bg-[rgb(15_16_32_/_0.62)] px-2 py-0.5 text-2xs font-semibold text-white tabular-nums backdrop-blur-sm"
          >
            {index + 1}/{media.length}
          </p>

          <ul className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
            {media.map((item, i) => (
              <li
                key={`${item.url}-dot-${i}`}
                className={cn(
                  'h-1.5 rounded-full transition-[width,background-color] duration-[200ms]',
                  i === index ? 'w-4 bg-brand' : 'w-1.5 bg-border-strong',
                )}
              />
            ))}
          </ul>
        </>
      )}

      {single && media[0]?.kind === 'video' && media[0].durationSeconds !== null && (
        <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-md bg-[rgb(15_16_32_/_0.62)] px-1.5 py-0.5 text-2xs font-semibold text-white tabular-nums backdrop-blur-sm">
          <Play aria-hidden="true" className="size-2.5" fill="currentColor" />
          {formatTime(media[0].durationSeconds)}
        </span>
      )}
    </div>
  );
}

function CarouselArrow({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous item' : 'Next item'}
      className={cn(
        'absolute top-1/2 z-10 hidden size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.62)] text-white backdrop-blur-sm transition-opacity duration-[160ms] sm:flex',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        'disabled:pointer-events-none disabled:opacity-0',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
}
