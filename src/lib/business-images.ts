import type { Business } from '@/types/database';

export const BUSINESS_IMAGES_BUCKET = 'business-images';
export const MAX_BRAND_IMAGE_BYTES = 4 * 1024 * 1024;

export const ALLOWED_BRAND_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type BrandImageMimeType = (typeof ALLOWED_BRAND_IMAGE_MIME_TYPES)[number];
export type BusinessBrandImageKind = 'logo' | 'cover';

interface BuildBusinessImageStoragePathsArgs {
  businessId: string;
  kind: BusinessBrandImageKind;
  mimeType: BrandImageMimeType;
  now?: Date;
}

type BrandImageValidationResult =
  | { ok: true }
  | { ok: false; error: 'invalid_mime' | 'file_too_large' };

export type BusinessBrandImageRow = Pick<
  Business,
  'id' | 'brand_image_bucket' | 'brand_image_path' | 'brand_image_kind' | 'brand_image_updated_at'
>;

export function isAllowedBrandImageMimeType(value: string): value is BrandImageMimeType {
  return (ALLOWED_BRAND_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function validateBrandImageFile(file: { type: string; size: number }): BrandImageValidationResult {
  if (!isAllowedBrandImageMimeType(file.type)) {
    return { ok: false, error: 'invalid_mime' };
  }

  if (file.size > MAX_BRAND_IMAGE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }

  return { ok: true };
}

function mimeTypeToExtension(mimeType: BrandImageMimeType): 'png' | 'jpg' | 'webp' {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
  }
}

export function buildBusinessImageStoragePaths({
  businessId,
  kind,
  mimeType,
  now = new Date(),
}: BuildBusinessImageStoragePathsArgs): { storageBucket: string; storagePath: string; objectPath: string } {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ts = now.getTime();
  const extension = mimeTypeToExtension(mimeType);
  const fileName = `brand_${kind}_${ts}.${extension}`;
  const objectPath = `${businessId}/${year}/${month}/${fileName}`;
  const storagePath = `${BUSINESS_IMAGES_BUCKET}/${objectPath}`;

  return {
    storageBucket: BUSINESS_IMAGES_BUCKET,
    storagePath,
    objectPath,
  };
}

export function businessImageStoragePathToObjectPath(
  storagePath: string,
  bucket: string = BUSINESS_IMAGES_BUCKET,
): string {
  const prefix = `${bucket}/`;
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length);
  }

  return storagePath;
}
