import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Config } from './config';
import { captureError, logger } from './observability';

/** MinIO in development, Cloudflare R2 or S3 in production. */
export function createS3Client(s3: Config['s3']): S3Client {
  const isR2 = s3.endpoint.includes('r2.cloudflarestorage.com');
  return new S3Client({
    endpoint: s3.endpoint,
    region: isR2 ? 'auto' : 'us-east-1',
    credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    forcePathStyle: !isR2,
  });
}

/**
 * Make sure the media bucket exists. **It stays private**: the media route in
 * `routes/media.ts` is the only way to read an object, and it sets the
 * headers that stop a stored file being served as an active document.
 */
export async function ensureBucket(s3: S3Client, bucket: string, retries = 10, delayMs = 2000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        logger.info(`Object storage bucket "${bucket}" ready (private)`);
        return;
      } catch (headErr: any) {
        if (headErr.name === 'NotFound' || headErr.$metadata?.httpStatusCode === 404) {
          // Local MinIO in development.
          await s3.send(new CreateBucketCommand({ Bucket: bucket }));
          logger.info(`Object storage bucket "${bucket}" created`);
          return;
        }
        // Bucket-scoped tokens on R2 and S3 may not HEAD the bucket.
        if (headErr.name === 'AccessDenied' || headErr.Code === 'AccessDenied' || headErr.$metadata?.httpStatusCode === 403) {
          logger.info(`Object storage bucket "${bucket}" ready (bucket-scoped token)`);
          return;
        }
        throw headErr;
      }
    } catch (e: any) {
      if (e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists') return;
      if (i < retries - 1) {
        logger.warn(`Object storage attempt ${i + 1}/${retries} failed (${e.message}); retrying`);
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        captureError('Object storage setup failed after maximum retries', e);
      }
    }
  }
}
