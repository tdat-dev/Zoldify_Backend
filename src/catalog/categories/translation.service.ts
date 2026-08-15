import { Injectable, Logger } from '@nestjs/common';

/**
 * Dịch máy bằng Cloudflare Workers AI (model @cf/meta/m2m100-1.2b).
 *
 * Dùng để tự dịch TÊN DANH MỤC (vi -> en) lúc admin tạo/sửa. Danh mục ít khi
 * thêm nên số lần gọi rất nhỏ; kết quả lưu vào cột name_en (không gọi lại).
 *
 * TẮT MỀM: thiếu CF_ACCOUNT_ID hoặc CF_AI_TOKEN thì viToEn() trả null và luồng
 * tạo/sửa vẫn chạy bình thường (name_en để trống, frontend tự fallback về name).
 *
 * Biến môi trường:
 *   CF_ACCOUNT_ID  id tài khoản Cloudflare
 *   CF_AI_TOKEN    API token có quyền Workers AI (Read/Run)
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly accountId = process.env.CF_ACCOUNT_ID || '';
  private readonly token = process.env.CF_AI_TOKEN || '';

  isEnabled(): boolean {
    return !!(this.accountId && this.token);
  }

  /** Dịch tiếng Việt -> tiếng Anh. Trả null nếu chưa cấu hình hoặc lỗi. */
  async viToEn(text: string): Promise<string | null> {
    const src = (text || '').trim();
    if (!this.isEnabled() || !src) return null;
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/meta/m2m100-1.2b`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: src,
            source_lang: 'vietnamese',
            target_lang: 'english',
          }),
        },
      );
      const data: any = await res.json();
      const out: unknown = data?.result?.translated_text;
      if (typeof out === 'string' && out.trim()) return out.trim();
      this.logger.warn(
        `Dịch danh mục thất bại: ${JSON.stringify(data).slice(0, 200)}`,
      );
      return null;
    } catch (e) {
      this.logger.warn(`Dịch danh mục lỗi: ${(e as Error).message}`);
      return null;
    }
  }
}
