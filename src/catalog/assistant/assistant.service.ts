import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { CategoriesService } from '../categories/categories.service';
import { ProductsService } from '../products/products.service';
import {
  AssistantFilters,
  buildReply,
  dropGenericPhrase,
  dropUnaskedFilters,
  isGreeting,
  rankByName,
  relatesToUser,
} from './assistant-filters';
import { parseFallback } from './assistant-fallback';
import { AssistantModel, ChatMessage, ReviewInput } from './assistant-model';
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
 * Nhận xét của AI đi lượt gọi riêng (POST /assistant/review), web gọi sau khi
 * đã hiện món. Đo staging 12/11 khi còn chờ chung một lượt: lượt nhận xét lúc 3
 * giây lúc hơn 5 giây, câu chậm nhất mất 9,1 giây mà AI vẫn không kịp. Tách ra
 * thì món hiện sau khoảng 3 giây, câu AI đến sau, chậm cũng không chặn ai.
 *
 * Dữ liệu cho lượt nhận xét lưu ở Redis chứ không nhận từ trình duyệt: staging
 * và prod chạy 3 bản api, hai lượt gọi có thể rơi vào hai bản khác nhau; và
 * nếu nhận tên món từ trình duyệt thì ai cũng dùng được khoá AI để hỏi chuyện
 * khác. Mỗi mã chỉ dùng một lần.
 */
const REVIEW_TTL_MS = 120_000;
const REVIEW_TIMEOUT_MS = 8_000;
const reviewKey = (id: string) => `assistant:review:${id}`;

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
    // Tuỳ chọn để bài kiểm không cần Redis; thiếu thì không có lượt nhận xét.
    @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    @Optional() private readonly categories?: CategoriesService,
  ) {}

  /**
   * Tên danh mục đang có hàng, để mô hình gợi ý món sàn bán. Danh sách danh mục
   * có cache Redis nên không thêm truy vấn; lỗi thì bỏ qua, mô hình vẫn chạy.
   */
  private async categoryNames(): Promise<string[]> {
    if (!this.categories) return [];
    try {
      const page = (await this.categories.findAll('1', '50', '')) as {
        result?: { name: string; is_active?: number; product_count?: number }[];
      };
      return (page?.result ?? [])
        .filter((c) => c.is_active !== 0 && Number(c.product_count) > 0)
        .map((c) => c.name);
    } catch (e) {
      this.log.warn(`Không lấy được danh mục: ${(e as Error).message}`);
      return [];
    }
  }

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
    // Câu chào không cần mô hình. Đo staging 13/11: một lượt "chào bạn" mô hình
    // trả q "quà tặng" (dính câu trước qua router) và trợ lý đưa ra 4 món.
    if (isGreeting(lastUserText)) {
      return {
        reply: GREETING_REPLY,
        products: [] as SuggestedProduct[],
        filters: null,
      };
    }

    let understood: { filters?: AssistantFilters; text?: string } = {};
    try {
      understood = await Promise.race([
        this.categoryNames().then((names) =>
          this.model.understand(history, names),
        ),
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
    const userTexts = history
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    if (understood.filters && !relatesToUser(understood.filters.q, userTexts)) {
      this.log.warn(
        `Từ khoá mô hình không dính câu người dùng, bỏ: ${understood.filters.q}`,
      );
      understood = {};
    }
    let filters = understood.filters
      ? dropUnaskedFilters(understood.filters, userTexts)
      : undefined;
    if (!filters) {
      fallback = true;
      filters = parseFallback(history);
      if (!filters.q) {
        filters = { q: lastUserText.replace(/\s+/g, ' ').trim().slice(0, 80) };
      }
    }
    // Mô hình lỗi mà câu chỉ là lời chào: chào lại, không đem đi tìm.
    if (fallback && isGreeting(filters.q)) {
      return {
        reply: GREETING_REPLY,
        products: [] as SuggestedProduct[],
        filters: null,
      };
    }
    filters = { ...filters, q: dropGenericPhrase(filters.q) };

    // Tìm, xếp hạng. Rỗng thì thử theo thứ tự:
    //  1. Tên món mô hình gợi ý, khi câu là nhu cầu ("tai nghe chống ồn", "quà
    //     tặng bạn gái"): tên món không chứa mấy chữ đó. Đo staging 13/11: hai
    //     câu này ra rỗng cả 3 lần. Các tên tìm song song, mỗi tên lấy vài món,
    //     mỗi nhóm so giá trong nhóm của nó.
    //  2. Nới từ khoá MỘT lần (bỏ chữ cuối: "bàn làm việc gỗ" thành "bàn làm
    //     việc"), chỉ khi còn thời gian trong trần 10 giây. Từ khoá hai chữ không
    //     nới: "máy ảnh" thành "máy" ra máy nướng bánh mì.
    let [inStock, market] = await this.searchWithMarket(filters);
    let groups: [ProductRow[], ProductRow[]][] = [[inStock, market]];
    let suggestedFrom: string[] | null = null;
    const words = filters.q.split(' ');
    if (!inStock.length && filters.alternatives?.length) {
      const found = await Promise.all(
        filters.alternatives.map((a) =>
          this.searchWithMarket({ ...filters, q: a }),
        ),
      );
      if (found.some(([rows]) => rows.length)) {
        groups = found;
        suggestedFrom = filters.alternatives.filter(
          (_, i) => found[i][0].length,
        );
      }
    } else if (
      !inStock.length &&
      words.length > 2 &&
      Date.now() - startedAt < RELAX_DEADLINE_MS
    ) {
      const shorter = { ...filters, q: words.slice(0, -1).join(' ') };
      const [retry, retryMarket] = await this.searchWithMarket(shorter);
      if (retry.length) {
        inStock = retry;
        market = retryMarket;
        groups = [[inStock, market]];
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
      if (groups.some(([rows]) => rows.some(isLocal))) inPlace = isLocal;
      else relaxed.push(`tỉnh ${filters.province}`);
    }

    // Mỗi món đi kèm tập so giá của nhóm nó (một nhóm khi tìm thường, mỗi tên
    // gợi ý một nhóm): không đem tai nghe Sony so với AirPods.
    // Lấy xoay vòng: mỗi nhóm một món mỗi vòng, tới đủ RESULT_LIMIT. Nhóm nhiều
    // món bù cho nhóm ít. Đo staging 13/11 khi còn lấy cứng 2 món mỗi tên gợi ý:
    // "laptop học lập trình" có tên "laptop" nhiều món mà cả lượt chỉ ra 1 đến 3.
    const entries: { p: ProductRow; over: boolean; group: ProductRow[] }[] = [];
    const seen = new Set<number>();
    const queues = groups.map(([rows, group]) => ({
      rows: rows.filter(inPlace),
      group,
    }));
    for (let round = 0; entries.length < RESULT_LIMIT; round++) {
      const left = queues.filter((g) => g.rows.length > round);
      if (!left.length) break;
      for (const { rows, group } of left) {
        const p = rows[round];
        if (seen.has(p.id) || entries.length >= RESULT_LIMIT) continue;
        seen.add(p.id);
        entries.push({ p, over: false, group });
      }
    }
    const pickedCount = entries.length;

    // Ít món trong tầm giá: thêm món vượt tối đa 30%, rẻ trước, có đánh dấu.
    const ceiling = filters.price_max;
    if (ceiling && !suggestedFrom && pickedCount < FEW_RESULTS) {
      market
        .filter(
          (p) =>
            inPlace(p) &&
            Number(p.price) > ceiling &&
            Number(p.price) <= ceiling * OVER_BUDGET_RATIO &&
            !seen.has(p.id),
        )
        .sort((a, b) => Number(a.price) - Number(b.price))
        .slice(0, MAX_OVER_BUDGET)
        .forEach((p) => entries.push({ p, over: true, group: market }));
    }
    const extrasCount = entries.length - pickedCount;

    const references = new Map<ProductRow[], number | null>();
    const referenceOf = (group: ProductRow[]) => {
      if (!references.has(group))
        references.set(group, marketPrice(group.map((p) => Number(p.price))));
      return references.get(group) ?? null;
    };
    // Chỉ trả trường cần cho thẻ: mô tả của người bán không đi ra khỏi đây.
    const products: SuggestedProduct[] = entries.map(({ p, over, group }) => {
      const price = Number(p.price);
      const condition = p.condition ?? null;
      const reference = referenceOf(group);
      return {
        id: p.id,
        name: p.name,
        price,
        image: p.image ?? null,
        condition,
        province_name: p.province_name ?? null,
        ...baseReview({ price, condition }, reference, group.length),
        market_price: reference,
        over_budget: over,
      };
    });
    const reviewId = await this.saveForReview(products);

    let reply: string;
    if (suggestedFrom && pickedCount) {
      reply =
        `Không có món nào ghi đúng "${filters.q}". Mình gợi ý vài món gần với ý bạn: ` +
        `${suggestedFrom.join(', ')}. Bấm Mua ngay để vào thẳng trang đặt hàng.`;
    } else {
      reply =
        pickedCount || !extrasCount
          ? buildReply(filters, pickedCount, relaxed)
          : `Mình không thấy món "${filters.q}" nào trong tầm giá bạn nêu.`;
    }
    if (extrasCount) {
      reply += ` Có thêm ${extrasCount} món vượt ngân sách chút ít (tối đa 30%) để bạn so.`;
    }
    return {
      reply,
      products,
      filters,
      fallback,
      review_id: reviewId,
    };
  }

  /**
   * Lưu dữ liệu cho lượt nhận xét, trả mã để web gọi /assistant/review. Không
   * có nhãn giá thì không lưu: AI không có gì để nói thêm ngoài tình trạng (đo
   * staging 12/11: iPhone dưới 10 triệu vẫn gọi AI, hết giờ, chẳng được câu nào).
   */
  private async saveForReview(
    products: SuggestedProduct[],
  ): Promise<string | null> {
    if (!this.cache || !products.some((p) => p.verdict)) return null;
    const id = randomUUID();
    const inputs: ReviewInput[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      condition: p.condition,
      market_price: p.market_price,
      verdict: p.verdict,
      over_budget: p.over_budget,
    }));
    try {
      await this.cache.set(reviewKey(id), inputs, REVIEW_TTL_MS);
      return id;
    } catch (e) {
      // Redis lỗi: vẫn trả món với câu tính sẵn, chỉ thiếu câu AI.
      this.log.warn(`Không lưu được dữ liệu nhận xét: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Lượt hai: AI viết một câu cho từng món đã trả ở lượt chat. Mã dùng một lần
   * (xoá trước khi gọi AI) để không ai bấm lặp tốn lượt gọi. Lỗi, hết giờ hay
   * mã lạ thì trả rỗng: web giữ câu server tính sẵn.
   */
  async review(id: string): Promise<{ notes: Record<number, string> }> {
    if (!this.isEnabled()) throw new NotFoundException();
    if (!this.cache) return { notes: {} };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const inputs = await this.cache.get<ReviewInput[]>(reviewKey(id));
      if (!inputs?.length) return { notes: {} };
      await this.cache.del(reviewKey(id));
      const notes = await Promise.race([
        this.model.review(inputs, REVIEW_TIMEOUT_MS),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`quá ${REVIEW_TIMEOUT_MS} ms`)),
            REVIEW_TIMEOUT_MS,
          );
        }),
      ]);
      return { notes: Object.fromEntries(notes) };
    } catch (e) {
      this.log.warn(`AI nhận xét lỗi: ${(e as Error).message}`);
      return { notes: {} };
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
