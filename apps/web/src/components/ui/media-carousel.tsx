import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { PostMedia } from '@internlink/shared-types';
import { cn } from '@/lib/cn';

/**
 * A post's media, as a swipeable carousel.
 *
 * Scroll-snap rather than a JS-driven track: it gives native momentum, native
 * swipe physics and keyboard scrolling for free, and it keeps working if the
 * JS that drives the arrows has not hydrated yet. The dots and arrows are
 * layered on top of a plain horizontally-scrolling list.
 */
export function MediaCarousel({ media, className }: { media: PostMedia[]; className?: string }) {
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
            <MediaFrame
              item={item}
              isActive={i === index}
              muted={muted}
              onToggleMuted={() => setMuted((v) => !v)}
            />
          </li>
        ))}
      </ul>

      {!single && (
        <>
          <CarouselArrow
            side="left"
            disabled={index === 0}
            onClick={() => scrollTo(index - 1)}
          />
          <CarouselArrow
            side="right"
            disabled={index === media.length - 1}
            onClick={() => scrollTo(index + 1)}
          />

          <p
            aria-live="polite"
            className="absolute top-2 right-2 rounded-full bg-[rgb(15_16_32_/_0.62)] px-2 py-0.5 text-2xs font-semibold text-white tabular-nums backdrop-blur-sm"
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

/** The tallest a media frame may get. Past this a post eats the whole screen. */
const MAX_ASPECT = 4 / 5;

function aspectRatioFor(item: PostMedia): string {
  if (!item.width || !item.height) return '4 / 3';
  const ratio = item.width / item.height;
  return ratio < MAX_ASPECT ? '4 / 5' : `${item.width} / ${item.height}`;
}

function MediaFrame({
  item,
  isActive,
  muted,
  onToggleMuted,
}: {
  item: PostMedia;
  isActive: boolean;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  if (item.kind === 'image') {
    return (
      <img
        src={item.url}
        alt=""
        loading="lazy"
        style={{ aspectRatio: aspectRatioFor(item) }}
        className="w-full bg-surface-sunken object-cover"
      />
    );
  }

  return <FeedVideo item={item} isActive={isActive} muted={muted} onToggleMuted={onToggleMuted} />;
}

/**
 * Feed video: autoplays muted when it scrolls into view, pauses when it leaves.
 *
 * Muted is not a nicety — every browser blocks autoplay *with* sound, so an
 * unmuted `autoplay` simply does not start. The user unmutes deliberately, and
 * that choice persists across the carousel.
 *
 * An IntersectionObserver drives it rather than a scroll listener: a feed with
 * five videos would otherwise run five handlers on every scroll frame.
 * `prefers-reduced-motion` opts out of autoplay entirely, since autoplaying
 * video is exactly the kind of unrequested motion that setting is asking about.
 */
function FeedVideo({
  item,
  isActive,
  muted,
  onToggleMuted,
}: {
  item: PostMedia;
  isActive: boolean;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wantsPlayback, setWantsPlayback] = useState(true);

  // Kept off React state: this is read inside the observer callback, and a
  // re-render per intersection change is a lot of work to learn nothing.
  const inViewRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = Boolean(entry?.isIntersecting);
        syncPlayback();
      },
      // Half on screen before it counts as "watching" — a sliver at the edge
      // of the viewport starting audio-less playback wastes data for nothing.
      { threshold: 0.5 },
    );

    function syncPlayback(): void {
      const el = videoRef.current;
      if (!el) return;

      if (inViewRef.current && isActive && wantsPlayback && !reduceMotion) {
        // Autoplay can still be refused (data saver, low power mode). Swallow
        // it and leave the poster up — there is a play button either way.
        void el.play().catch(() => undefined);
      } else {
        el.pause();
      }
    }

    observer.observe(video);
    syncPlayback();

    return () => observer.disconnect();
  }, [isActive, wantsPlayback]);

  // Muting is a property, not an attribute — React sets `muted` on first render
  // only, so toggling it later has to go through the DOM node.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="relative" style={{ aspectRatio: aspectRatioFor(item) }}>
      <video
        ref={videoRef}
        src={item.url}
        poster={item.thumbnailUrl ?? undefined}
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onClick={() => setWantsPlayback((v) => !v)}
        className="size-full cursor-pointer bg-black object-cover"
      />

      {/* Centre play badge, shown only while paused. */}
      {!isPlaying && (
        <button
          type="button"
          onClick={() => setWantsPlayback(true)}
          aria-label="Play video"
          className="absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--ring)]"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.62)] text-white backdrop-blur-sm">
            <Play aria-hidden="true" className="size-6 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}

      <div className="absolute right-2 bottom-2 flex gap-1.5">
        {isPlaying && (
          <VideoControl
            label="Pause video"
            onClick={() => setWantsPlayback(false)}
            icon={<Pause className="size-4" fill="currentColor" />}
          />
        )}
        <VideoControl
          label={muted ? 'Unmute video' : 'Mute video'}
          onClick={onToggleMuted}
          icon={muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        />
      </div>

      {item.durationSeconds !== null && !isPlaying && (
        <span className="absolute bottom-2 left-2 rounded-md bg-[rgb(15_16_32_/_0.62)] px-1.5 py-0.5 text-2xs font-semibold text-white tabular-nums backdrop-blur-sm">
          {formatDuration(item.durationSeconds)}
        </span>
      )}
    </div>
  );
}

function VideoControl({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.62)] text-white backdrop-blur-sm transition-colors duration-[160ms] hover:bg-[rgb(15_16_32_/_0.78)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      {icon}
    </button>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
