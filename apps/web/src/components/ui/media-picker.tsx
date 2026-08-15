import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Play, X } from 'lucide-react';
import { MAX_POST_MEDIA, type PostMedia } from '@internlink/shared-types';
import { cn } from '@/lib/cn';
import { MEDIA_ACCEPT, uploadPostMedia } from '@/lib/cloudinary';
import { useUploadCapabilities } from '@/hooks/use-uploads-available';
import { toast } from '@/lib/stores';

interface PendingUpload {
  id: string;
  name: string;
  /** Local object URL — shows the thumbnail before the upload finishes. */
  previewUrl: string;
  kind: 'image' | 'video';
  progress: number;
}

/**
 * Picks photos and videos for a post and uploads them as they are chosen.
 *
 * Uploading on selection rather than on submit is what makes a carousel usable:
 * by the time someone has written a caption, four photos are already up, and
 * pressing Post is instant instead of a 40-second wait with a spinner.
 */
export function MediaPicker({
  value,
  onChange,
  disabled,
}: {
  value: PostMedia[];
  onChange: (media: PostMedia[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { capabilities } = useUploadCapabilities();
  const [pending, setPending] = useState<PendingUpload[]>([]);

  // Uploads finish out of order and out of render. These let the completion
  // handler read the *current* list instead of the one captured when the file
  // was picked — four parallel uploads would otherwise each append to the same
  // stale array and only the last would survive.
  const latestValue = useRef(value);
  latestValue.current = value;
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  const total = value.length + pending.length;
  const isFull = total >= MAX_POST_MEDIA;

  async function handleFiles(files: File[]): Promise<void> {
    const room = MAX_POST_MEDIA - total;
    if (room <= 0) {
      toast.error(`You can add up to ${MAX_POST_MEDIA} items`);
      return;
    }
    if (files.length > room) {
      toast.error(`Only the first ${room} were added`, `A post holds ${MAX_POST_MEDIA} items.`);
    }

    // Uploads run in parallel — they are independent, and a queue would make
    // four photos take four times as long for no benefit.
    await Promise.all(files.slice(0, room).map(uploadOne));
  }

  async function uploadOne(file: File): Promise<void> {
    const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const previewUrl = URL.createObjectURL(file);
    const kind = file.type.startsWith('video/') ? 'video' : 'image';

    setPending((current) => [...current, { id, name: file.name, previewUrl, kind, progress: 0 }]);

    try {
      const media = await uploadPostMedia(file, capabilities, (progress) => {
        setPending((current) =>
          current.map((item) => (item.id === id ? { ...item, progress } : item)),
        );
      });
      latestOnChange.current([...latestValue.current, media]);
    } catch (error) {
      toast.error(
        'Could not add that file',
        error instanceof Error ? error.message : 'Try a different one.',
      );
    } finally {
      setPending((current) => current.filter((item) => item.id !== id));
      URL.revokeObjectURL(previewUrl);
    }
  }

  if (!capabilities.available) return null;

  return (
    <div>
      {total > 0 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {value.map((item, index) => (
            <li key={`${item.url}-${index}`} className="relative shrink-0">
              <MediaThumb
                src={item.thumbnailUrl ?? item.url}
                kind={item.kind}
                alt={`Attachment ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remove attachment ${index + 1}`}
                className="absolute -top-1.5 -right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.78)] text-white transition-colors hover:bg-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}

          {pending.map((item) => (
            <li key={item.id} className="relative shrink-0">
              <MediaThumb src={item.previewUrl} kind={item.kind} alt="" dimmed />
              <span
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white"
                aria-live="polite"
              >
                <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                <span className="text-2xs font-semibold tabular-nums">{item.progress}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isFull}
        className={cn(
          'mt-1 flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg-muted transition-colors duration-[160ms]',
          'hover:bg-surface-sunken hover:text-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <ImagePlus aria-hidden="true" className="size-4" />
        {total > 0 ? 'Add more' : 'Photo or video'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) void handleFiles(files);
          // Reset so re-picking the same file still fires onChange.
          e.target.value = '';
        }}
      />
    </div>
  );
}

function MediaThumb({
  src,
  kind,
  alt,
  dimmed,
}: {
  src: string;
  kind: 'image' | 'video';
  alt: string;
  dimmed?: boolean;
}) {
  return (
    <span className="relative block size-20 overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken">
      {kind === 'video' ? (
        <video src={src} muted playsInline preload="metadata" className="size-full object-cover" />
      ) : (
        <img src={src} alt={alt} className="size-full object-cover" />
      )}

      {kind === 'video' && !dimmed && (
        <span className="absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-[rgb(15_16_32_/_0.62)] text-white">
          <Play aria-hidden="true" className="size-2.5 translate-x-px" fill="currentColor" />
        </span>
      )}

      {dimmed && <span aria-hidden="true" className="absolute inset-0 bg-[rgb(15_16_32_/_0.55)]" />}
    </span>
  );
}
