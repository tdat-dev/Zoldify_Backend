import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import {
  AssistantFilters,
  buildReply,
  dropUnaskedFilters,
  rankByName,
} from './assistant-filters';
import { AssistantModel, ChatMessage } from './assistant-model';

/**
 * Ngân sách cho mô hình. Chủ dự án đặt trần: tìm phải dưới 10 giây, không thì
 * người mua dùng ô tìm kiếm cho nhanh. Mô hình 6 giây + truy vấn (thường dưới 1
 * giây, có cache) + mạng vẫn dưới 10. Quá ngân sách thì tìm bằng câu gõ.
 */
export const MODEL_BUDGET_MS = 6_000;

/** Sau mốc này không nới từ khoá nữa: thêm một lượt tìm có thể vượt trần 10 giây. */
const RELAX_DEADLINE_MS = 7_500;

/** Số món trả về một lượt: vừa một hàng thẻ trong khung chat. */
const RESULT_LIMIT = 6;
/**
 * Lấy rộng hơn rồi mới lọc tỉnh: GET /products chưa có bộ lọc tỉnh (chỉ trang
 * đích theo địa điểm mới có), nên lọc trên 40 món khớp nhất. Đủ cho câu hỏi
 * có từ khoá; từ khoá quá chung thì tỉnh có thể không lọt vào 40 món này, khi
 * đó trợ lý nói rõ là đã mở rộng ra cả nước thay vì im lặng trả món tỉnh khác.
 */
const FETCH_SIZE = '40';

export interface SuggestedProduct {
  id: number;
  name: string;
  price: number;
  image: string | null;
  condition: string | null;
  province_name: string | null;
}

/** Các trường trợ lý đọc từ một dòng của GET /products. */
interface ProductRow {
  id: number;
  name: string;
  price: string | number;
  stock: number;
  image?: string | null;
  condition?: string | null;
  province_name?: string | null;
  province_slug?: string | null;
}

/** "Thành phố Hồ Chí Minh" và "ho-chi-minh" phải khớp nhau. */
function provinceSlug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/^(tinh|thanh pho|tp\.?)\s+/, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class AssistantService {
  private readonly log = new Logger(AssistantService.name);

  constructor(
    private readonly model: AssistantModel,
    private readonly products: ProductsService,
  ) {}

  /**
   * Cờ đọc lúc gọi chứ không lúc dựng: staging bật, prod chưa bật. Tắt thì
   * trả 404 như route không tồn tại, không lộ là có tính năng đang ẩn.
   */
  private isEnabled(): boolean {
    return process.env.AI_ASSISTANT_ENABLED === 'true';
  }

  /** Một lượt tìm: món còn hàng, đã xếp hạng và bỏ món khớp kém theo tên. */
  private async searchRanked(f: AssistantFilters): Promise<ProductRow[]> {
    const { q, price_min, price_max, condition, sort } = f;
    const page = (await this.products.findAll('1', FETCH_SIZE, {
      q,
      price_min,
      price_max,
      condition,
      sort,
    })) as { result?: ProductRow[] };
    return rankByName(
      (page?.result ?? []).filter((p) => Number(p.stock) > 0),
      q,
    );
  }

  /** Web hỏi cái này để biết có hiện nút trợ lý không. */
  status() {
    return { enabled: this.isEnabled() };
  }

  async ask(history: ChatMessage[]) {
    if (!this.isEnabled()) throw new NotFoundException();
    const startedAt = Date.now();
    const lastUserText =
      [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

    let understood: { filters?: AssistantFilters; text?: string } = {};
    try {
      understood = await Promise.race([
        this.model.understand(history),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`quá ${MODEL_BUDGET_MS} ms`)),
            MODEL_BUDGET_MS,
          ),
        ),
      ]);
    } catch (e) {
      this.log.warn(`Mô hình lỗi, tìm bằng câu gõ: ${(e as Error).message}`);
    }
    if (!understood.filters && understood.text) {
      return {
        reply: understood.text,
        products: [] as SuggestedProduct[],
        filters: null,
      };
    }
    let fallback = false;
    let filters = understood.filters
      ? dropUnaskedFilters(
          understood.filters,
          history.filter((m) => m.role === 'user').map((m) => m.content),
        )
      : undefined;
    if (!filters) {
      fallback = true;
      filters = { q: lastUserText.replace(/\s+/g, ' ').trim().slice(0, 80) };
    }

    // Tìm, xếp hạng; rỗng thì nới từ khoá MỘT lần (bỏ chữ cuối: "bàn làm việc gỗ"
    // thành "bàn làm việc"), chỉ khi còn thời gian trong trần 10 giây. Từ khoá
    // hai chữ không nới: "máy ảnh" thành "máy" ra máy nướng bánh mì.
    let inStock = await this.searchRanked(filters);
    const words = filters.q.split(' ');
    if (
      !inStock.length &&
      words.length > 2 &&
      Date.now() - startedAt < RELAX_DEADLINE_MS
    ) {
      const shorter = { ...filters, q: words.slice(0, -1).join(' ') };
      const retry = await this.searchRanked(shorter);
      if (retry.length) {
        inStock = retry;
        filters = shorter;
      }
    }

    let picked = inStock;
    const relaxed: string[] = [];
    if (filters.province) {
      const wanted = provinceSlug(filters.province);
      const local = inStock.filter(
        (p) =>
          p.province_slug === wanted ||
          provinceSlug(String(p.province_name ?? '')) === wanted,
      );
      if (local.length) picked = local;
      else relaxed.push(`tỉnh ${filters.province}`);
    }

    // Chỉ trả trường cần cho thẻ: mô tả của người bán không đi ra khỏi đây.
    const products: SuggestedProduct[] = picked
      .slice(0, RESULT_LIMIT)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        image: p.image ?? null,
        condition: p.condition ?? null,
        province_name: p.province_name ?? null,
      }));
    return {
      reply: buildReply(filters, products.length, relaxed),
      products,
      filters,
      fallback,
    };
  }
}
