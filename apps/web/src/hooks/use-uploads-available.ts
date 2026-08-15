import { useQuery } from '@tanstack/react-query';
import { uploadApi } from '@/features/auth/auth-api';

/**
 * Whether media uploads are usable in this environment.
 *
 * Cached for the whole session: the answer depends on server configuration,
 * which cannot change while the tab is open. Defaults to `true` while loading
 * so the uploader does not flicker out and back in on every mount.
 */
export function useUploadsAvailable(): { available: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['uploads', 'status'],
    queryFn: uploadApi.status,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    // A failed probe should not disable a feature that might work — assume
    // available and let the real upload surface any error.
    placeholderData: { available: true },
  });

  return { available: data?.available ?? true, isLoading };
}
