import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Lưu ảnh/file lên Cloudflare R2 (API tương thích S3).
 *
 * TẮT MỀM: thiếu bất kỳ biến R2_* nào thì isEnabled() = false, và controller
 * tự quay về lưu đĩa (public/images) như cũ — nên máy dev không cấu hình R2 vẫn
 * chạy, và deploy không vỡ nếu khoá chưa nạp.
 *
 * Biến môi trường:
 *   R2_ACCOUNT_ID         id tài khoản Cloudflare (ghép thành endpoint)
 *   R2_ACCESS_KEY_ID      khoá API R2 (Object Read & Write)
 *   R2_SECRET_ACCESS_KEY  bí mật của khoá trên
 *   R2_BUCKET             tên bucket
 *   R2_PUBLIC_URL         domain công khai của bucket, vd https://img.zoldify.com
 *   R2_KEY_PREFIX         (tuỳ chọn) tiền tố key, vd "staging/" để tách staging↔prod
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket = process.env.R2_BUCKET || '';
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(
    /\/+$/,
    '',
  );
  private readonly prefix = (process.env.R2_KEY_PREFIX || '').replace(
    /^\/+|\/+$/g,
    '',
  );

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      this.bucket &&
      this.publicUrl
    ) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log(
        `R2 storage bật (bucket=${this.bucket}, public=${this.publicUrl}` +
          (this.prefix ? `, prefix=${this.prefix}/` : '') +
          ')',
      );
    } else {
      this.client = null;
      this.logger.warn(
        'R2 chưa cấu hình đủ — upload sẽ lưu vào đĩa public/images.',
      );
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  /** Đưa buffer lên R2, trả về URL công khai đầy đủ. */
  async upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    if (!this.client) throw new Error('R2 storage chưa được cấu hình');
    const fullKey = this.prefix ? `${this.prefix}/${key}` : key;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        // Ảnh đã có tên duy nhất (kèm timestamp) nên cache vĩnh viễn được.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicUrl}/${fullKey}`;
  }
}
