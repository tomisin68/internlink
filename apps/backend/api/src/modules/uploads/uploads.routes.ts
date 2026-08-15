import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import {
  UploadKindSchema,
  type UploadCapabilities,
  type UploadKind,
} from '@internlink/shared-types';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { badRequest, unauthenticated, upstreamUnavailable } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploadLimiter } from '../../middleware/rate-limit.js';
import { env, hasCloudinaryCredentials, hasCloudinaryUnsigned } from '../../config/env.js';

export const uploadsRouter = Router();

/**
 * GET /v1/uploads/status
 *
 * Lets the client find out whether uploads work *before* offering one.
 *
 * Without this, an unconfigured Cloudinary shows up as a 503 only after the
 * user has picked a file — which reads as "your file was rejected" rather than
 * "this feature is off". Offering a control that cannot succeed is worse than
 * not offering it, so the UI hides the uploader instead.
 *
 * The unsigned fields are safe to hand out: a cloud name and an unsigned preset
 * are public by design — Cloudinary's own widget embeds both in page source.
 * The preset itself carries the folder and format restrictions, which is what
 * stops it being a general-purpose upload endpoint for the internet.
 */
uploadsRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const payload: UploadCapabilities = {
      available: hasCloudinaryCredentials || hasCloudinaryUnsigned,
      signed: hasCloudinaryCredentials,
      unsigned: hasCloudinaryUnsigned,
      cloudName: env.CLOUDINARY_CLOUD_NAME ?? null,
      uploadPreset: hasCloudinaryUnsigned ? env.CLOUDINARY_UPLOAD_PRESET! : null,
    };
    sendOk(res, payload);
  }),
);

let configured = false;
function ensureCloudinary(): void {
  if (!hasCloudinaryCredentials) {
    throw upstreamUnavailable('File uploads');
  }
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME!,
    api_key: env.CLOUDINARY_API_KEY!,
    api_secret: env.CLOUDINARY_API_SECRET!,
    secure: true,
  });
  configured = true;
}

/**
 * Per-kind upload constraints — SRS §5.2 requires type and size validation
 * before anything reaches Cloudinary.
 *
 * These are enforced twice on purpose: the signature below pins them so
 * Cloudinary itself rejects a mismatched upload, and the client checks them
 * first so the user gets an instant, specific error instead of a failed
 * round trip.
 */
export const UPLOAD_RULES: Record<
  UploadKind,
  { folder: string; maxBytes: number; formats: string[]; resourceType: 'image' | 'raw' | 'auto' }
> = {
  avatar: {
    folder: 'avatars',
    maxBytes: 5 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    resourceType: 'image',
  },
  /**
   * Feed carousel content. `auto` lets one endpoint take both stills and video,
   * which is what a mixed carousel needs — Cloudinary decides the resource type
   * from the bytes rather than from a client-declared field we would then have
   * to trust.
   *
   * 100MB covers a phone-shot clip of a minute or so. Larger than that wants
   * chunked upload, which the plain POST path here does not do.
   */
  post_media: {
    folder: 'posts',
    maxBytes: 100 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'mp4', 'mov', 'webm', 'm4v', 'avi'],
    resourceType: 'auto',
  },
  company_logo: {
    folder: 'company-logos',
    maxBytes: 5 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
    resourceType: 'image',
  },
  cv: {
    folder: 'cvs',
    maxBytes: 10 * 1024 * 1024,
    formats: ['pdf', 'doc', 'docx'],
    resourceType: 'raw',
  },
  verification_doc: {
    folder: 'verification',
    maxBytes: 15 * 1024 * 1024,
    formats: ['pdf', 'jpg', 'jpeg', 'png'],
    resourceType: 'raw',
  },
};

const SignRequestSchema = z.object({
  kind: UploadKindSchema,
  /** Client-reported, checked against the rule so an oversized file is refused
   *  before we hand out a signature at all. */
  bytes: z.number().int().positive().optional(),
});

/**
 * POST /v1/uploads/signature
 *
 * SRS §7.1 — clients never hold Cloudinary secrets. They ask for a signature
 * scoped to one folder and one moment in time, then upload directly. The
 * signature expires with the timestamp, so a leaked one is worth nothing an
 * hour later.
 */
uploadsRouter.post(
  '/signature',
  requireAuth,
  uploadLimiter,
  validate(SignRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    ensureCloudinary();

    const { kind, bytes } = req.body as z.infer<typeof SignRequestSchema>;
    const rule = UPLOAD_RULES[kind];

    if (bytes && bytes > rule.maxBytes) {
      throw badRequest(
        `That file is too large. The limit for this is ${Math.round(rule.maxBytes / 1024 / 1024)}MB.`,
        { file: [`Maximum size is ${Math.round(rule.maxBytes / 1024 / 1024)}MB.`] },
      );
    }

    const timestamp = Math.round(Date.now() / 1000);
    // Scoping the folder to the account ID means one user's signature can never
    // be replayed to overwrite another user's asset.
    const folder = `${env.CLOUDINARY_UPLOAD_FOLDER}/${rule.folder}/${req.auth.accountId}`;

    const paramsToSign = {
      timestamp,
      folder,
      allowed_formats: rule.formats.join(','),
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET!);

    sendOk(res, {
      signature,
      timestamp,
      apiKey: env.CLOUDINARY_API_KEY!,
      cloudName: env.CLOUDINARY_CLOUD_NAME!,
      folder,
      uploadPreset: null,
      allowedFormats: rule.formats,
      maxBytes: rule.maxBytes,
      resourceType: rule.resourceType,
    });
  }),
);
