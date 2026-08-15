import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PostMedia } from '@internlink/shared-types';
import { cn } from '@/lib/cn';

/** How far the skip buttons and the double-tap gesture jump. */
const SKIP_SECONDS = 10;

export interface VideoPlayerProps {
  item: PostMedia;
  /** False pauses playback — the carousel uses it for off-screen slides. */
  isActive: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  /** Feed videos autoplay muted; a lightbox video waits to be asked. */
  autoPlay?: boolean;
  /** Opens the lightbox. Omitted when already in one. */
  onExpand?: () => void;
  /** Taller controls and a persistent scrubber, for the fullscreen view. */
  variant?: 'feed' | 'lightbox';
  className?: string;
}

/**
 * The video player used in the feed and in the lightbox.
 *
 * Autoplay is always muted, because every browser blocks autoplay with sound —
 * an unmuted `autoplay` simply never starts. The user unmutes deliberately and
 * that choice is owned by the caller, so it survives moving between videos.
 *
 * An IntersectionObserver drives playback rather than a scroll listener: a feed
 * with five videos would otherwise run five handlers on every scroll frame.
 */
export function VideoPlayer({
  item,
  isActive,
  muted,
  onToggleMuted,
  autoPlay = true,
  onExpand,
  variant = 'feed',
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inViewRef = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wantsPlayback, setWantsPlayback] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSeconds ?? 0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [buffered, setBuffered] = useState(0);
  /**
   * Whether the control bar is showing.
   *
   * It used to be revealed by `:hover` alone, which on a phone means never —
   * and because a zero-opacity element still takes clicks, the invisible bar
   * sat across the bottom of every feed video swallowing the taps meant for
   * play/pause. Hence both halves of this fix: a real visibility state, and
   * `pointer-events-none` while hidden.
   */
  const [controlsVisible, setControlsVisible] = useState(false);

  /** Reveals the controls, then hides them again once playback settles. */
  const revealControls = useCallback((sticky = false) => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    if (!sticky) {
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
    }
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    // `duration` can be Infinity mid-load; clamping to it would jump to the end.
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(max, video.currentTime + seconds));
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = seconds;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Autoplaying video is exactly the unrequested motion this setting is about.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function sync(): void {
      const el = videoRef.current;
      if (!el) return;

      if (inViewRef.current && isActive && wantsPlayback && !(reduceMotion && autoPlay)) {
        // Autoplay can still be refused — data saver, low power mode. Swallow it
        // and leave the poster up; there is a play button either way.
        void el.play().catch(() => undefined);
      } else {
        el.pause();
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = Boolean(entry?.isIntersecting);
        sync();
      },
      // Half on screen before it counts as watching. A sliver at the edge of the
      // viewport starting playback wastes data for something nobody is looking at.
      { threshold: 0.5 },
    );

    observer.observe(video);
    sync();

    return () => observer.disconnect();
  }, [isActive, wantsPlayback, autoPlay]);

  // `muted` is a property, not an attribute — React sets it on first render
  // only, so toggling later has to go through the DOM node.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const isLightbox = variant === 'lightbox';
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  /** Play/pause, and show the controls so the state change is visible. */
  function togglePlayback(): void {
    setWantsPlayback((v) => {
      // Pausing keeps the controls up — a paused video with no visible chrome
      // looks like it failed to load.
      revealControls(v);
      return !v;
    });
  }

  // Fullscreen always shows its chrome; a feed card reveals it on hover, focus
  // or a tap, and hides it again while playing so the video is not half-covered.
  const chromeShown = isLightbox || controlsVisible || !isPlaying;

  return (
    <div
      className={cn('group/video relative overflow-hidden', className)}
      style={isLightbox ? undefined : { aspectRatio: aspectRatioFor(item) }}
    >
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
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        onTimeUpdate={(e) => {
          // Skip while dragging, or the scrubber fights the thumb.
          if (!isScrubbing) setCurrentTime(e.currentTarget.currentTime);
        }}
        onProgress={(e) => {
          const ranges = e.currentTarget.buffered;
          if (ranges.length > 0) setBuffered(ranges.end(ranges.length - 1));
        }}
        className={cn('size-full bg-black', isLightbox ? 'object-contain' : 'object-cover')}
      />

      {/* Tap zones: the middle toggles playback, the sides double-tap to seek —
          the gesture people already know from every video app on a phone. */}
      <div className="absolute inset-0 flex">
        <SeekZone
          onDoubleTap={() => seekBy(-SKIP_SECONDS)}
          onTap={() => revealControls()}
          label={`Back ${SKIP_SECONDS} seconds`}
        />
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          className="h-full flex-1 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--ring)]"
        />
        <SeekZone
          onDoubleTap={() => seekBy(SKIP_SECONDS)}
          onTap={() => revealControls()}
          label={`Forward ${SKIP_SECONDS} seconds`}
        />
      </div>

      {/* The big centre affordance. `pointer-events-none` so the tap falls
          through to the play/pause zone behind it rather than needing a
          pixel-accurate hit on the circle. */}
      {!isPlaying && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.62)] text-white backdrop-blur-sm">
            <Play className="size-6 translate-x-0.5" fill="currentColor" />
          </span>
        </span>
      )}

      {/* Controls: always visible in the lightbox; in the feed they appear on
          hover, on focus, on a tap, and whenever the video is paused. A feed
          card permanently covered in chrome is unreadable — but a hidden bar
          that still eats taps, which is what this was, is worse. */}
      <div
        onPointerDown={() => revealControls(true)}
        className={cn(
          'absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(15_16_32_/_0.78),transparent)] px-2 pt-8 pb-2 transition-opacity duration-[200ms]',
          'group-hover/video:pointer-events-auto group-hover/video:opacity-100',
          'group-focus-within/video:pointer-events-auto group-focus-within/video:opacity-100',
          chromeShown ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Scrubber
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          progress={progress}
          onScrubStart={() => setIsScrubbing(true)}
          onScrub={setCurrentTime}
          onScrubEnd={(value) => {
            setIsScrubbing(false);
            seekTo(value);
          }}
        />

        <div className="mt-1 flex items-center gap-0.5">
          <ControlButton
            label={isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlayback}
            icon={
              isPlaying ? (
                <Pause className="size-4" fill="currentColor" />
              ) : (
                <Play className="size-4" fill="currentColor" />
              )
            }
          />
          <ControlButton
            label={`Back ${SKIP_SECONDS} seconds`}
            onClick={() => seekBy(-SKIP_SECONDS)}
            icon={<RotateCcw className="size-4" />}
          />
          <ControlButton
            label={`Forward ${SKIP_SECONDS} seconds`}
            onClick={() => seekBy(SKIP_SECONDS)}
            icon={<RotateCw className="size-4" />}
          />

          <span className="px-1.5 text-2xs font-semibold text-white tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <ControlButton
              label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMuted}
              icon={muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            />
            {onExpand && (
              <ControlButton
                label="View fullscreen"
                onClick={onExpand}
                icon={<Maximize2 className="size-4" />}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A side tap zone: single tap falls through to play/pause, double tap seeks.
 *
 * The delay is what makes both gestures live on the same element — a single tap
 * has to wait long enough to know it is not the first half of a double.
 */
function SeekZone({
  onDoubleTap,
  onTap,
  label,
}: {
  onDoubleTap: () => void;
  /** Single tap. Reveals the controls rather than doing nothing at all. */
  onTap: () => void;
  label: string;
}) {
  const lastTap = useRef(0);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          onDoubleTap();
          lastTap.current = 0;
          return;
        }
        lastTap.current = now;
        onTap();
      }}
      onDoubleClick={onDoubleTap}
      className="h-full w-1/5 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--ring)]"
    />
  );
}

/**
 * The seek bar.
 *
 * A native range input, restyled. A custom div with pointer maths would be a
 * lot of code to reimplement keyboard support, touch targets and the drag
 * behaviour people already expect — and would almost certainly get one of them
 * wrong.
 */
function Scrubber({
  currentTime,
  duration,
  buffered,
  progress,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: {
  currentTime: number;
  duration: number;
  buffered: number;
  progress: number;
  onScrubStart: () => void;
  onScrub: (value: number) => void;
  onScrubEnd: (value: number) => void;
}) {
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div className="relative flex h-4 items-center">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 h-1 rounded-full bg-[rgb(255_255_255_/_0.28)]"
      />
      <span
        aria-hidden="true"
        className="absolute left-0 h-1 rounded-full bg-[rgb(255_255_255_/_0.42)]"
        style={{ width: `${bufferedPercent}%` }}
      />
      <span
        aria-hidden="true"
        className="absolute left-0 h-1 rounded-full bg-brand"
        style={{ width: `${progress}%` }}
      />
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        aria-label="Seek"
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        onPointerDown={onScrubStart}
        onChange={(e) => onScrub(Number(e.target.value))}
        onPointerUp={(e) => onScrubEnd(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onScrubEnd(Number((e.target as HTMLInputElement).value))}
        className={cn(
          'relative h-4 w-full cursor-pointer appearance-none bg-transparent',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          '[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow',
          '[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white',
        )}
      />
    </div>
  );
}

function ControlButton({
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
      className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-white transition-colors duration-[160ms] hover:bg-[rgb(255_255_255_/_0.16)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      {icon}
    </button>
  );
}

/** The tallest a feed media frame may get before it eats the whole screen. */
const MAX_ASPECT = 4 / 5;

export function aspectRatioFor(item: PostMedia): string {
  if (!item.width || !item.height) return '4 / 3';
  const ratio = item.width / item.height;
  return ratio < MAX_ASPECT ? '4 / 5' : `${item.width} / ${item.height}`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
