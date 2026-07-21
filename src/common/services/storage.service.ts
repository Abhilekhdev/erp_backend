import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.validation';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  /** Relative key persisted in the DB, e.g. `products/12-uuid.png`. Identical in both modes. */
  path: string;
  /** URL the browser can load right now. */
  url: string;
}

/**
 * File storage with two interchangeable backends:
 *
 *  - **S3** when `AWS_BUCKET` is set (also works with any S3-compatible provider via `AWS_ENDPOINT`
 *    — MinIO, DigitalOcean Spaces, Cloudflare R2).
 *  - **Local disk** (`./uploads`) otherwise — the original behaviour, so nothing breaks when S3
 *    credentials are absent.
 *
 * The stored `path` is the SAME in both modes, so switching backends needs no data migration and no
 * frontend change: `main.ts` maps `/uploads/<path>` to a presigned S3 redirect when S3 is on, and to
 * the static folder when it isn't.
 */
const LOCAL_ROOT = join(process.cwd(), 'uploads');
/** Presigned GET lifetime. Long enough for a page to render, short enough that a leaked URL dies. */
const SIGNED_URL_TTL = 15 * 60;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** True when S3 is configured; false means local-disk mode. */
  isS3(): boolean {
    return Boolean(this.config.get('AWS_BUCKET', { infer: true }));
  }

  private bucket(): string {
    return this.config.get('AWS_BUCKET', { infer: true });
  }

  private s3(): S3Client {
    if (this.client) return this.client;
    const endpoint = this.config.get('AWS_ENDPOINT', { infer: true });
    const accessKeyId = this.config.get('AWS_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('AWS_SECRET_ACCESS_KEY', { infer: true });

    this.client = new S3Client({
      region: this.config.get('AWS_DEFAULT_REGION', { infer: true }),
      // Omit credentials entirely when unset so the SDK's default chain (IAM role, SSO,
      // ~/.aws/credentials) can take over — the right setup on EC2/ECS.
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get('AWS_USE_PATH_STYLE_ENDPOINT', { infer: true }),
    });
    return this.client;
  }

  /** `<folder>/<prefix>-<uuid><ext>` — uuid keeps names unguessable and collision-free. */
  private key(folder: string, originalName: string, prefix: string): string {
    const ext = (extname(originalName) || '').toLowerCase();
    return `${folder}/${prefix}-${randomUUID()}${ext}`;
  }

  /**
   * Persist a file and return its stable `path` + a loadable `url`.
   * `prefix` is only a readability aid in the key (e.g. the business id).
   */
  async put(folder: string, file: UploadedFileLike, prefix: string | number = 'f'): Promise<StoredFile> {
    const path = this.key(folder, file.originalname, String(prefix));

    if (this.isS3()) {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: path,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      return { path, url: await this.url(path) };
    }

    const full = join(LOCAL_ROOT, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, file.buffer);
    return { path, url: `/uploads/${path}` };
  }

  /**
   * A URL the browser can load. S3 objects stay PRIVATE — this returns a short-lived presigned GET
   * rather than requiring a public bucket.
   */
  async url(path: string): Promise<string> {
    if (!this.isS3()) return `/uploads/${path}`;
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({ Bucket: this.bucket(), Key: path }),
      { expiresIn: SIGNED_URL_TTL },
    );
  }

  /** Best-effort delete — a missing object must not fail the surrounding request. */
  async remove(path: string): Promise<void> {
    if (!path) return;
    try {
      if (this.isS3()) {
        await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: path }));
      } else {
        await unlink(join(LOCAL_ROOT, path));
      }
    } catch (e) {
      this.logger.warn(`Could not delete '${path}': ${(e as Error).message}`);
    }
  }
}
