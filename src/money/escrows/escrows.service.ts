import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Escrow, EscrowStatus } from './entities/escrow.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { normalizePagination } from '@common/dto/pagination.dto';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';

@Injectable()
export class EscrowsService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepository: Repository<Escrow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly platformFee: PlatformFeeService,
  ) {}
  /**
   * Tách tiền của đơn thành từng khoản ký quỹ, mỗi người bán một khoản.
   *
   * Nhận `manager` để chạy được bên trong transaction của người gọi — webhook
   * PayOS cần việc cộng tiền, đổi trạng thái đơn và tạo ký quỹ cùng thành
   * công hoặc cùng huỷ. Không truyền thì tự dùng repository như cũ.
   */
  async createOrderEscrows(orderId: number, manager?: EntityManager) {
    const orderRepo = manager
      ? manager.getRepository(Order)
      : this.orderRepository;
    const escrowRepo = manager
      ? manager.getRepository(Escrow)
      : this.escrowRepository;

    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.seller', 'user'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    // KHÔNG TÁCH KÝ QUỸ CHO ĐƠN CHƯA CÓ TIỀN.
    //
    // Một khoản `holding` nghĩa là "sàn đang giữ hộ số tiền này". Nếu nó ra đời
    // trước khi tiền về thì câu đó là một lời nói dối có hậu quả: `release()`
    // chỉ tìm khoản `holding` rồi chuyển tiền, nó KHÔNG hỏi tiền ở đâu ra. Kết
    // quả là ví người bán được cộng thật trong khi `platform/escrow_hold` xuống
    // ÂM — sàn trả cho người bán một khoản chưa ai nộp vào, và người bán rút ra
    // được qua POST /withdrawals.
    //
    // Đo được bằng TC-P0-02b (`ky-quy-khong-co-tien.spec.ts`):
    // escrow_hold = -500.000 sau đúng một lần bấm "đã nhận hàng".
    //
    // Lớp chặn thứ nhất là ở `payos.controller.ts` — chỗ đó từng gọi hàm này
    // ngay lúc tạo link thanh toán, và đã gỡ. Lớp này là lớp thứ hai, CỐ Ý
    // chồng lên: mai kia ai đó thêm một đường gọi mới thì kho tiền vẫn không
    // thủng, vì bị từ chối ở đây chứ không phải nhờ người gọi nhớ kiểm.
    //
    // `ledger.post()` không chặn hộ được: nó chỉ cấm tài khoản NGƯỜI DÙNG âm,
    // còn tài khoản platform thì được phép âm — và đúng như vậy, vì
    // `gateway_clearing` phải âm dần. Bất biến "escrow_hold không âm" phải được
    // giữ ở đây, nơi biết được đơn đã trả tiền hay chưa.
    if (!order.is_paid) {
      throw new BadRequestException(
        `Đơn hàng #${orderId} chưa thanh toán nên chưa thể tách ký quỹ. ` +
          'Khoản ký quỹ chỉ được sinh ra cùng lúc với bút toán đưa tiền vào ' +
          'tài khoản giữ hộ.',
      );
    }

    // Đã tách rồi thì thôi. Không có dòng này, một lần gọi lại sẽ nhân đôi
    // số khoản ký quỹ của cùng một đơn.
    const already = await escrowRepo.count({
      where: { order: { id: orderId } },
    });
    if (already > 0) {
      return escrowRepo.find({ where: { order: { id: orderId } } });
    }

    const sellerMap = new Map<number, { seller: User; total: number }>();
    for (const item of order.items) {
      const sellerId = item.product.seller.id;
      if (!sellerMap.has(sellerId)) {
        sellerMap.set(sellerId, { seller: item.product.seller, total: 0 });
      }
      sellerMap.get(sellerId)!.total += Number(item.subtotal);
    }

    // CHIA PHÍ SHIP CHO TỪNG NGƯỜI BÁN.
    //
    // Người mua trả `final_amount` = tiền hàng + phí ship, và cả số đó đã chảy
    // vào `escrow_hold`. Nếu khoản ký quỹ chỉ ghi tiền hàng thì phần ship không
    // có đường nào ra — không về người bán lúc giải ngân, không về người mua
    // lúc hoàn tiền. Nó đọng lại trong két mãi mãi, mỗi đơn một ít.
    //
    // Cách chia: TỈ LỆ THEO TIỀN HÀNG. Đơn C2C nhiều shop thì mỗi shop gửi một
    // vận đơn riêng, nhưng `orders.shipping_fee` chỉ lưu một con số tổng —
    // không tách ngược được ra từng shop. Chia theo tỉ lệ là xấp xỉ hợp lý
    // nhất có thể làm với dữ liệu đang có.
    //
    // PHẦN LẺ DỒN VÀO NGƯỜI CUỐI. Làm tròn xuống từng phần rồi cộng lại sẽ
    // thiếu vài đồng so với tổng, và vài đồng đó chính là thứ kẹt lại trong
    // két — đúng con bug đang sửa, chỉ nhỏ hơn. Nên phần dư được dồn hết vào
    // người bán cuối cùng để `Σ (amount + shipping_amount) = final_amount`
    // KHỚP TUYỆT ĐỐI.
    const tongTienHang = [...sellerMap.values()].reduce(
      (s, e) => s + e.total,
      0,
    );
    const tongShip = Math.round(Number(order.shipping_fee ?? 0));

    const danhSach = [...sellerMap.values()];
    let shipDaChia = 0;

    const escrows: Escrow[] = [];
    danhSach.forEach((entry, i) => {
      const laNguoiCuoi = i === danhSach.length - 1;
      const shipCuaHo = laNguoiCuoi
        ? tongShip - shipDaChia
        : tongTienHang > 0
          ? Math.floor((tongShip * entry.total) / tongTienHang)
          : 0;
      shipDaChia += shipCuaHo;

      escrows.push(
        escrowRepo.create({
          order: { id: order.id },
          buyer: { id: order.user.id },
          seller: { id: entry.seller.id },
          amount: entry.total,
          shipping_amount: shipCuaHo,
          status: EscrowStatus.HOLDING,
        }),
      );
    });

    return escrowRepo.save(escrows);
  }

  /**
   * Ghi nhận tiền đã thu NGOÀI cổng thanh toán, rồi tách ký quỹ.
   *
   * Dành cho đường admin bấm "đã thanh toán" bằng tay — chủ yếu là đơn COD,
   * nơi GHN thu hộ rồi chuyển về tài khoản ngân hàng của sàn.
   *
   * VÌ SAO CẦN. `createOrderEscrows` chỉ TÁCH tiền, nó không đưa đồng nào vào
   * két. Với đường PayOS thì webhook đã ghi bút toán `gateway_clearing ->
   * escrow_hold` ngay trước đó nên két có tiền thật. Đường thủ công thì không
   * có ai làm việc ấy: khoản ký quỹ ra đời trên một cái két rỗng, và lần giải
   * ngân đầu tiên kéo `escrow_hold` xuống ÂM — sàn trả cho người bán một khoản
   * chưa ai nộp vào. Đo bằng TC-P0-05b: két = −100.000 sau một đơn COD.
   *
   * VIỆC NÀY KHÔNG BỊA RA CHÍNH SÁCH. Nó chỉ ghi lại một sự thật mà admin vừa
   * khẳng định bằng thao tác của mình: "tiền của đơn này đã về tài khoản sàn".
   * Ai quyết định điều đó, và đối soát với sao kê ngân hàng ra sao, vẫn là việc
   * của con người — sổ cái chỉ có nhiệm vụ không nói dối về số dư.
   *
   * PHẠM VI. Trưởng nhóm (24/09) chốt đối soát COD đầy đủ nằm NGOÀI phạm vi đồ
   * án: *"đồ án thì khỏi quan tâm cái đó — không có đặt thật được"*. Nên ở đây
   * cố tình làm đúng mức tối thiểu: giữ cho bất biến "escrow_hold không âm"
   * không bị phá. Chưa có bước xác nhận GHN đã chuyển khoản thật, chưa có
   * trang đối soát — hai thứ đó là việc của sau đồ án.
   */
  async createOrderEscrowsWithExternalFunding(
    orderId: number,
    manager?: EntityManager,
  ) {
    const run = async (em: EntityManager) => {
      const order = await em.findOne(Order, { where: { id: orderId } });
      if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');

      const daCo = await em.count(Escrow, {
        where: { order: { id: orderId } },
      });
      if (daCo > 0) return this.createOrderEscrows(orderId, em);

      const soTien = BigInt(Math.round(Number(order.final_amount)));
      if (soTien > 0n) {
        const gateway = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.EXTERNAL,
          null,
          LedgerPurpose.GATEWAY_CLEARING,
          em,
        );
        const hold = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.PLATFORM,
          null,
          LedgerPurpose.ESCROW_HOLD,
          em,
        );
        await this.ledger.post(
          {
            // Tất định theo đơn: admin bấm hai lần thì chỉ ghi một lần.
            idempotencyKey: `manual_order_hold:${orderId}`,
            type: LedgerTxType.ORDER_HOLD,
            reference: { type: 'order', id: orderId },
            metadata: { source: 'manual', paymentMethod: order.payment_method },
            entries: [
              { accountId: Number(gateway.id), amount: -soTien },
              { accountId: Number(hold.id), amount: soTien },
            ],
          },
          em,
        );
      }

      return this.createOrderEscrows(orderId, em);
    };

    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * Giải ngân cho người bán, trừ phí sàn.
   *
   * Một đơn có thể chia cho nhiều người bán, nên hàm này chạy nhiều khoản.
   * TẤT CẢ nằm trong MỘT transaction: hoặc mọi người bán cùng nhận tiền, hoặc
   * không ai nhận. Nửa vời sẽ để lại escrow lệch trạng thái mà không ai biết.
   *
   * Khoá chống trùng gắn theo TỪNG khoản ký quỹ chứ không theo đơn, vì mỗi
   * khoản là một lần tiền đổi chủ riêng.
   *
   * Bản cũ cộng thẳng vào `users.balance` bằng `increment()`, không transaction
   * và không để lại dấu vết nào — không trả lời được câu "vì sao ví có số này".
   */
  async release(orderId: number, sellerId?: number) {
    return this.dataSource.transaction(async (em) => {
      const where: any = {
        order: { id: orderId },
        status: EscrowStatus.HOLDING,
      };
      // Giải ngân theo TỪNG người bán (sàn C2C nhiều người bán): người mua xác
      // nhận nhận hàng của một người bán thì chỉ khoản của người đó được chuyển.
      if (sellerId !== undefined) where.seller = { id: sellerId };

      const escrows = await em.find(Escrow, {
        where,
        relations: ['seller'],
      });

      if (!escrows.length) {
        // Giải ngân theo người bán mà không còn khoản HOLDING nào = đã giải ngân
        // trước đó. Idempotent no-op thay vì báo lỗi — người mua bấm lại, hoặc
        // job tự-chốt chạy trùng, không được ném lỗi.
        if (sellerId !== undefined) return [];

        // GIẢI NGÂN CẢ ĐƠN CŨNG PHẢI IDEMPOTENT KHI ĐÃ XONG.
        //
        // Sàn C2C nhả tiền theo TỪNG người bán (`confirmShipmentReceived`), nên
        // tới lúc ai đó đặt đơn sang `delivered` thì thường đã không còn khoản
        // `holding` nào. Bản cũ ném ở đây, và `orders.updateStatus` đổi nó
        // thành 400 "giải ngân ký quỹ thất bại" — người dùng nhận một thông báo
        // lỗi về TIỀN trong khi không có gì sai xảy ra. Đo bằng TC-P2-17.
        //
        // Phân biệt hai trường hợp bằng cách hỏi đơn có khoản nào không:
        //   · có, đều đã released/refunded -> xong rồi, trả [] im lặng
        //   · không có khoản nào cả        -> thật sự bất thường, vẫn ném
        const tongSo = await em.count(Escrow, {
          where: { order: { id: orderId } },
        });
        if (tongSo > 0) return [];

        throw new NotFoundException('Không tìm thấy escrow nào để giải ngân');
      }

      const percent = await this.platformFee.getPercent(em);
      const hold = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.ESCROW_HOLD,
        em,
      );
      const revenue = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.REVENUE,
        em,
      );

      for (const escrow of escrows) {
        const amount = BigInt(Math.round(Number(escrow.amount)));
        // PHÍ SÀN TÍNH TRÊN TIỀN HÀNG, KHÔNG TÍNH TRÊN PHÍ SHIP.
        //
        // Quyết định của Đạt 24/09: *"Tiền ship bên mua bán họ tự trả chứ sàn
        // không thu tiền"*. Sàn cầm hộ rồi chuyển đi nguyên vẹn — ăn phần trăm
        // trên tiền ship là thu một khoản mình không làm gì để có.
        const fee = this.platformFee.computeFee(amount, percent);
        const ship = BigInt(Math.round(Number(escrow.shipping_amount ?? 0)));

        const sellerAcc = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.USER,
          escrow.seller.id,
          LedgerPurpose.AVAILABLE,
          em,
        );

        const entries = [
          // Ra khỏi két: cả tiền hàng LẪN phí ship. Đây là chân duy nhất đưa
          // phí ship ra khỏi `escrow_hold` — thiếu nó thì két không bao giờ
          // về 0 (TC-P0-04b).
          { accountId: Number(hold.id), amount: -(amount + ship) },
          { accountId: Number(sellerAcc.id), amount: amount - fee + ship },
        ];
        // Phí bằng 0 thì bỏ hẳn chân này. Bút toán 0 đồng không sai nhưng
        // làm sổ khó đọc.
        if (fee > 0n) {
          entries.push({ accountId: Number(revenue.id), amount: fee });
        }

        await this.ledger.post(
          {
            idempotencyKey: `escrow_release:${escrow.id}`,
            type: LedgerTxType.ESCROW_RELEASE,
            reference: { type: 'escrow', id: escrow.id },
            metadata: { orderId, feePercent: percent, fee: fee.toString() },
            entries,
          },
          em,
        );

        escrow.status = EscrowStatus.RELEASED;
        escrow.released_at = new Date();
        await em.save(Escrow, escrow);
      }

      return escrows;
    });
  }

  /**
   * Trả tiền lại cho người mua khi đơn huỷ hoặc giao thất bại.
   *
   * KHÔNG thu phí: sàn chưa làm xong việc thì không có gì để thu.
   */
  /**
   * Trả tiền đang giữ hộ về ví người mua.
   *
   * Nhận `manager` để chạy được bên trong transaction của người gọi — huỷ đơn
   * cần việc hoàn tiền, đổi trạng thái đơn và trả hàng về kho cùng thành công
   * hoặc cùng huỷ. Không truyền thì tự mở transaction như cũ.
   *
   * Cùng quy ước với `createOrderEscrows` và `LedgerService.post`.
   */
  /**
   * @param doiLaiTuNguoiBan Có đòi lại cả khoản ĐÃ giải ngân hay không.
   *
   * Hai người gọi, hai ý nghĩa khác hẳn:
   *
   *  · **Huỷ đơn** (`false`, mặc định) — chỉ trả lại phần còn đang giữ. Món nào
   *    người mua đã nhận và người bán đã được trả tiền thì coi như xong, không
   *    lật lại. Lật lại ở đây là lấy tiền của người bán trong khi hàng vẫn nằm
   *    ở nhà người mua.
   *
   *  · **Admin hoàn tiền một đơn đã giao** (`true`) — đòi lại thật, vì đó đúng
   *    là việc admin vừa quyết định làm.
   *
   * Phân biệt bằng tham số chứ không đoán theo trạng thái đơn: cùng một đơn
   * `delivered` có thể đi vào đây từ cả hai đường.
   */
  async refund(
    orderId: number,
    manager?: EntityManager,
    doiLaiTuNguoiBan = false,
  ) {
    const run = async (em: EntityManager) => {
      const tatCa = await em.find(Escrow, {
        where: { order: { id: orderId } },
        relations: ['buyer', 'seller'],
      });

      if (!tatCa.length) {
        throw new NotFoundException('Không tìm thấy escrow nào để hoàn tiền');
      }

      // Đã hoàn rồi thì thôi — gọi lại là no-op, không ném. Cron huỷ đơn quá
      // hạn và nút huỷ của người dùng có thể chạm cùng một đơn.
      if (tatCa.every((e) => e.status === EscrowStatus.REFUNDED)) {
        return [];
      }

      // HOÀN TIỀN ĐƠN ĐÃ GIẢI NGÂN: PHẢI ĐÒI LẠI TỪ NGƯỜI BÁN.
      //
      // Bảng chuyển trạng thái cho phép `delivered -> refunded` (admin hoàn
      // tiền một đơn đã giao). Nhưng tới lúc đơn là `delivered` thì mọi khoản
      // ký quỹ đã `released` — tiền nằm trong ví người bán, không còn trong
      // két. Bản cũ chỉ tìm khoản `holding`, không thấy gì, rồi ném — nên
      // nhánh `refunded` của bảng trạng thái CHƯA BAO GIỜ chạy được. Đo bằng
      // TC-P1-07.
      //
      // Đòi lại là ba chân: người bán trả phần họ đã nhận, sàn trả lại phần
      // phí đã thu, cả hai về ví người mua. Phí sàn cũng phải nhả — sàn không
      // giữ phần trăm của một giao dịch bị huỷ bỏ.
      //
      // AN TOÀN KHI NGƯỜI BÁN ĐÃ TIÊU HẾT: `ledger.post()` cấm tài khoản NGƯỜI
      // DÙNG xuống âm, nên lệnh này sẽ bị từ chối và cả transaction quay lui.
      // Admin nhận thông báo số dư không đủ thay vì hệ thống âm thầm tạo ra
      // một khoản nợ. Đây là hành vi ĐÚNG, không phải hạn chế.
      const daGiaiNgan = doiLaiTuNguoiBan
        ? tatCa.filter((e) => e.status === EscrowStatus.RELEASED)
        : [];
      if (daGiaiNgan.length) {
        const percent = await this.platformFee.getPercent(em);
        const revenue = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.PLATFORM,
          null,
          LedgerPurpose.REVENUE,
          em,
        );

        for (const escrow of daGiaiNgan) {
          const tienHang = BigInt(Math.round(Number(escrow.amount)));
          const ship = BigInt(Math.round(Number(escrow.shipping_amount ?? 0)));
          const fee = this.platformFee.computeFee(tienHang, percent);

          const sellerAcc = await this.ledger.getOrCreateAccount(
            LedgerOwnerType.USER,
            escrow.seller.id,
            LedgerPurpose.AVAILABLE,
            em,
          );
          const buyerAcc = await this.ledger.getOrCreateAccount(
            LedgerOwnerType.USER,
            escrow.buyer.id,
            LedgerPurpose.AVAILABLE,
            em,
          );

          const entries = [
            // Người bán trả lại đúng số họ đã nhận.
            {
              accountId: Number(sellerAcc.id),
              amount: -(tienHang - fee + ship),
            },
            { accountId: Number(buyerAcc.id), amount: tienHang + ship },
          ];
          if (fee > 0n) {
            entries.push({ accountId: Number(revenue.id), amount: -fee });
          }

          await this.ledger.post(
            {
              idempotencyKey: `escrow_clawback:${escrow.id}`,
              type: LedgerTxType.ESCROW_REFUND,
              reference: { type: 'escrow', id: escrow.id },
              metadata: { orderId, clawback: true, feePercent: percent },
              entries,
            },
            em,
          );

          escrow.status = EscrowStatus.REFUNDED;
          await em.save(Escrow, escrow);
        }
      }

      const escrows = tatCa.filter((e) => e.status === EscrowStatus.HOLDING);
      if (!escrows.length) return daGiaiNgan;

      const hold = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.ESCROW_HOLD,
        em,
      );

      for (const escrow of escrows) {
        // HOÀN ĐỦ SỐ NGƯỜI MUA ĐÃ TRẢ — tiền hàng CỘNG phí ship.
        //
        // Sàn chưa làm xong việc thì không giữ lại gì cả, kể cả phần ship.
        // Bản cũ chỉ hoàn `escrow.amount`, nên người mua huỷ đơn là mất trắng
        // phí ship mà không ai báo (TC-P0-04a: trả 530.000, nhận lại 500.000).
        const amount =
          BigInt(Math.round(Number(escrow.amount))) +
          BigInt(Math.round(Number(escrow.shipping_amount ?? 0)));
        const buyerAcc = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.USER,
          escrow.buyer.id,
          LedgerPurpose.AVAILABLE,
          em,
        );

        await this.ledger.post(
          {
            idempotencyKey: `escrow_refund:${escrow.id}`,
            type: LedgerTxType.ESCROW_REFUND,
            reference: { type: 'escrow', id: escrow.id },
            metadata: { orderId },
            entries: [
              { accountId: Number(hold.id), amount: -amount },
              { accountId: Number(buyerAcc.id), amount },
            ],
          },
          em,
        );

        escrow.status = EscrowStatus.REFUNDED;
        await em.save(Escrow, escrow);
      }

      return escrows;
    };

    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  // ── ĐỌC KÝ QUỸ: AI ĐƯỢC XEM CÁI GÌ ──────────────────────────────────────
  //
  // Tới 25/09 bốn hàm dưới đây không hàm nào hỏi người gọi là ai.
  // `escrows.controller.ts` gắn `JwtAuthGuard` rồi dừng ở đó, nên BẤT KỲ AI
  // đăng nhập — kể cả tài khoản vừa đăng ký — cũng đọc được:
  //
  //   GET /escrows               ký quỹ của CẢ SÀN
  //   GET /escrows/order/:id     ký quỹ của đơn bất kỳ
  //   GET /escrows/seller/:id    doanh thu đang giữ của shop bất kỳ
  //   GET /escrows/held/:id      tổng tiền đang giữ của shop bất kỳ
  //
  // Đó là dữ liệu kinh doanh của người khác — ai mua gì của ai, bao nhiêu tiền,
  // mỗi shop đang có bao nhiêu chờ về. Sàn C2C thì các shop cạnh tranh trực
  // tiếp với nhau.
  //
  // `payments.service.ts` đã làm đúng khuôn này từ trước:
  //     if (user.role !== 'admin') where.user = { id: user.id };
  // Ký quỹ chỉ là chỗ bị bỏ sót.
  //
  // VÌ SAO KIỂM Ở SERVICE CHỨ KHÔNG CHỈ Ở CONTROLLER. Controller là một cửa;
  // service là cái két. Kiểm ở cửa thì cửa thứ hai mở ra sau này — một
  // controller khác, một job, một lời gọi nội bộ — sẽ đi thẳng vào két.

  /** Chỉ admin. Dùng cho những chỗ nhìn được dữ liệu của mọi người. */
  private chiAdmin(user: IUser, viec: string): void {
    if (user?.role !== 'admin') {
      throw new ForbiddenException(`Chỉ quản trị viên mới ${viec}`);
    }
  }

  /** Admin, hoặc chính người đó. */
  private adminHoacChinhChu(user: IUser, chuId: number, viec: string): void {
    if (user?.role !== 'admin' && user?.id !== chuId) {
      throw new ForbiddenException(`Bạn không có quyền ${viec}`);
    }
  }

  /**
   * Ký quỹ của một đơn — người mua, người bán trong đơn, hoặc admin.
   *
   * Không trả 404 giả như `orders.findOneForActor` làm: ở đó 404 để người ngoài
   * không dò được đơn nào tồn tại. Ở đây id đơn đã lộ qua chính đường đặt hàng
   * của người dùng rồi, nên nói thẳng "không có quyền" đỡ khó hiểu hơn.
   */
  async findByOrder(orderId: number, user: IUser) {
    const rows = await this.escrowRepository.find({
      where: { order: { id: orderId } },
      relations: ['buyer', 'seller'],
    });

    if (user?.role !== 'admin') {
      const trongDon = rows.some(
        (e) => e.buyer?.id === user?.id || e.seller?.id === user?.id,
      );
      // Đơn chưa có khoản ký quỹ nào thì không có gì để lộ — trả mảng rỗng.
      if (rows.length && !trongDon) {
        throw new ForbiddenException(
          'Bạn không có quyền xem khoản ký quỹ của đơn hàng này',
        );
      }
    }

    return rows;
  }

  async findBySeller(
    sellerId: number,
    page: number,
    limit: number,
    status: string | undefined,
    user: IUser,
  ) {
    this.adminHoacChinhChu(user, sellerId, 'xem ký quỹ của người bán này');

    const {
      page: trang,
      size,
      offset,
    } = normalizePagination(String(page), String(limit));

    const where: any = { seller: { id: sellerId } };
    if (status) where.status = status;

    const [result, total] = await this.escrowRepository.findAndCount({
      where,
      relations: ['order', 'buyer'],
      skip: offset,
      take: size,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: trang,
        pageSize: size,
        pages: Math.ceil(total / size),
        total,
      },
      result,
    };
  }

  async findAll(
    page: number,
    limit: number,
    status: string | undefined,
    user: IUser,
  ) {
    this.chiAdmin(user, 'xem được ký quỹ của toàn sàn');

    // `?limit=999999` nạp cả bảng vào RAM. Đợt chặn limit ở PR #21 làm cho 6
    // service danh sách, nhưng controller này truyền thẳng `+limit || 20`
    // xuống `take` nên lọt lưới.
    const {
      page: trang,
      size,
      offset,
    } = normalizePagination(String(page), String(limit));

    const where: any = {};
    if (status) where.status = status;

    const [result, total] = await this.escrowRepository.findAndCount({
      where,
      relations: ['order', 'buyer', 'seller'],
      skip: offset,
      take: size,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: trang,
        pageSize: size,
        pages: Math.ceil(total / size),
        total,
      },
      result,
    };
  }

  async getHeldBalance(sellerId: number, user: IUser) {
    this.adminHoacChinhChu(
      user,
      sellerId,
      'xem số dư đang giữ của người bán này',
    );

    const result = await this.escrowRepository
      .createQueryBuilder('escrow')
      .select('COALESCE(SUM(escrow.amount), 0)', 'total')
      .where('escrow.seller_id = :sellerId', { sellerId })
      .andWhere('escrow.status = :status', { status: 'holding' })
      .getRawOne();

    return { held_balance: Number(result?.total || 0) };
  }
}
