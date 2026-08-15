import type { PostMedia, UploadCapabilities, UploadKind } from '@internlink/shared-types';
import { api } from './api-client';

/**
 * Media uploads, in two modes.
 *
 * SIGNED (SRS §7.1) is what CVs and verification documents use: the API issues
 * a short-lived signature scoped to one folder, and the browser never holds a
 * Cloudinary secret.
 *
 * UNSIGNED is what feed photos and video use. An unsigned preset needs no
 * secret at all, which means media uploads keep working in an environment where
 * the API has no Cloudinary credentials — and it is the only mode that works
 * with the public web config alone. The preset pins the folder and the allowed
 * formats server-side in the Cloudinary console, so it is not an open endpoint
 * despite being callable without a signature.
 *
 * Preference order is signed-then-unsigned for documents (folder scoping per
 * account matters there) and unsigned-first for feed media (it is faster: no
 * signature round trip before the bytes start moving).
 */

/** Local fallback so uploads work even before the API is configured. */
const LOCAL_CONFIG = {
  cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || null,
  uploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || null,
};

export interface UploadTicket {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  allowedFormats: string[];
  maxBytes: number;
  resourceType: 'image' | 'raw' | 'auto';
}

export const uploadApi = {
  sign: (kind: UploadKind, bytes?: number) =>
    api.post<UploadTicket>('/uploads/signature', { kind, bytes }),

  status: () => api.get<UploadCapabilities>('/uploads/status'),
};

/** Merges what the API reports with the build-time fallback. */
export function resolveCapabilities(
  fromApi: UploadCapabilities | undefined,
): UploadCapabilities {
  const unsigned = Boolean(
    fromApi?.unsigned || (LOCAL_CONFIG.cloudName && LOCAL_CONFIG.uploadPreset),
  );

  return {
    available: Boolean(fromApi?.available) || unsigned,
    signed: Boolean(fromApi?.signed),
    unsigned,
    cloudName: fromApi?.cloudName ?? LOCAL_CONFIG.cloudName,
    uploadPreset: fromApi?.uploadPreset ?? LOCAL_CONFIG.uploadPreset,
  };
}

/* ---------------------------------------------------------------- limits -- */

export const MEDIA_LIMITS = {
  image: { maxBytes: 15 * 1024 * 1024, label: '15MB' },
  video: { maxBytes: 100 * 1024 * 1024, label: '100MB' },
} as const;

export const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,video/mp4,video/quicktime,video/webm';

export function mediaKindOf(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/* ---------------------------------------------------------------- upload -- */

interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * POSTs a file to Cloudinary with progress.
 *
 * XHR rather than fetch: fetch still cannot report upload progress, and a 60MB
 * video on a Nigerian mobile connection without a progress bar is
 * indistinguishable from a frozen app.
 */
function postToCloudinary(
  file: File,
  cloudName: string,
  resourceType: string,
  fields: Record<string, string>,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CloudinaryResponse> {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as CloudinaryResponse);
        return;
      }
      // Cloudinary puts something useful in `error.message` — an unsigned
      // preset that does not exist says so, which beats "the upload failed"
      // when someone is setting this up for the first time.
      let detail = '';
      try {
        detail = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        detail = '';
      }
      reject(new Error(detail || 'The upload failed. Try again.'));
    });

    xhr.addEventListener('error', () =>
      reject(new Error('The upload failed. Check your connection.')),
    );
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/**
 * Uploads a document through the signed path (CVs, logos, verification docs).
 *
 * Falls back to the unsigned preset when the API holds no Cloudinary secret,
 * so a fresh deployment is not stuck with a dead uploader.
 */
export async function uploadDocument(
  file: File,
  kind: Exclude<UploadKind, 'post_media'>,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; publicId: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  let ticket: UploadTicket | null = null;
  try {
    ticket = await uploadApi.sign(kind, file.size);
  } catch (error) {
    // Only an unavailable *signing endpoint* justifies the unsigned fallback.
    // A file the server rejected — wrong type, too big — is the user's to fix,
    // and retrying it unsigned would just move the same failure elsewhere.
    const canFallBack =
      isUpstreamUnavailable(error) && LOCAL_CONFIG.cloudName && LOCAL_CONFIG.uploadPreset;
    if (!canFallBack) throw error;

    const result = await postToCloudinary(
      file,
      LOCAL_CONFIG.cloudName!,
      'auto',
      { upload_preset: LOCAL_CONFIG.uploadPreset! },
      onProgress,
    );
    return { url: result.secure_url, publicId: result.public_id };
  }

  if (!ticket.allowedFormats.includes(extension)) {
    throw new Error(`That file type is not supported. Use ${ticket.allowedFormats.join(', ')}.`);
  }
  if (file.size > ticket.maxBytes) {
    throw new Error(
      `That file is too large. Maximum ${Math.round(ticket.maxBytes / 1024 / 1024)}MB.`,
    );
  }

  const result = await postToCloudinary(
    file,
    ticket.cloudName,
    ticket.resourceType,
    {
      api_key: ticket.apiKey,
      timestamp: String(ticket.timestamp),
      signature: ticket.signature,
      folder: ticket.folder,
      allowed_formats: ticket.allowedFormats.join(','),
    },
    onProgress,
  );

  return { url: result.secure_url, publicId: result.public_id };
}

function isUpstreamUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'upstream_unavailable'
  );
}

/**
 * Uploads one carousel item — photo or video — and returns it already shaped as
 * `PostMedia`.
 *
 * Cloudinary reports the real dimensions and duration, which is why they are
 * captured here rather than measured in the browser: the feed needs them to
 * reserve the right aspect ratio *before* the media loads, and a post that
 * reflows as each item decodes is a post you cannot read on a phone.
 */
export async function uploadPostMedia(
  file: File,
  capabilities: UploadCapabilities,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<PostMedia> {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error('Only photos and videos can be added to a post.');

  const limit = MEDIA_LIMITS[kind];
  if (file.size > limit.maxBytes) {
    throw new Error(`That ${kind} is too large. Maximum ${limit.label}.`);
  }

  const cloudName = capabilities.cloudName;
  if (!cloudName) throw new Error('Media uploads are not configured yet.');

  let result: CloudinaryResponse;

  if (capabilities.unsigned && capabilities.uploadPreset) {
    // No signature round trip — the bytes start moving on the first request.
    result = await postToCloudinary(
      file,
      cloudName,
      'auto',
      { upload_preset: capabilities.uploadPreset },
      onProgress,
      signal,
    );
  } else {
    const ticket = await uploadApi.sign('post_media', file.size);
    result = await postToCloudinary(
      file,
      ticket.cloudName,
      ticket.resourceType,
      {
        api_key: ticket.apiKey,
        timestamp: String(ticket.timestamp),
        signature: ticket.signature,
        folder: ticket.folder,
        allowed_formats: ticket.allowedFormats.join(','),
      },
      onProgress,
      signal,
    );
  }

  const isVideo = result.resource_type === 'video';

  return {
    kind: isVideo ? 'video' : 'image',
    url: result.secure_url,
    // Cloudinary derives a poster frame from any video by swapping the
    // extension — no separate upload, no separate storage.
    thumbnailUrl: isVideo ? result.secure_url.replace(/\.[^./]+$/, '.jpg') : null,
    width: result.width ?? null,
    height: result.height ?? null,
    durationSeconds: result.duration ?? null,
  };
}
