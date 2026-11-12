import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import {
  AssistantFilters,
  buildReply,
  dropGenericPhrase,
  dropUnaskedFilters,
  isGreeting,
  rankByName,
} from './assistant-filters';
import { AssistantModel, ChatMessage } from './assistant-model';
import { baseReview, marketPrice, Verdict } from './assistant-review';

/**
 * Ngân sách cho mô hình. Chủ dự án đặt trần: tìm phải dưới 10 giây, không thì
 * người mua dùng ô tìm kiếm cho nhanh. Mô hình 6 giây + truy vấn (thường dưới 1
 * giây, có cache) + mạng vẫn dưới 10. Quá ngân sách thì tìm bằng câu gõ.
 */
export const MODEL_BUDGET_MS = 6_000;

/** Sau mốc này không nới từ khoá nữa: thêm một lượt tìm có thể vượt trần 10 giây. */
const RELAX_DEADLINE_MS = 7_500;

/**
 * Lượt nhận xét của AI phải xong trước mốc này (tính từ lúc nhận câu), để cả
 * lượt trả lời vẫn dưới trần 10 giây; còn ít hơn MIN_REVIEW_MS thì bỏ, dùng câu
 * server tính sẵn. Đo staging 12/11 với mốc 9 giây: câu chậm nhất mất 8,2 giây
 * tính ở máy người dùng, nên hạ xuống 8,5 để dư chỗ cho mạng.
 */
const REVIEW_DEADLINE_MS = 8_500;
const MIN_REVIEW_MS = 1_500;

/**
 * Ít món trong tầm giá thì thêm món vượt tối đa chừng này. Đo 12/11: "nồi cơm
 * điện dưới 600k" chỉ có 1 món (540k), món kế là 635k bị giấu đi.
 */
const OVER_BUDGET_RATIO = 1.3;
const FEW_RESULTS = 3;
const MAX_OVER_BUDGET = 3;

/** Câu chào lại khi mô hình đem câu chào đi tìm như tên món. */
const GREETING_REPLY =
  'Chào bạn! Bạn muốn tìm mua món gì? Gõ tên món, tầm giá và nơi nhận, ví dụ: nồi cơm điện dưới 600k ở HCM.';

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
  /** Nhãn giá do server tính: rẻ, ngang hay cao hơn giá giữa các món cùng loại. */
  verdict: Verdict | null;
  /** Một câu nhận xét: của AI nếu kịp, không thì câu server tính sẵn. */
  note: string;
  market_price: number | null;
  /** Món vượt ngân sách người dùng nêu, đưa thêm để so. */
  over_budget: boolean;
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
    if (understood.filters && isGreeting(understood.filters.q)) {
      understood = { text: GREETING_REPLY };
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
    filters = { ...filters, q: dropGenericPhrase(filters.q) };

    // Tìm, xếp hạng; rỗng thì nới từ khoá MỘT lần (bỏ chữ cuối: "bàn làm việc gỗ"
    // thành "bàn làm việc"), chỉ khi còn thời gian trong trần 10 giây. Từ khoá
    // hai chữ không nới: "máy ảnh" thành "máy" ra máy nướng bánh mì.
    let [inStock, market] = await this.searchWithMarket(filters);
    const words = filters.q.split(' ');
    if (
      !inStock.length &&
      words.length > 2 &&
      Date.now() - startedAt < RELAX_DEADLINE_MS
    ) {
      const shorter = { ...filters, q: words.slice(0, -1).join(' ') };
      const [retry, retryMarket] = await this.searchWithMarket(shorter);
      if (retry.length) {
        inStock = retry;
        market = retryMarket;
        filters = shorter;
      }
    }

    const relaxed: string[] = [];
    let inPlace: (p: ProductRow) => boolean = () => true;
    if (filters.province) {
      const wanted = provinceSlug(filters.province);
      const isLocal = (p: ProductRow) =>
        p.province_slug === wanted ||
        provinceSlug(String(p.province_name ?? '')) === wanted;
      if (inStock.some(isLocal)) inPlace = isLocal;
      else relaxed.push(`tỉnh ${filters.province}`);
    }
    const picked = inStock.filter(inPlace).slice(0, RESULT_LIMIT);

    // Ít món trong tầm giá: thêm món vượt tối đa 30%, rẻ trước, có đánh dấu.
    const ceiling = filters.price_max;
    const extras =
      ceiling && picked.length < FEW_RESULTS
        ? market
            .filter(
              (p) =>
                inPlace(p) &&
                Number(p.price) > ceiling &&
                Number(p.price) <= ceiling * OVER_BUDGET_RATIO &&
                !picked.some((x) => x.id === p.id),
            )
            .sort((a, b) => Number(a.price) - Number(b.price))
            .slice(0, MAX_OVER_BUDGET)
        : [];

    const reference = marketPrice(market.map((p) => Number(p.price)));
    // Chỉ trả trường cần cho thẻ: mô tả của người bán không đi ra khỏi đây.
    const products: SuggestedProduct[] = [
      ...picked.map((p) => ({ p, over: false })),
      ...extras.map((p) => ({ p, over: true })),
    ].map(({ p, over }) => {
      const price = Number(p.price);
      const condition = p.condition ?? null;
      return {
        id: p.id,
        name: p.name,
        price,
        image: p.image ?? null,
        condition,
        province_name: p.province_name ?? null,
        ...baseReview({ price, condition }, reference, market.length),
        market_price: reference,
        over_budget: over,
      };
    });
    const reviewedByAi = await this.addAiNotes(products, startedAt);

    let reply =
      picked.length || !extras.length
        ? buildReply(filters, picked.length, relaxed)
        : `Mình không thấy món "${filters.q}" nào trong tầm giá bạn nêu.`;
    if (extras.length) {
      reply += ` Có thêm ${extras.length} món vượt ngân sách chút ít (tối đa 30%) để bạn so.`;
    }
    return {
      reply,
      products,
      filters,
      fallback,
      reviewed_by_ai: reviewedByAi,
    };
  }

  /**
   * Thay câu nhận xét tính sẵn bằng câu của AI nếu còn thời gian. Chỉ gửi trường
   * có cấu trúc; nhãn giá giữ nguyên của server. Lỗi hay hết giờ thì giữ câu
   * tính sẵn, người mua vẫn thấy đánh giá.
   */
  private async addAiNotes(
    products: SuggestedProduct[],
    startedAt: number,
  ): Promise<boolean> {
    const left = REVIEW_DEADLINE_MS - (Date.now() - startedAt);
    // Không có nhãn giá thì AI không có gì để nói thêm ngoài tình trạng. Đo
    // staging 12/11: iPhone dưới 10 triệu vẫn gọi, AI hết giờ, lượt mất 8,9 giây.
    if (!products.some((p) => p.verdict)) return false;
    if (left < MIN_REVIEW_MS) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const notes = await Promise.race([
        this.model.review(
          products.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            condition: p.condition,
            market_price: p.market_price,
            verdict: p.verdict,
            over_budget: p.over_budget,
          })),
          left,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`quá ${left} ms`)), left);
        }),
      ]);
      for (const p of products) {
        const note = notes.get(p.id);
        if (note) p.note = note;
      }
      return notes.size > 0;
    } catch (e) {
      this.log.warn(
        `AI nhận xét lỗi, dùng câu tính sẵn: ${(e as Error).message}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Tìm theo bộ lọc, và cùng lúc tìm lại không kèm giá để có tập so giá (giá
   * phổ biến) và món sát ngân sách. Không có bộ lọc giá thì hai tập là một.
   */
  private async searchWithMarket(
    f: AssistantFilters,
  ): Promise<[ProductRow[], ProductRow[]]> {
    if (f.price_min === undefined && f.price_max === undefined) {
      const rows = await this.searchRanked(f);
      return [rows, rows];
    }
    return Promise.all([
      this.searchRanked(f),
      this.searchRanked({ q: f.q, condition: f.condition }),
    ]);
  }
}
