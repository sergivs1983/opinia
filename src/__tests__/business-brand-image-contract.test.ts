/**
 * BL-0 — Business Brand Image contract tests.
 * Run: npx tsx src/__tests__/business-brand-image-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BusinessBrandImageParamsSchema,
  BusinessBrandImageUploadSchema,
} from '../lib/validations/schemas';
import {
  buildBusinessImageStoragePaths,
  validateBrandImageFile,
} from '../lib/business-images';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (filePath: string) => fs.readFileSync(path.join(root, filePath), 'utf8');

console.log('\n=== SCHEMAS ===');

const paramsHappy = BusinessBrandImageParamsSchema.safeParse({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
assert('Params schema happy path', paramsHappy.success);

const paramsInvalid = BusinessBrandImageParamsSchema.safeParse({
  id: 'not-a-uuid',
});
assert('Params schema invalid path', !paramsInvalid.success);

const uploadDefault = BusinessBrandImageUploadSchema.safeParse({});
assert('Upload schema defaults kind=logo', uploadDefault.success && uploadDefault.data.kind === 'logo');

const uploadCover = BusinessBrandImageUploadSchema.safeParse({
  kind: 'cover',
});
assert('Upload schema accepts cover', uploadCover.success);

const uploadInvalid = BusinessBrandImageUploadSchema.safeParse({
  kind: 'banner',
});
assert('Upload schema rejects invalid kind', !uploadInvalid.success);

console.log('\n=== FILE VALIDATION ===');

const fileValid = validateBrandImageFile({ type: 'image/png', size: 512_000 });
assert('File validation accepts png <= 4MB', fileValid.ok);

const fileMimeInvalid = validateBrandImageFile({ type: 'text/plain', size: 64 });
assert('File validation rejects non-image mimetype', !fileMimeInvalid.ok && fileMimeInvalid.error === 'invalid_mime');

const fileTooLarge = validateBrandImageFile({ type: 'image/webp', size: 5 * 1024 * 1024 });
assert('File validation rejects files > 4MB', !fileTooLarge.ok && fileTooLarge.error === 'file_too_large');

console.log('\n=== STORAGE PATH ===');

const paths = buildBusinessImageStoragePaths({
  businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'logo',
  mimeType: 'image/jpeg',
  now: new Date('2026-02-20T12:00:00.000Z'),
});

assert('Storage bucket is business-images', paths.storageBucket === 'business-images');
assert('Storage path includes business-images prefix', paths.storagePath.startsWith('business-images/'));
assert('Storage object path includes business id', paths.objectPath.startsWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/'));

console.log('\n=== ROUTE CONTRACT ===');

const uploadRoute = read('src/app/api/businesses/[id]/brand-image/route.ts');
includes('Upload route validates params', uploadRoute, 'validateParams(params, BusinessBrandImageParamsSchema)');
includes('Upload route parses multipart form-data', uploadRoute, 'request.formData()');
includes('Upload route validates workspace ownership', uploadRoute, "workspaceBusinessId && workspaceBusinessId !== routeParams.id");
includes('Upload route validates mimetype', uploadRoute, 'Unsupported image type. Allowed: image/png, image/jpeg, image/webp.');
includes('Upload route validates size', uploadRoute, 'Image file too large. Maximum size is 4MB.');
includes('Upload route uploads to storage', uploadRoute, '.upload(objectPath, fileBuffer');
includes('Upload route persists business image metadata', uploadRoute, 'brand_image_path: storagePath');
includes('Upload route returns request_id', uploadRoute, 'request_id: requestId');

const signedUrlRoute = read('src/app/api/businesses/[id]/brand-image/signed-url/route.ts');
includes('Signed URL route validates params', signedUrlRoute, 'validateParams(params, BusinessBrandImageParamsSchema)');
includes('Signed URL route validates membership ownership', signedUrlRoute, ".from('memberships')");
includes('Signed URL route returns 401 unauthenticated', signedUrlRoute, "{ error: 'unauthenticated', request_id: requestId }");
includes('Signed URL route returns 404 when image missing', signedUrlRoute, "{ error: 'not_found', request_id: requestId }");
includes('Signed URL route signs URL for 24h', signedUrlRoute, '.createSignedUrl(objectKey, 60 * 60 * 24)');
includes('Signed URL route returns url + expiresAt', signedUrlRoute, 'url: signedData.signedUrl');
includes('Signed URL route returns expiresAt', signedUrlRoute, 'expiresAt');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
