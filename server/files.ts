/**
 * Private files in S3 (one bucket, no public access, created by amplify/backend.ts):
 *
 *   uploads/<uuid>          a payment screenshot the browser just uploaded (deleted after a day)
 *   payments/<id>.<ext>     the screenshot of a stored registration
 *   passes/<id>.pdf         the participant pass, made only after approval
 *
 * The browser never gets a lasting address for any of them: uploads go through a presigned
 * POST limited to one key, one image type and 5 MB; downloads through presigned links that
 * expire within minutes and are handed out only after the API has checked who is asking.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadTicket } from '../src/lib/registration';

export interface FileStore {
  /** Where the browser may upload one screenshot of `contentType`, at most `maxBytes`. */
  presignUpload(uploadId: string, contentType: string, maxBytes: number): Promise<UploadTicket>;
  /** The bytes uploaded for `uploadId`; null if nothing was uploaded (or it is too large). */
  readUpload(uploadId: string, maxBytes: number): Promise<Uint8Array | null>;
  deleteUpload(uploadId: string): Promise<void>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** A link that works for `expiresInSeconds`; `downloadName` makes the browser save the file. */
  signedUrl(key: string, options: { expiresInSeconds: number; downloadName?: string }): Promise<string>;
}

export const uploadKey = (uploadId: string) => `uploads/${uploadId}`;

const isMissing = (error: unknown) => error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound');

export class S3Files implements FileStore {
  constructor(
    private readonly bucket: string,
    private readonly s3: S3Client = new S3Client({}),
  ) {}

  async presignUpload(uploadId: string, contentType: string, maxBytes: number): Promise<UploadTicket> {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: uploadKey(uploadId),
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: 600,
    });
    return { uploadId, url, fields };
  }

  async readUpload(uploadId: string, maxBytes: number): Promise<Uint8Array | null> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: uploadKey(uploadId) }));
      if ((object.ContentLength ?? 0) > maxBytes || !object.Body) {
        await object.Body?.transformToByteArray().catch(() => undefined);
        return null;
      }
      return await object.Body.transformToByteArray();
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async deleteUpload(uploadId: string) {
    await this.delete(uploadKey(uploadId));
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length }),
    );
  }

  async get(key: string) {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!object.Body) throw new Error(`S3 object ${key} is empty`);
    return object.Body.transformToByteArray();
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, { expiresInSeconds, downloadName }: { expiresInSeconds: number; downloadName?: string }) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(downloadName && { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '')}"` }),
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}
