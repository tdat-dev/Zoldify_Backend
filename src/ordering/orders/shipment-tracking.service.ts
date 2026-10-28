import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, MoreThan, Between } from 'typeorm';
import { timingSafeEqual } from 'crypto';
import { GhnService } from '@ordering/ghn/ghn.service';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { KENH_THONG_BAO, type KenhThongBao } from '@common/kenh-thong-bao';
import { ThongBaoDon } from './thong-bao-don';
import { chayGioiHan } from './chay-gioi-han';

/** Giới hạn một lượt đồng bộ GHN định kỳ (xem `dongBoTatCa`). */
export interface GioiHanDongBo {
  /** Số lô mỗi câu SELECT. */
  kichLo: number;
  /** Số lời gọi GHN cùng lúc. */
  songSong: number;
  /** Số nhóm tối đa mỗi lượt. */
  toiDaLo: number;
  /** Thời gian tối đa mỗi lượt, ms. */
  toiDaMs: number;
}

/**
 * 30 nhóm x 200 = 6000 lô một lượt; GHN ~300ms với 4 luồng là ~8 phút. Hạn
 * 20 phút chặn ca GHN ốm (timeout 10s mỗi lời gọi): job chạy mỗi giờ, và sau
 * nó còn `autoConfirmDueShipments` trong cùng job. Quá 6000 lô đang đi thì
 * phần dư sang lượt sau (con trỏ), chậm nhất vài giờ chứ không bỏ sót.
 */
export const GIOI_HAN_DONG_BO: Readonly<GioiHanDongBo> = {
  kichLo: 200,
  songSong: 4,
  toiDaLo: 30,
  toiDaMs: 20 * 60_000,
};

/**
 * Trạng thái GHN nghĩa là "tài xế đã cầm hàng đi": từ `picked` trở về sau trên
 * đường giao xuôi. Gặp một trong số này thì đơn phải là "Đang giao".
 *
 * Có cả `delivered`: webhook có thể rơi đúng sự kiện `picked` (deploy, mạng),
 * lần đầu nghe tin đã là giao xong; đơn khi đó vẫn phải qua "Đang giao".
 *
 * Cố ý KHÔNG có `ready_to_pick` / `picking` (tài xế chưa lấy), `cancel`, và
 * nhánh hoàn `return*` / `waiting_to_return`: hàng quay về người bán không phải
 * "đang giao cho người mua", xử lý hoàn hàng là việc riêng chưa làm.
 */
const GHN_DA_LAY_HANG = new Set([
  'picked',
  'storing',
  'transporting',
  'sorting',
  'delivering',
  'money_collect_delivering',
  'delivery_fail',
  'delivered',
]);

/**
 * Trạng thái GHN nghĩa là "hàng KHÔNG tới tay người mua theo đường thường":
 * hoàn về người bán, GHN huỷ, thất lạc, hư hỏng, hoặc kẹt ngoại lệ.
 *
 * Tới 27/10 lượt đồng bộ chỉ nghe hai thứ (đã lấy hàng, đã giao), nên gặp một
 * trong số này thì không gì xảy ra: lô nằm CREATED, đơn nằm "Đang giao" vĩnh
 * viễn, tiền người mua kẹt trong ký quỹ, không ai được báo. Đo bằng các bài
 * "GHN báo ..." trong `shipment-tracking.service.spec.ts`.
 *
 * Xử lý ở đây CỐ Ý tối thiểu: ghi lý do lên lô + báo quản trị viên. KHÔNG tự
 * huỷ đơn, KHÔNG tự hoàn tiền: "hoàn hàng" có thể là người mua từ chối nhận
 * (hoàn tiền trừ phí ship?) hay địa chỉ sai (giao lại?), "thất lạc" thì GHN
 * đền cho người bán chứ không phải sàn. Tự động hoá những quyết định đó trên
 * một tín hiệu từ bên ngoài là đặt tiền vào tay một chuỗi trạng thái mình
 * không kiểm soát. Gỡ khi có luồng xử lý hoàn hàng thật.
 */
type NhomSuCo = 'hoan-hang' | 'huy' | 'that-lac';

/**
 * Dấu `OrdersService.huyVanDonGhnTruoc` ghi lên lô TRƯỚC khi gọi GHN huỷ, gỡ
 * đi nếu GHN từ chối. Lượt theo dõi gặp GHN báo "cancel" trên lô mang dấu này
 * thì biết đó là việc chính mình đang làm, không báo admin (review 27/10, mục
 * E): bản đầu gọi GHN huỷ rồi mới đánh dấu FAILED, webhook "cancel" rơi đúng
 * vào khe giữa là mọi admin nhận báo sự cố cho một lần huỷ bình thường.
 */
export const DANG_HUY_VAN_DON = 'Đang huỷ vận đơn trên GHN vì đơn hàng bị huỷ.';

/**
 * Trạng thái GHN -> NHÓM sự cố. Chống báo trùng theo NHÓM, không theo trạng
 * thái thô (review 27/10): một lần hoàn hàng bình thường đi qua năm trạng thái
 * (return -> return_transporting -> return_sorting -> returning -> returned),
 * và bản đầu lấy trạng thái thô làm khoá chống trùng nên mọi admin nhận năm
 * thông báo cho cùng một kiện. Với admin, cả chuỗi đó là MỘT việc: "hàng đang
 * quay về người bán". Đổi nhóm (đang hoàn rồi thất lạc) mới là tin mới.
 */
const GHN_SU_CO = new Map<string, NhomSuCo>([
  ['waiting_to_return', 'hoan-hang'],
  ['return', 'hoan-hang'],
  ['returning', 'hoan-hang'],
  ['return_transporting', 'hoan-hang'],
  ['return_sorting', 'hoan-hang'],
  ['returned', 'hoan-hang'],
  ['cancel', 'huy'],
  ['lost', 'that-lac'],
  ['damage', 'that-lac'],
  ['exception', 'that-lac'],
]);

/**
 * Lý do ghi vào cột `error` của lô, CỐ ĐỊNH theo nhóm: chính chuỗi này là
 * khoá chống báo trùng. Trạng thái thô của GHN chỉ đi vào log và vào `data`
 * của thông báo, không vào đây.
 */
const LY_DO_SU_CO: Record<NhomSuCo, string> = {
  'hoan-hang':
    'GHN đang hoàn hàng về người bán. Cần quản trị viên xử lý; hệ thống ' +
    'không tự hoàn tiền.',
  huy:
    'GHN đã huỷ vận đơn. Cần quản trị viên xử lý; hệ thống không tự hoàn ' +
    'tiền.',
  'that-lac':
    'GHN báo hàng thất lạc, hư hỏng hoặc gặp sự cố. Cần quản trị viên xử ' +
    'lý; hệ thống không tự hoàn tiền.',
};

/**
 * "GHN nói gì về lô hàng này" — MỘT chỗ duy nhất, hai đường vào.
 *
 * Đường nhanh: webhook GHN gọi ngay khi trạng thái đổi (task #26).
 * Lưới an toàn: worker quét định kỳ mỗi giờ (task #14).
 *
 * VÌ SAO GIỮ CẢ HAI. Webhook nhanh nhưng không đảm bảo tới: GHN có thể gọi lúc
 * máy chủ đang deploy, mạng rớt, hoặc URL cấu hình sai. Mất một sự kiện
 * "đã giao" nghĩa là escrow người bán không bao giờ được giải ngân — hỏng câm,
 * không ai báo. Nên lượt quét định kỳ ở lại làm lưới: chậm nhất một giờ là bắt
 * được thứ webhook đánh rơi.
 *
 * VÌ SAO TÁCH KHỎI OrdersService. Không phải để cho gọn — mà để bài kiểm dựng
 * được. `OrdersService` có mười phụ thuộc (escrow, payos, giỏ, sản phẩm...);
 * muốn kiểm một lượt webhook thì phải dựng cả chuỗi đó. Lớp này chỉ cần repo
 * lô hàng và GhnService, nên `shipment-tracking.service.spec.ts` dựng nó bằng
 * hai dòng và chạy trên database thật.
 */
@Injectable()
export class ShipmentTrackingService {
  private readonly logger = new Logger(ShipmentTrackingService.name);

  /** Spec thu nhỏ để thấy hạn hoạt động mà không cần dựng 6000 lô. */
  gioiHanDongBo: GioiHanDongBo = { ...GIOI_HAN_DONG_BO };

  /** `id` lô cuối mà lượt quét trước đã hỏi; lượt sau đi tiếp từ đây. */
  private conTro = 0;

  constructor(
    @InjectRepository(OrderShipment)
    private readonly shipments: Repository<OrderShipment>,
    private readonly ghn: GhnService,
    // Không đánh dấu @Optional: thiếu provider thì Nest phải chết lúc dựng
    // (check:boot bắt được), chứ không lặng lẽ thôi báo cho người mua. Dấu `?`
    // chỉ để các spec cũ dựng lớp này bằng hai tham số vẫn biên dịch được.
    @Inject(KENH_THONG_BAO) private readonly kenh?: KenhThongBao,
  ) {}

  /**
   * Báo người mua sau khi trạng thái đã ghi xong. Không bao giờ ném (xem
   * `thong-bao-don.ts`): lượt đồng bộ GHN không được hỏng vì FCM chập.
   */
  private baoTheoLo(
    loId: number,
    suKien: 'dang-giao' | 'giao-toi-cua',
  ): Promise<void> {
    return new ThongBaoDon(
      this.kenh,
      this.shipments.manager,
      this.logger,
    ).baoTheoLo(loId, suKien);
  }

  /**
   * Cửa đầu tiên: token bí mật trong URL webhook.
   *
   * GHN không ký payload như PayOS, và bảng điều khiển của họ chỉ cho khai một
   * URL callback — không đặt được header riêng. Nên bí mật buộc phải nằm trong
   * chính URL.
   *
   * `timingSafeEqual` chứ không `===`: so sánh chuỗi thường thoát ra ngay ký tự
   * đầu khác nhau, nên thời gian trả lời rò rỉ token đúng được bao nhiêu ký tự.
   * Dò từng ký tự một thì token 32 ký tự chỉ còn vài nghìn lần thử thay vì
   * 62^32. Đây là endpoint dẫn tới tiền, không đáng tiết kiệm chỗ này.
   */
  private kiemToken(token: string | undefined): void {
    const dung = process.env.GHN_WEBHOOK_TOKEN ?? '';

    // Chưa cấu hình thì ĐÓNG, không mở. Một webhook tiền mà để trống biến môi
    // trường là mở toang; thà 401 hết và người deploy phải điền.
    if (!dung) {
      this.logger.error('GHN_WEBHOOK_TOKEN chưa đặt — từ chối mọi webhook.');
      throw new UnauthorizedException('Webhook chưa được cấu hình');
    }

    const a = Buffer.from(token ?? '', 'utf8');
    const b = Buffer.from(dung, 'utf8');
    // timingSafeEqual ném khi hai buffer khác độ dài, nên phải chặn trước.
    // Độ dài token thì không phải bí mật đáng giá.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token webhook không hợp lệ');
    }
  }

  /**
   * Chuyển một lô sang "đã giao". ĐÂY LÀ BẢN DUY NHẤT — webhook và lượt quét
   * định kỳ đều đi qua đây.
   *
   * Có bản sao thứ hai là chuyện đã xảy ra thật trong repo này: `TasksService`
   * từng chép lại đường huỷ đơn của `OrdersService` và chép kèm cả lỗi, để tiền
   * người mua kẹt trong `escrow_hold` không lối ra. Bài học ghi ở đầu
   * `tasks.service.ts` là "đừng có bản sao thứ hai", nên ở đây không tạo cái nào.
   *
   * Chỉ đi MỘT chiều `CREATED → DELIVERED`. Hai lý do:
   *   - GHN gửi lại (retry) thì lần hai không ghi đè `delivered_at`, nếu không
   *     cửa sổ tự-xác-nhận bị đẩy lùi mỗi lần GHN gọi lại.
   *   - Webhook tới sai thứ tự thì không kéo `RECEIVED` (đã giải ngân) ngược về
   *     `DELIVERED` — trạng thái cuối phải là cuối.
   */
  private async danhDauDaGiao(lo: OrderShipment): Promise<boolean> {
    if (lo.status !== ShipmentStatus.CREATED) return false;
    // MỘT câu UPDATE có điều kiện, CHỈ hai cột vừa đổi, chứ không `save(lo)`.
    //
    // `lo` được nạp TRƯỚC lời gọi GHN (vài giây, có khi tới timeout 10s).
    // Người mua bấm "Đã nhận hàng" trong quãng đó thì dòng đã là RECEIVED,
    // có received_at, tiền đã nhả. Bản cũ lưu nguyên entity cũ: kéo lô về
    // DELIVERED và xoá received_at, rồi job tự xác nhận N ngày sau thấy lô
    // "chưa nhận" và gọi giải ngân lần nữa. Đo bằng hai bài "không ghi đè lô
    // người mua vừa xác nhận" trong `shipment-tracking.service.spec.ts`.
    //
    // `status = created` trong WHERE là phép kiểm thật; phép kiểm trên `lo`
    // phía trên chỉ để khỏi gửi câu lệnh vô ích.
    const kq = await this.shipments.update(
      { id: lo.id, status: ShipmentStatus.CREATED },
      { status: ShipmentStatus.DELIVERED, delivered_at: new Date() },
    );
    if (!kq.affected) return false;
    // Nhắc người mua bấm "Đã nhận hàng": không bấm thì tiền người bán chờ đủ
    // cửa sổ tự xác nhận (AUTO_CONFIRM_RECEIPT_DAYS) mới được nhả.
    await this.baoTheoLo(lo.id, 'giao-toi-cua');
    return true;
  }

  /**
   * GHN báo sự cố (xem GHN_SU_CO): báo quản trị viên, RỒI MỚI ghi lý do của
   * nhóm vào cột `error` của lô. Trả true nếu lượt này là lượt ghi.
   *
   * Cột `error` là dấu "đã báo rồi": cùng nhóm thì lượt quét mỗi giờ (và
   * webhook GHN gửi lại) không báo nữa, báo lại mỗi giờ là dạy admin bỏ qua
   * thông báo.
   *
   * BÁO TRƯỚC, ĐÁNH DẤU SAU (review 27/10). Bản đầu ghi dấu trước rồi mới báo,
   * mà hàm báo nuốt lỗi: FCM hay MySQL chập đúng lần đó là dấu đã nằm trên lô,
   * lượt sau thấy dấu và im lặng, kiện hàng đang hoàn không ai biết. Nay chỉ
   * đánh dấu khi ít nhất một admin nhận được tin; báo hỏng hết thì lượt sau
   * thử lại. Đổi lại: webhook và lượt quét chạy trùng đúng khoảnh khắc thì có
   * thể báo hai lần, chấp nhận được hơn là báo không lần nào.
   *
   * `status = created` trong WHERE: lô đã DELIVERED/RECEIVED/FAILED thì
   * không viết đè lý do của nó.
   */
  private async ghiSuCo(lo: OrderShipment, thuc: string): Promise<boolean> {
    const nhom = GHN_SU_CO.get(thuc);
    if (!nhom) return false;
    const loi = LY_DO_SU_CO[nhom];

    // Đọc lại dòng lô NGAY LÚC NÀY: `lo` được nạp trước lời gọi GHN.
    const [hienTai] = await this.shipments.manager.query<
      Array<{ status: string; error: string | null; don: string }>
    >(
      `SELECT s.status, s.error, o.status AS don
         FROM order_shipments s
         JOIN orders o ON o.id = s.order_id
        WHERE s.id = ?`,
      [lo.id],
    );
    if (
      !hienTai ||
      hienTai.status !== (ShipmentStatus.CREATED as string) ||
      hienTai.error === loi
    ) {
      return false;
    }
    // GHN huỷ vì CHÍNH mình huỷ: đang huỷ (dấu DANG_HUY_VAN_DON) hoặc đơn đã
    // đóng. Không phải sự cố, không làm phiền admin.
    if (
      nhom === 'huy' &&
      (hienTai.error === DANG_HUY_VAN_DON ||
        [OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(
          hienTai.don as OrderStatus,
        ))
    ) {
      return false;
    }

    // Trạng thái thô của GHN đi vào log (để điều tra), không vào khoá chống
    // báo trùng.
    this.logger.error(
      `Vận đơn ${lo.tracking_code} (lô #${lo.id}): GHN báo "${thuc}" ` +
        `(nhóm ${nhom}).`,
    );
    const soDaBao = await new ThongBaoDon(
      this.kenh,
      this.shipments.manager,
      this.logger,
    ).baoAdminSuCoVanDon(lo.id, thuc);
    if (soDaBao === 0) {
      this.logger.warn(
        `Chưa báo được admin nào về vận đơn ${lo.tracking_code}; KHÔNG đánh ` +
          'dấu, lượt đồng bộ sau sẽ báo lại.',
      );
      return false;
    }

    const kq = await this.shipments
      .createQueryBuilder()
      .update(OrderShipment)
      .set({ error: loi })
      .where('id = :id AND status = :st', {
        id: lo.id,
        st: ShipmentStatus.CREATED,
      })
      .andWhere('(error IS NULL OR error <> :loi)', { loi })
      .execute();
    return (kq.affected ?? 0) > 0;
  }

  /**
   * Đưa đơn của lô này sang "Đang giao" khi GHN báo tài xế đã lấy hàng.
   *
   * MỘT câu UPDATE có điều kiện chứ không đọc-rồi-ghi: webhook và lượt quét mỗi
   * giờ có thể chạy cùng lúc trên cùng một đơn. Điều kiện `status IN
   * (confirmed, processing)` vừa làm câu lệnh chạy lại vô hại, vừa chặn kéo
   * ngược một đơn đã huỷ, đã giao hay đã hoàn tiền về "Đang giao".
   *
   * Đi qua `shipments.manager` thay vì tiêm thêm repo Order: lớp này cố ý chỉ
   * có hai phụ thuộc để bài kiểm dựng được bằng hai dòng (xem đầu file).
   */
  private async chuyenDonSangDangGiao(lo: OrderShipment): Promise<boolean> {
    const kq = await this.shipments.manager
      .createQueryBuilder()
      .update(Order)
      .set({ status: OrderStatus.SHIPPING })
      .where(
        'id = (SELECT s.order_id FROM order_shipments s WHERE s.id = :loId)',
        {
          loId: lo.id,
        },
      )
      .andWhere('status IN (:...truoc)', {
        truoc: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING],
      })
      .execute();
    const doi = (kq.affected ?? 0) > 0;
    // Chỉ lượt thật sự đổi đơn mới báo: webhook và lượt quét chạy chồng nhau
    // thì lượt sau `affected = 0`, người mua không nhận hai tin.
    if (doi) await this.baoTheoLo(lo.id, 'dang-giao');
    return doi;
  }

  /**
   * Một lượt webhook từ GHN.
   *
   * ĐIỀU QUAN TRỌNG NHẤT TRONG HÀM NÀY: thân request KHÔNG được tin.
   *
   * GHN gửi kèm trạng thái, nhưng nếu lấy thẳng trạng thái đó mà ghi vào
   * database thì bí mật trong URL là thứ DUY NHẤT chặn giữa kẻ lạ và tiền ký
   * quỹ — mà URL thì nằm trong log máy chủ, log proxy, lịch sử trình duyệt của
   * người cấu hình. Rò một lần là rò vĩnh viễn.
   *
   * Nên webhook ở đây chỉ là TÍN HIỆU "có gì đó đổi, đi xem đi". Trạng thái
   * thật lấy bằng cách gọi ngược `getOrderStatus` hỏi chính GHN. Kẻ giả mạo
   * biết cả URL lẫn mã vận đơn thì cùng lắm làm hệ thống tốn một request sang
   * GHN — không dịch chuyển được một đồng nào.
   *
   * Trả 200 cho gần như mọi trường hợp (trừ token sai): webhook trả lỗi là GHN
   * xếp hàng gửi lại, và gửi lại một mã mình không quản lý thì lặp vô ích mãi.
   */
  async xuLyWebhook(
    token: string | undefined,
    body: Record<string, unknown>,
  ): Promise<{ known: boolean; updated: boolean }> {
    this.kiemToken(token);

    // GHN đặt tên trường không thống nhất giữa các bản tài liệu; nhận cả bốn
    // cách viết đã gặp thay vì cãi nhau với nhà cung cấp lúc production đang lỗi.
    //
    // Lọc bằng `typeof === 'string'` chứ không `??`: thân request là dữ liệu
    // của người ngoài, nên `OrderCode: { $ne: null }` hay `OrderCode: 123` phải
    // rơi ra ở đây thay vì đi tiếp xuống câu truy vấn.
    const ma = [
      body?.OrderCode,
      body?.order_code,
      body?.ClientOrderCode,
      body?.CodeGHN,
    ].find((v): v is string => typeof v === 'string' && v.length > 0);

    if (!ma) {
      this.logger.warn('Webhook GHN không có mã vận đơn — bỏ qua.');
      return { known: false, updated: false };
    }

    const lo = await this.shipments.findOne({ where: { tracking_code: ma } });
    if (!lo) {
      // Không phải lỗi: GHN có thể gửi cho vận đơn của môi trường khác dùng
      // chung tài khoản (staging và production cùng một shop GHN).
      this.logger.warn(`Webhook GHN cho mã lạ ${ma} — bỏ qua.`);
      return { known: false, updated: false };
    }

    // Đã ở trạng thái cuối thì khỏi làm phiền GHN.
    if (lo.status !== ShipmentStatus.CREATED) {
      return { known: true, updated: false };
    }

    let thuc: string | null;
    try {
      thuc = await this.ghn.getOrderStatus(ma);
    } catch (err) {
      // Hỏi lại GHN không được thì DỪNG, không đoán. Lượt quét định kỳ mỗi giờ
      // sẽ thử lại — chậm hơn nhưng không sai.
      this.logger.error(
        `Không hỏi lại được GHN cho ${ma}: ${(err as Error).message}. ` +
          'Để lượt đồng bộ định kỳ xử lý.',
      );
      return { known: true, updated: false };
    }

    if (thuc !== null && GHN_SU_CO.has(thuc)) {
      return { known: true, updated: await this.ghiSuCo(lo, thuc) };
    }

    const dangGiao =
      thuc !== null && GHN_DA_LAY_HANG.has(thuc)
        ? await this.chuyenDonSangDangGiao(lo)
        : false;
    if (dangGiao)
      this.logger.log(`Webhook GHN: ${ma} đã lấy hàng, đơn sang Đang giao.`);

    if (thuc !== 'delivered') {
      if (!dangGiao)
        this.logger.log(`Webhook ${ma}: GHN đang báo "${thuc}", chưa chốt.`);
      return { known: true, updated: dangGiao };
    }

    const doi = await this.danhDauDaGiao(lo);
    if (doi) this.logger.log(`Webhook GHN: lô ${ma} chuyển sang đã giao.`);
    return { known: true, updated: doi || dangGiao };
  }

  /**
   * Lượt quét định kỳ — lưới an toàn cho webhook, chạy trong tiến trình worker.
   *
   * KHÔNG giải ngân ở đây: "đã giao tới cửa" chưa phải "người mua đã nhận và
   * ưng". Việc chốt tiền để cho `autoConfirmDueShipments` (sau N ngày) hoặc
   * người mua bấm tay.
   *
   * VÌ SAO CHIA NHÓM, SONG SONG 4, VÀ CÓ HẠN (rà soát "1 triệu dòng" 28/10).
   * Bản trước `find()` MỌI lô CREATED không `take`, rồi hỏi GHN từng lô một,
   * nối tiếp. GHN trả lời ~300ms, chậm thì tới timeout 10s: 5000 lô đang đi
   * là 25 phút khi GHN khoẻ, hàng giờ khi GHN ốm, và suốt thời gian đó cả
   * mảng lô nằm trên heap 256MB của worker. Đo bằng `dong-bo-ghn-theo-lo.spec.ts`.
   *
   * Nay:
   *   - Keyset theo `id`, `kichLo` (200) lô mỗi câu. Không OFFSET: lô đổi
   *     trạng thái giữa chừng làm OFFSET trượt và bỏ sót lô.
   *   - Mỗi nhóm hỏi GHN tối đa `songSong` (4) lô cùng lúc: nhanh gần 4 lần,
   *     mà không dội GHN và không chiếm hết 5 kết nối MySQL của worker.
   *   - Một lượt dừng sau `toiDaLo` nhóm hoặc `toiDaMs`, cái nào tới trước,
   *     và lượt sau đi TIẾP từ `conTro` chứ không làm lại từ đầu. Không có con
   *     trỏ thì lô cuối bảng không bao giờ tới lượt khi bảng lớn hơn hạn.
   *
   * Con trỏ nằm trong bộ nhớ: worker khởi động lại thì quét lại từ đầu, chỉ
   * tốn thêm lời gọi GHN chứ không sai (mọi bước ghi đều có điều kiện).
   */
  async dongBoTatCa(): Promise<{ checked: number; delivered: number }> {
    const { kichLo, songSong, toiDaLo, toiDaMs } = this.gioiHanDongBo;
    const hanChot = Date.now() + toiDaMs;
    const hetGio = () => Date.now() >= hanChot;

    // Lượt bắt đầu giữa bảng được quay vòng MỘT lần về đầu bảng và dừng ở chỗ
    // đã bắt đầu: bảng nhỏ hơn hạn thì một lượt vẫn phủ đủ mọi lô như bản cũ.
    const batDau = this.conTro;
    let tu = batDau;
    let daVongLai = false;
    let soNhom = 0;
    let checked = 0;
    let delivered = 0;

    while (soNhom < toiDaLo && !hetGio()) {
      const nhom = await this.shipments.find({
        where: {
          status: ShipmentStatus.CREATED,
          tracking_code: Not(IsNull()),
          id: daVongLai ? Between(tu + 1, batDau) : MoreThan(tu),
        },
        order: { id: 'ASC' },
        take: kichLo,
      });

      if (!nhom.length) {
        if (!daVongLai && batDau > 0) {
          daVongLai = true;
          tu = 0;
          continue;
        }
        // Hết một vòng trọn: lượt sau bắt đầu lại từ đầu bảng.
        tu = 0;
        break;
      }
      soNhom += 1;

      const daChay = await chayGioiHan(
        nhom,
        songSong,
        async (lo) => {
          if (await this.dongBoMotLo(lo)) delivered += 1;
        },
        hetGio,
      );
      checked += daChay;
      // Lô lấy theo đúng thứ tự `id`, nên phần đã chạy là một đoạn đầu liền
      // mạch: con trỏ đặt ở lô cuối đã chạy, lô hết giờ chưa kịp hỏi sẽ là lô
      // đầu của lượt sau.
      if (daChay > 0) tu = nhom[daChay - 1].id;
      if (daChay < nhom.length) break;
    }

    // Quay vòng xong mà chưa chạm hạn thì vòng đã trọn: lượt sau từ đầu bảng.
    this.conTro = daVongLai && tu >= batDau ? 0 : tu;
    if (soNhom >= toiDaLo || hetGio()) {
      this.logger.warn(
        `Đồng bộ GHN dừng theo hạn (${soNhom} nhóm, ${checked} lô); lượt ` +
          `sau đi tiếp sau lô #${this.conTro}.`,
      );
    }
    return { checked, delivered };
  }

  /**
   * Một lô của lượt quét. Nuốt lỗi: một lô hỏng không được làm chết cả lượt,
   * và nay còn không được làm chết ba lô đang chạy song song cùng nhóm.
   */
  private async dongBoMotLo(lo: OrderShipment): Promise<boolean> {
    if (!lo.tracking_code) return false;
    try {
      const thuc = await this.ghn.getOrderStatus(lo.tracking_code);
      if (thuc !== null && GHN_SU_CO.has(thuc)) {
        await this.ghiSuCo(lo, thuc);
        return false;
      }
      if (thuc !== null && GHN_DA_LAY_HANG.has(thuc)) {
        await this.chuyenDonSangDangGiao(lo);
      }
      if (thuc === 'delivered') return await this.danhDauDaGiao(lo);
      return false;
    } catch (err) {
      // Một lô hỏng không được làm chết cả lượt — lô sau vẫn phải được xét.
      this.logger.error(
        `Đồng bộ trạng thái GHN lỗi (vận đơn ${lo.tracking_code}): ${(err as Error).message}`,
      );
      return false;
    }
  }
}
