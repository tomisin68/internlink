import { useQuery } from '@tanstack/react-query';
import type { UploadCapabilities } from '@internlink/shared-types';
import { resolveCapabilities, uploadApi } from '@/lib/cloudinary';

/**
 * What media uploads this environment supports.
 *
 * Cached for the whole session: the answer depends on server configuration,
 * which cannot change while the tab is open.
 *
 * The build-time Cloudinary fallback is merged in, so an unsigned preset shipped
 * with the client keeps photo and video uploads working even when the API has
 * no Cloudinary credentials of its own.
 */
export function useUploadCapabilities(): { capabilities: UploadCapabilities; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['uploads', 'status'],
    queryFn: uploadApi.status,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return { capabilities: resolveCapabilities(data), isLoading };
}

/** Whether *any* upload path works. Kept for the document uploaders. */
export function useUploadsAvailable(): { available: boolean; isLoading: boolean } {
  const { capabilities, isLoading } = useUploadCapabilities();
  // Assume available while the probe is in flight — the uploader flickering out
  // and back in on every mount is worse than a rare error on a dead config.
  return { available: isLoading || capabilities.available, isLoading };
}
