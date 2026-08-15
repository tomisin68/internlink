import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { Account } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { ImageLightbox } from '@/components/ui/media-lightbox';
import { cn } from '@/lib/cn';
import { uploadDocument } from '@/lib/cloudinary';
import { useUploadsAvailable } from '@/hooks/use-uploads-available';
import { profileApiClient, queryKeys } from '@/lib/api-endpoints';
import { useSessionStore, toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

/**
 * The editable profile header: cover image, avatar, and the controls for both.
 *
 * Both uploads live here rather than in the profile wizard because changing
 * your photo is a one-tap action people expect from their own profile — making
 * it a four-step wizard is why so many profiles keep a default avatar forever.
 *
 * Tapping either image opens it full size. That is what a photo on a profile
 * affords, and an avatar you cannot look at properly is a strange thing to ask
 * someone to upload.
 */
export function ProfileHeaderEditor({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((s) => s.setSession);
  const { available } = useUploadsAvailable();

  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const [bannerProgress, setBannerProgress] = useState<number | null>(null);
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);

  const save = useMutation({
    mutationFn: (input: { photoUrl?: string | null; bannerUrl?: string | null }) =>
      profileApiClient.updateImages(input),
    onSuccess: (session) => {
      // The session carries the account, so writing it back updates the app
      // shell avatar and the profile header from one response.
      setSession(session);
      void queryClient.invalidateQueries({ queryKey: queryKeys.completeness });
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (error) => {
      toast.error(
        'Could not save that',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  async function upload(
    file: File,
    kind: 'avatar' | 'banner',
    setProgress: (value: number | null) => void,
  ): Promise<void> {
    setProgress(0);
    try {
      const { url } = await uploadDocument(file, kind, setProgress);
      await save.mutateAsync(kind === 'avatar' ? { photoUrl: url } : { bannerUrl: url });
      toast.success(kind === 'avatar' ? 'Photo updated' : 'Cover updated');
    } catch (error) {
      toast.error(
        'Upload failed',
        error instanceof Error ? error.message : 'Try a different image.',
      );
    } finally {
      setProgress(null);
    }
  }

  const isBusy = avatarProgress !== null || bannerProgress !== null || save.isPending;

  return (
    <>
      <div className="relative">
        {/* ------------------------------------------------------ cover -- */}
        <div className="relative h-28 overflow-hidden sm:h-36">
          {account.bannerUrl ? (
            <button
              type="button"
              onClick={() => setViewing({ src: account.bannerUrl!, alt: 'Cover image' })}
              className="block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <img src={account.bannerUrl} alt="" className="size-full object-cover" />
            </button>
          ) : (
            <div className="size-full bg-[linear-gradient(115deg,var(--color-violet-600),var(--color-violet-800))]" />
          )}

          {available && (
            <div className="absolute top-2 right-2 flex gap-1.5">
              {account.bannerUrl && !isBusy && (
                <HeaderButton
                  label="Remove cover image"
                  onClick={() => save.mutate({ bannerUrl: null })}
                  icon={<Trash2 className="size-4" />}
                />
              )}
              <HeaderButton
                label={account.bannerUrl ? 'Change cover image' : 'Add a cover image'}
                onClick={() => bannerInput.current?.click()}
                disabled={isBusy}
                icon={
                  bannerProgress !== null ? (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )
                }
                text={bannerProgress !== null ? `${bannerProgress}%` : undefined}
              />
            </div>
          )}
        </div>

        {/* ----------------------------------------------------- avatar -- */}
        <div className="px-5">
          <div className="-mt-9 flex items-end gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  account.photoUrl
                    ? setViewing({ src: account.photoUrl, alt: `${account.displayName}'s photo` })
                    : avatarInput.current?.click()
                }
                aria-label={account.photoUrl ? 'View profile photo' : 'Add a profile photo'}
                className={cn(
                  'block rounded-full ring-4 ring-[var(--bg-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  account.photoUrl ? 'cursor-zoom-in' : 'cursor-pointer',
                )}
              >
                <Avatar
                  name={account.displayName}
                  src={account.photoUrl}
                  size="lg"
                  verified={account.verificationTiers.length > 0}
                />
              </button>

              {available && (
                <button
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                  disabled={isBusy}
                  aria-label={account.photoUrl ? 'Change profile photo' : 'Add a profile photo'}
                  className="absolute -right-0.5 -bottom-0.5 flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-[var(--bg-surface)] bg-brand text-white shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-wait"
                >
                  {avatarProgress !== null ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Camera aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              )}

              {avatarProgress !== null && (
                <span
                  className="absolute -bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-brand px-2 py-0.5 text-2xs font-semibold text-white tabular-nums"
                  aria-live="polite"
                >
                  {avatarProgress}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={avatarInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file, 'avatar', setAvatarProgress);
          e.target.value = '';
        }}
      />
      <input
        ref={bannerInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file, 'banner', setBannerProgress);
          e.target.value = '';
        }}
      />

      {viewing && (
        <ImageLightbox src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

function HeaderButton({
  label,
  onClick,
  icon,
  text,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  text?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[rgb(15_16_32_/_0.5)] px-2.5 text-2xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-[rgb(15_16_32_/_0.68)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-wait"
    >
      {icon}
      {text && <span className="tabular-nums">{text}</span>}
    </button>
  );
}
