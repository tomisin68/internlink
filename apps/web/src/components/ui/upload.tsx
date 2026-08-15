import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Camera, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { uploadToCloudinary } from '@/features/auth/auth-api';
import { toast } from '@/lib/stores';

/* ========================================================= Avatar upload === */

interface AvatarUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Initials shown while there is no image. */
  fallback: string;
  className?: string;
}

export function AvatarUpload({ value, onChange, fallback, className }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // A local object URL shows the crop instantly instead of waiting on the
  // round trip — the difference between "responsive" and "laggy" here.
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setProgress(0);

    try {
      const { url } = await uploadToCloudinary(file, 'avatar', setProgress);
      onChange(url);
    } catch (error) {
      setPreview(null);
      toast.error(
        'Upload failed',
        error instanceof Error ? error.message : 'Try a different image.',
      );
    } finally {
      setProgress(null);
      URL.revokeObjectURL(localUrl);
    }
  }

  const shown = preview ?? value;
  const isUploading = progress !== null;

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          aria-label={shown ? 'Change profile photo' : 'Add a profile photo'}
          className="group relative flex size-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border-strong bg-surface-sunken transition-colors duration-[200ms] hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-wait"
        >
          {shown ? (
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-fg-subtle">
              {fallback}
            </span>
          )}

          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 flex items-center justify-center bg-[rgb(15_16_32_/_0.55)] text-white transition-opacity duration-[200ms]',
              isUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {isUploading ? (
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Camera className="size-5" />
            )}
          </span>
        </button>

        {isUploading && (
          <span
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-brand px-2 py-0.5 text-2xs font-semibold text-white tabular-nums"
            aria-live="polite"
          >
            {progress}%
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">Profile photo</p>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {/* FR-202 weights the photo at 10 points; saying so beats a vague
              "recommended". */}
          JPG, PNG or WebP · up to 5MB. Profiles with a photo get noticed first.
        </p>
        {value && !isUploading && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setPreview(null);
            }}
            className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-danger-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Trash2 aria-hidden="true" className="size-3" />
            Remove
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so re-picking the same file still fires onChange.
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* =========================================================== File upload === */

interface FileUploadProps {
  value: { url: string; name: string } | null;
  onChange: (file: { url: string; name: string } | null) => void;
  kind: 'cv' | 'verification_doc' | 'company_logo';
  accept: string;
  hint: string;
  label: string;
  className?: string;
}

export function FileUpload({
  value,
  onChange,
  kind,
  accept,
  hint,
  label,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function handleFile(file: File): Promise<void> {
    setProgress(0);
    try {
      const { url } = await uploadToCloudinary(file, kind, setProgress);
      onChange({ url, name: file.name });
      toast.success('Uploaded', file.name);
    } catch (error) {
      toast.error('Upload failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setProgress(null);
    }
  }

  const isUploading = progress !== null;

  if (value && !isUploading) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-border-default bg-surface p-3',
          className,
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-fg">
          <FileText aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{value.name}</p>
          <a
            href={value.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-fg underline-offset-4 hover:underline"
          >
            View file
          </a>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Remove ${value.name}`}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-danger-subtle hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
      className={className}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={cn(
          'flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-[border-color,background-color] duration-[200ms]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          isDragging
            ? 'border-brand bg-brand-subtle'
            : 'border-border-strong bg-surface hover:border-brand hover:bg-surface-sunken',
          isUploading && 'cursor-wait',
        )}
      >
        {isUploading ? (
          <>
            <Loader2 aria-hidden="true" className="size-6 animate-spin text-brand motion-reduce:animate-none" />
            <span className="text-sm font-medium text-fg tabular-nums" aria-live="polite">
              Uploading… {progress}%
            </span>
          </>
        ) : (
          <>
            <Upload aria-hidden="true" className="size-6 text-fg-subtle" />
            <span className="text-sm font-medium text-fg">{label}</span>
            <span className="text-xs text-fg-subtle">{hint}</span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
