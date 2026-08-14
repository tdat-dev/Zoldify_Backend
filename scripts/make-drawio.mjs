#!/usr/bin/env node
/**
 * Sinh sáu sơ đồ .drawio bắt buộc cho buổi bảo vệ.
 *
 * Thứ tự lấy đúng theo "Project Presentation Template.pdf" (15 slide):
 *   slide 5  Use Case          slide 9   Sequence
 *   slide 6  Activity          slide 10  Entity Relationship
 *   slide 8  Class             slide 11  Deployment
 *
 *   node scripts/make-drawio.mjs
 *
 * Ghi ra docs/system-design/drawio/. Script KHÔNG ghi đè file đã có — sau lần
 * sinh đầu, file .drawio là bản gốc, sửa thẳng trong draw.io. Muốn dựng lại từ
 * đầu thì xoá file rồi chạy lại.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFile,
  createSheet,
  edge,
  edgeAt,
  S,
  umlClass,
  vertex,
} from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio');
const FORCE = process.argv.includes('--force');

/**
 * Lọc theo tên file. Mọi tham số không bắt đầu bằng `--` được coi là một mẩu
 * tên; chỉ file khớp mới được sinh lại.
 *
 *   node scripts/make-drawio.mjs --force r2-container 11-deployment
 *
 * Vì sao cần: `--force` trần ghi đè TẤT CẢ, kể cả những file đã được kéo thả
 * chỉnh tay trong draw.io. Sửa một sơ đồ mà mất chỉnh tay của năm sơ đồ khác là
 * cái giá quá đắt cho một lệnh gõ nhầm.
 */
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// ===========================================================================
// 1. USE CASE DIAGRAM  — slide 5
// ===========================================================================
function useCaseDiagram() {
  const s = createSheet('Use Case Diagram');

  // ─────────────────────────────────────────────────────────────────────────
  // MÔ HÌNH TRƯỚC, BỐ CỤC SAU. Bản trước sai ở cả hai.
  //
  // SAI VỀ MÔ HÌNH — `Process payment webhook` không phải use case. Use case
  // là một MỤC TIÊU mang lại giá trị quan sát được cho actor; PayOS không có
  // mục tiêu "xử lý webhook", nó chỉ gọi vào hệ thống. Đó là chi tiết hiện
  // thực đội lốt use case. Thay bằng `Make payment` — mục tiêu thật của người
  // mua, với PayOS là actor phụ trợ giúp hoàn thành nó.
  //
  // `Register / Log in` là hai mục tiêu khác nhau gộp làm một, tách ra.
  //
  // `Confirm delivery` «include» `View wallet` sai ngữ nghĩa: «include» nghĩa
  // là use case gốc LUÔN LUÔN thực thi cái được include. Xác nhận nhận hàng
  // không hề kéo theo việc ai đó *xem ví*. Thứ nó luôn kéo theo là giải ngân
  // ký quỹ, nên include đúng là `Release payment to seller`.
  //
  // THIẾU TỔNG QUÁT HOÁ ACTOR — Buyer và Seller đều đăng ký, đăng nhập, nhắn
  // tin. Bản cũ nối trùng hai lần cho mỗi use case chung. Chuẩn UML là tách
  // một actor cha `Registered User` rồi cho hai actor kia kế thừa, tam giác
  // rỗng. Bớt được sáu đường nối và nói đúng hơn về hệ thống.
  //
  // SAI VỀ BỐ CỤC — mọi đường nối chỉ được đi trong ba hành lang trống: rãnh
  // trái (x 100-320), rãnh giữa (x 550-780), rãnh phải (x 1010-1230). Không
  // hình nào nằm trong ba dải đó nên không đường nào đè được lên hình.
  //
  // Actor chính bên trái, actor phụ trợ bên phải — quy ước chuẩn. Mỗi actor
  // đặt ngang tầm cụm use case của mình để đường nối ngắn và không bắt chéo.
  // ─────────────────────────────────────────────────────────────────────────

  // Actor chính — bên trái
  const buyer = vertex(s, { value: 'Buyer', style: S.actor, x: 70, y: 250, w: 30, h: 60 });
  const member = vertex(s, {
    value: 'Registered User', style: S.actor, x: 70, y: 620, w: 30, h: 60,
  });
  const seller = vertex(s, { value: 'Seller', style: S.actor, x: 70, y: 1180, w: 30, h: 60 });

  // Actor phụ trợ — bên phải. Chúng không khởi xướng gì; hệ thống gọi tới
  // chúng để hoàn thành mục tiêu của actor chính.
  const admin = vertex(s, { value: 'Administrator', style: S.actor, x: 1230, y: 380, w: 30, h: 60 });
  const payos = vertex(s, { value: 'PayOS', style: S.actor, x: 1230, y: 655, w: 30, h: 60 });
  const ghn = vertex(s, { value: 'GHN', style: S.actor, x: 1230, y: 1195, w: 30, h: 60 });

  vertex(s, { value: 'Zoldify', style: S.boundary, x: 250, y: 50, w: 900, h: 1210 });

  const uc = (value, x, y) => vertex(s, { value, style: S.useCase, x, y, w: 230, h: 54 });

  // Cột trái, trên — mục tiêu của người mua
  const uBrowse = uc('Browse and search items', 320, 110);
  const uCart = uc('Manage cart', 320, 190);
  const uOrder = uc('Place an order', 320, 270);
  const uTrack = uc('Track an order', 320, 350);
  const uConfirm = uc('Confirm delivery', 320, 430);
  const uTopup = uc('Top up wallet', 320, 510);

  // Cột trái, giữa — mục tiêu của bất kỳ tài khoản nào
  const uRegister = uc('Register an account', 320, 600);
  const uSignIn = uc('Sign in', 320, 680);
  const uMessage = uc('Exchange messages', 320, 760);

  // Cột trái, dưới — mục tiêu của người bán
  const uList = uc('List an item for sale', 320, 850);
  const uSales = uc('Manage sales orders', 320, 930);
  const uWallet = uc('View wallet and transactions', 320, 1010);
  const uWithdraw = uc('Request a withdrawal', 320, 1090);

  // Cột phải, trên — mục tiêu của quản trị viên
  const uReview = uc('Review withdrawal requests', 780, 300);
  const uUsers = uc('Manage users', 780, 380);
  const uModerate = uc('Moderate listings', 780, 460);
  const uRecon = uc('Reconcile the ledger', 780, 540);

  // Cột phải, giữa — hai use case chỉ tồn tại như đích của «include».
  // Chúng không cần actor nối trực tiếp, và đó là hợp lệ trong UML.
  const uPay = uc('Make payment', 780, 640);
  const uRelease = uc('Release payment to seller', 780, 880);

  // Cột phải, dưới — cần cả người bán lẫn hãng vận chuyển
  const uShip = uc('Arrange shipment', 780, 1180);

  /** Neo cứng hai đầu để đường luôn nằm trong hành lang trống. */
  const anchor = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;

  const fromLeft = (u, a) =>
    edge(s, { source: a, target: u, style: S.assoc + anchor(1, 0.5, 0, 0.5) });
  const fromRight = (u, a) =>
    edge(s, { source: a, target: u, style: S.assoc + anchor(0, 0.5, 1, 0.5) });

  [uBrowse, uCart, uOrder, uTrack, uConfirm, uTopup].forEach((u) => fromLeft(u, buyer));
  [uRegister, uSignIn, uMessage].forEach((u) => fromLeft(u, member));
  [uList, uSales, uWallet, uWithdraw].forEach((u) => fromLeft(u, seller));
  fromLeft(uShip, seller);

  [uReview, uUsers, uModerate, uRecon].forEach((u) => fromRight(u, admin));
  fromRight(uPay, payos);
  fromRight(uShip, ghn);

  // Tổng quát hoá actor: Buyer và Seller LÀ MỘT Registered User, nên thừa
  // hưởng ba use case chung mà không phải nối lại.
  edge(s, { source: buyer, target: member, style: S.generalize + anchor(0.5, 1, 0.5, 0) });
  edge(s, { source: seller, target: member, style: S.generalize + anchor(0.5, 0, 0.5, 1) });

  // «include» — đích được thực thi MỖI LẦN use case gốc chạy.
  //
  // Neo lệch nhau ở đầu vào `Make payment` để hai nhãn không rơi chồng: cùng
  // đích thì điểm giữa hai đường gần như trùng nhau.
  const inc = (a, b, ex, ey, nx, ny) =>
    edge(s, { source: a, target: b, value: '«include»', style: S.depend + anchor(ex, ey, nx, ny) });

  inc(uOrder, uPay, 1, 0.5, 0, 0.25);
  inc(uTopup, uPay, 1, 0.5, 0, 0.75);
  inc(uConfirm, uRelease, 1, 0.5, 0, 0.5);

  vertex(s, {
    value:
      'Notation. Actors are stick figures, use cases are ellipses, and the box is\n' +
      'the system boundary. The hollow triangle is generalisation: Buyer and\n' +
      'Seller are both a Registered User, so they inherit those three use cases\n' +
      'instead of being wired to them twice.\n\n' +
      'PayOS and GHN are secondary actors. They start nothing — the system calls\n' +
      'them to finish a goal that a primary actor asked for. That is why no use\n' +
      'case here is named after a webhook or an API call: those are mechanisms,\n' +
      'not goals, and a use case must be a goal.\n\n' +
      '«include» means the target runs every time the source runs. Placing an\n' +
      'order always takes a payment; confirming delivery always releases the\n' +
      'money held in escrow.',
    style: S.note,
    x: 250, y: 1300, w: 640, h: 190,
  });

  return s;
}

// ===========================================================================
// 2. ACTIVITY DIAGRAM — slide 6. Đặt hàng và thanh toán.
// ===========================================================================
function activityDiagram() {
  const s = createSheet('Activity Diagram - Place Order and Pay');

  // ─────────────────────────────────────────────────────────────────────────
  // Bản trước hỏng cả mô hình lẫn bố cục.
  //
  // MÔ HÌNH — hai nhánh sau fork cùng chạy vào MỘT activity final. Sai: chạm
  // activity final là CẢ hoạt động dừng ngay, nên nhánh nào về đích trước sẽ
  // khai tử nhánh còn lại. Đúng UML là gộp lại bằng thanh JOIN rồi mới kết
  // thúc một lần.
  //
  // Nhánh phụ cũng vậy: `Roll back` và webhook trùng khoá đều nối vào cùng
  // activity final ở tận đáy làn Buyer. Hai đường chéo dài đó vừa nói sai
  // (chúng kết thúc luồng của mình, không kết thúc cả hoạt động) vừa cắt
  // ngang qua ô `Create PayOS payment link`. Thay bằng nút kết thúc ĐẶT NGAY
  // CẠNH chỗ nó xảy ra: rollback dùng activity final riêng, webhook trùng
  // dùng flow final (vòng tròn có X) vì hoạt động vẫn chạy tiếp.
  //
  // BỐ CỤC — `Choose payment method` nằm dưới `Lock product rows`, nên mũi
  // tên giữa hai ô đi NGƯỢC lên trên. Cột làn giữa nay bắt đầu bên dưới ô
  // cuối cùng của làn Buyer để mọi mũi tên đều xuôi xuống.
  //
  // Waypoint nhánh COD trước đặt ở x=490 tuyệt đối, mà các ô của làn giữa bắt
  // đầu ở x=480 — đường chạy XUYÊN QUA thân ba cái ô. Nay làn giữa chừa hẳn
  // một rãnh trống x 460-560 và không hình nào được đặt vào đó.
  // ─────────────────────────────────────────────────────────────────────────

  // Làn giữa rộng 900 chứ không phải 700: nhánh "đơn đã huỷ mà tiền vẫn về"
  // cần một ô đủ chỗ ghi hai vế bút toán, mà cột nhánh cũ chỉ rộng 150.
  const laneH = 1660;
  const l1 = vertex(s, { value: 'Buyer', style: S.laneV, x: 40, y: 40, w: 400, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 440, y: 40, w: 900, h: laneH });
  const l3 = vertex(s, { value: 'PayOS', style: S.laneV, x: 1340, y: 40, w: 340, h: laneH });

  // Toạ độ con là tương đối so với gốc trái-trên của làn.
  //
  // Làn giữa chia làm ba cột:
  //   x  20-100  rãnh trống, chỉ để nhánh COD chạy dọc
  //   x 130-490  trục chính (hành động w=360, hình thoi w=180 cùng tâm 310)
  //   x 530-680  nhánh rẽ ra khỏi trục chính
  const act = (lane, v, x, y, w = 300, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 175, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Review cart and press Checkout', 40, 115);
  const a2 = act(l1, 'Fill in receiver name, phone, address', 40, 195);
  const a3 = act(l1, 'Choose payment method', 40, 275);
  const a4 = act(l1, 'Pay on the PayOS page', 40, 900);

  const b1 = act(l2, 'Lock product rows and verify stock', 130, 345, 360);
  const d1 = vertex(s, {
    value: 'All items\nin stock?',
    style: S.decision, x: 220, y: 425, w: 180, h: 90, parent: l2,
  });
  const rollback = act(l2, 'Roll back,\nno order created', 530, 440, 180, 60, S.actionTodo);
  const rollbackEnd = vertex(s, { style: S.final, x: 605, y: 550, w: 30, h: 30, parent: l2 });

  const b2 = act(l2, 'Compute totals, insert order and items,\ndecrement stock', 130, 555, 360, 60);
  const d2 = vertex(s, {
    value: 'Payment\nmethod?',
    style: S.decision, x: 220, y: 645, w: 180, h: 90, parent: l2,
  });
  const b3 = act(l2, 'Create PayOS payment link', 130, 780, 360);

  const b4 = act(l2, 'Verify webhook signature', 130, 1020, 360);
  const d3 = vertex(s, {
    value: 'Idempotency key\nalready used?',
    style: S.decision, x: 220, y: 1100, w: 180, h: 90, parent: l2,
  });
  // Flow final, KHÔNG phải activity final: webhook gửi trùng thì bỏ qua luồng
  // này, hoạt động vẫn sống.
  const dup = vertex(s, { style: S.flowFinal, x: 570, y: 1130, w: 30, h: 30, parent: l2 });

  // Người mua huỷ đơn chưa trả tiền rồi vẫn trả nốt link cũ. Không hồi sinh
  // đơn, nhưng cũng không được lờ số tiền — nó đã nằm ở ngân hàng thật.
  const d4 = vertex(s, {
    value: 'Order already\ncancelled?',
    style: S.decision, x: 220, y: 1220, w: 180, h: 90, parent: l2,
  });
  const bCancel = act(
    l2,
    'Credit the buyer wallet\ngateway_clearing −X → buyer.available +X\norder stays cancelled',
    530, 1225, 340, 80, S.actionDone,
  );
  const endCancel = vertex(s, { style: S.final, x: 685, y: 1350, w: 30, h: 30, parent: l2 });

  const b5 = act(
    l2,
    'ONE TRANSACTION\nledger entries · order marked paid · escrow rows per seller',
    130, 1360, 360, 70, S.actionDone,
  );

  const fork = vertex(s, { style: S.bar, x: 160, y: 1460, w: 300, h: 6, parent: l2 });
  const n1 = act(l2, 'Notify sellers', 130, 1490, 160, 40);
  const n2 = act(l2, 'Create GHN shipment', 330, 1490, 160, 40);
  const join = vertex(s, { style: S.bar, x: 160, y: 1555, w: 300, h: 6, parent: l2 });
  const endN = vertex(s, { style: S.final, x: 295, y: 1585, w: 30, h: 30, parent: l2 });

  const p1 = act(l3, 'Return checkout URL and QR code', 20, 840, 300);
  const p2 = act(l3, 'Send confirmation webhook', 20, 960, 300);

  const f = (a, b, v = '', style = '') =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style });

  /** Neo cứng hai đầu — để draw.io tự chọn cạnh là nó bám cạnh gần nhất. */
  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;

  f(start, a1);
  f(a1, a2);
  f(a2, a3);
  f(a3, b1, '', at(1, 0.5, 0, 0.5));

  f(b1, d1);
  f(d1, rollback, 'no', at(1, 0.5, 0, 0.5));
  f(rollback, rollbackEnd);
  f(d1, b2, 'yes');
  f(b2, d2);
  f(d2, b3, 'PayOS');

  // Ba lượt qua lại với PayOS. Chúng nằm trong dải y 1020-1090 của làn giữa —
  // dải đó cố ý để trống nên không đường nào đè lên hình.
  f(b3, p1, '', at(1, 0.5, 0, 0.3));
  f(p1, a4, '', at(0, 0.75, 1, 0.35));
  f(a4, p2, '', at(1, 0.75, 0, 0.3));
  f(p2, b4, '', at(0, 0.75, 1, 0.5));

  f(b4, d3);
  f(d3, dup, 'yes, ignore', at(1, 0.5, 0, 0.5));
  f(d3, d4, 'no');
  f(d4, bCancel, 'yes', at(1, 0.5, 0, 0.5));
  f(bCancel, endCancel);
  f(d4, b5, 'no');

  f(b5, fork);
  f(fork, n1);
  f(fork, n2);
  f(n1, join);
  f(n2, join);
  f(join, endN);

  // Nhánh COD bỏ qua toàn bộ phần thanh toán và đi thẳng tới fork: đơn đã tạo,
  // người bán vẫn phải giao, chỉ là chưa có tiền vào ký quỹ. Ép đi trong rãnh
  // trống x=500 tuyệt đối (làn giữa bắt đầu ở 440, trục chính ở 570).
  edge(s, {
    source: d2,
    target: fork,
    value: 'Cash on delivery',
    style: S.flow + 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;',
    points: [[500, 730], [500, 1373]],
  });

  vertex(s, {
    value:
      'Thanh đậm là fork/join của UML. Sau khi thanh toán commit, việc báo người bán\n' +
      'và việc tạo vận đơn chạy song song, rồi phải GẶP LẠI ở thanh join trước khi\n' +
      'hoạt động kết thúc — nếu để mỗi nhánh tự chạy vào nút kết thúc thì nhánh về\n' +
      'trước sẽ giết nhánh còn lại, đó là ngữ nghĩa của activity final.\n\n' +
      'Vòng tròn có dấu X là flow final: luồng đó dừng, hoạt động vẫn tiếp tục. Dùng\n' +
      'cho webhook PayOS gửi trùng — bỏ qua là đúng, không phải lỗi.\n\n' +
      'Nhánh "Order already cancelled?" có vì huỷ đơn KHÔNG chắc chắn đóng được link\n' +
      'thanh toán — việc đóng link là lời gọi mạng, hỏng thì thôi. Nên webhook phải tự\n' +
      'phòng: đơn đã huỷ thì tiền vào ví người mua và đơn giữ nguyên trạng thái huỷ.\n' +
      'Không được bỏ qua số tiền, vì nó đã nằm trong tài khoản ngân hàng thật — không\n' +
      'ghi sổ là gateway_clearing lệch với ngân hàng. Xem 06b-activity-cancel-refund.\n\n' +
      'Xanh lá là bước đã hiện thực xong; đỏ là nhánh thất bại.',
    style: S.note,
    x: 40, y: 1740, w: 700, h: 220,
  });

  return s;
}

// ===========================================================================
// 2b. ACTIVITY DIAGRAM — huỷ đơn và hoàn tiền. Chương II.
//
// Luồng nhiều nhánh nhất hệ thống, và trước hôm nay chưa ai vẽ nó bao giờ.
// `r5-state-order-lifecycle` có hẳn hai trạng thái `cancelled` và `refunded`
// mà không sơ đồ nào giải thích làm sao đến được đó.
//
// Vẽ theo quy ước TO-BE của bộ tài liệu: hình là luồng ĐÚNG, ô đỏ là chỗ code
// hiện chưa làm hoặc làm sai. Hai ô đỏ ở đây là hai lỗi tiền tìm ra đúng lúc
// đọc code để vẽ cái này — xem hai ghi chú dưới hình.
// ===========================================================================
function cancelRefundActivityDiagram() {
  const s = createSheet('Activity Diagram - Cancel an Order and Refund');

  const laneH = 1250;
  const l1 = vertex(s, { value: 'Buyer or Seller', style: S.laneV, x: 40, y: 40, w: 380, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 420, y: 40, w: 1120, h: laneH });
  const l3 = vertex(s, { value: 'PayOS', style: S.laneV, x: 1540, y: 40, w: 320, h: laneH });

  // Làn giữa chia bốn cột. Không hình nào được đặt vào rãnh, rãnh chỉ để
  // đường nối chạy.
  //   x 150-490   trục chính (hành động w=340, hình thoi w=150 cùng tâm 320)
  //   x 530-870   nhánh rẽ phải
  //   x 910-1080  nhánh lỗi trả về client
  //   x ~600      rãnh dọc cho đường "chưa trả tiền" đi vòng qua ô hoàn tiền
  const act = (lane, v, x, y, w = 340, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 175, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Open the order and press Cancel', 40, 120, 300);

  const b1 = act(l2, 'Load the order and check who is asking', 150, 210);
  const d1 = vertex(s, {
    value: 'Caller may cancel\nthis order?',
    style: S.decision, x: 245, y: 290, w: 150, h: 90, parent: l2,
  });
  const err1 = act(l2, '403 — not your order', 910, 305, 170, 60, S.actionTodo);
  // y=375 chứ không phải 410: ở 410 nút này chồng 5px lên hộp `400` bên dưới
  // (bắt đầu ở 435). Hai nhánh lỗi dùng chung cột nên khoảng cách dọc phải
  // tính cả nút kết thúc, không chỉ tính hộp.
  const end1 = vertex(s, { style: S.final, x: 970, y: 375, w: 30, h: 30, parent: l2 });

  const d2 = vertex(s, {
    value: 'Status is pending\nor confirmed?',
    style: S.decision, x: 245, y: 420, w: 150, h: 90, parent: l2,
  });
  const err2 = act(l2, '400 — too late to cancel', 910, 435, 170, 60, S.actionTodo);
  const end2 = vertex(s, { style: S.final, x: 970, y: 540, w: 30, h: 30, parent: l2 });

  // Khung transaction. Ba lệnh ghi bên trong cùng sống chết.
  //
  // Tiêu đề khung phải NGẮN. Bản dài chạy ngang qua x=320 — đúng trục chính —
  // nên nhãn `yes` của cạnh d2→d3 rơi đè lên chữ, đọc ra
  // "not there yYESToday these are...".
  vertex(s, {
    value: 'ONE TRANSACTION',
    style:
      'rounded=0;html=1;fillColor=none;strokeColor=#2e7d32;strokeWidth=2;dashed=1;' +
      'verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=11;fontColor=#2e7d32;',
    x: 130, y: 545, w: 760, h: 440, parent: l2,
  });

  const d3 = vertex(s, {
    value: 'Order already\npaid?',
    style: S.decision, x: 245, y: 605, w: 150, h: 90, parent: l2,
  });
  const b3 = act(
    l2,
    'Refund the escrow\nescrow_hold −X → buyer.available +X\nkey escrow_refund:{escrow id}',
    150, 720, 340, 70, S.actionDone,
  );
  const b5 = act(l2, 'Set order status = cancelled', 150, 820, 340, 45);
  const b6 = act(l2, 'Restore stock for every item', 150, 890, 340, 45);

  const d4 = vertex(s, {
    value: 'A PayOS payment\nlink is still open?',
    style: S.decision, x: 245, y: 1015, w: 150, h: 90, parent: l2,
  });
  const b4 = act(l2, 'Ask PayOS to void the link', 530, 1030, 340, 60);
  const endN = vertex(s, { style: S.final, x: 305, y: 1155, w: 30, h: 30, parent: l2 });

  const p1 = act(l3, 'Void the link.\nLater payments are refused.', 20, 1030, 280, 60);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, b1, '', at(1, 0.5, 0, 0.5));

  f(b1, d1);
  f(d1, err1, 'no', at(1, 0.5, 0, 0.5));
  f(err1, end1);
  f(d1, d2, 'yes');

  f(d2, err2, 'no', at(1, 0.5, 0, 0.5));
  f(err2, end2);
  f(d2, d3, 'yes');

  f(d3, b3, 'yes');
  // Đơn chưa trả tiền thì không có gì để hoàn. Đi vòng trong rãnh x=1020 tuyệt
  // đối — bên phải ô hoàn tiền (hết ở 910) và vẫn trong khung transaction.
  f(d3, b5, 'no', at(1, 0.5, 1, 0.5), [[1020, 690], [1020, 882]]);
  f(b3, b5);
  f(b5, b6);
  f(b6, d4, 'COMMIT');

  f(d4, b4, 'yes', at(1, 0.5, 0, 0.5));
  f(d4, endN, 'no');
  f(b4, p1, '', at(1, 0.5, 0, 0.5));
  f(b4, endN, '', at(0.5, 1, 1, 0.5), [[1120, 1210]]);

  vertex(s, {
    value:
      'Why the dashed frame — and the bug it replaced\n\n' +
      'The refund, the status change and the stock restore are ONE transaction. If\n' +
      'the refund throws, none of the other two happened: the order stays open and\n' +
      'the buyer can try again.\n\n' +
      'Until 14 Aug this was three separate writes, and the refund call sat inside a\n' +
      'try/catch that only console.error-ed the failure — then saved the order as\n' +
      'cancelled anyway. A failed refund left the buyer money in escrow_hold forever\n' +
      'with nothing raising an alarm. escrows.refund() was always correct on its own;\n' +
      'the defect was the caller swallowing what it threw.\n\n' +
      'Exactly one failure is still swallowed on purpose: an order paid before the\n' +
      'escrow system existed has no escrow row to refund. That one logs a warning and\n' +
      'lets the cancel through. Every other error rolls the whole thing back.',
    style: S.note,
    x: 40, y: 1340, w: 800, h: 240,
  });

  vertex(s, {
    value:
      'Two safety nets, because voiding the link can fail\n\n' +
      'Voiding runs AFTER the commit and never throws: it is a network call to PayOS,\n' +
      'and holding database locks across a network wait is how deadlocks are made.\n' +
      'If it fails, the link stays alive and someone can still pay a cancelled order.\n\n' +
      'The second net catches that. The payment webhook now checks the order status\n' +
      'first: if the order is cancelled the money is credited to the BUYER WALLET and\n' +
      'the order stays cancelled — see 06-activity-diagram. It cannot be ignored,\n' +
      'because the money is already in the real bank account; not recording it would\n' +
      'put gateway_clearing out of step with the bank.\n\n' +
      'Until 14 Aug neither net existed: the webhook set status = confirmed without\n' +
      'looking, so a cancelled order came back to life while its stock had already\n' +
      'been returned to the shelf.',
    style: S.note,
    x: 880, y: 1340, w: 800, h: 240,
  });

  return s;
}

// ===========================================================================
// 2c. ACTIVITY DIAGRAM — đăng bán một món.
//
// Việc mà TOÀN BỘ sàn phụ thuộc vào: không có người đăng bán thì không có gì
// để mua. Chưa sơ đồ nào vẽ nó.
// ===========================================================================
function listItemActivityDiagram() {
  const s = createSheet('Activity Diagram - List an Item for Sale');

  const laneH = 1180;
  const l1 = vertex(s, { value: 'Seller', style: S.laneV, x: 40, y: 40, w: 380, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 420, y: 40, w: 1000, h: laneH });
  const l3 = vertex(s, { value: 'VPS disk · MySQL', style: S.laneV, x: 1420, y: 40, w: 330, h: laneH });

  //   x 140-500  trục chính
  //   x 560-780  nhánh lỗi
  const act = (lane, v, x, y, w = 320, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 175, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Fill in the listing form:\nname · price · condition · stock', 30, 115, 320, 60);

  // Vòng lặp tải ảnh. Vẽ hẳn ra vì đây là chỗ khác kỳ vọng nhất.
  vertex(s, {
    value: 'ONE REQUEST PER IMAGE',
    style:
      'rounded=0;html=1;fillColor=none;strokeColor=#b8860b;strokeWidth=2;dashed=1;' +
      'verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=11;fontColor=#b8860b;',
    x: 20, y: 210, w: 340, h: 250, parent: l1,
  });
  const a2 = act(l1, 'Pick one photo', 30, 250, 320, 45);
  const a3 = act(l1, 'POST /files/upload\nheader folder_type', 30, 320, 320, 55);
  const dMore = vertex(s, {
    value: 'Another\nphoto?',
    style: S.decision, x: 105, y: 395, w: 170, h: 55, parent: l1,
  });
  const a4 = act(l1, 'POST /products with the returned URLs', 30, 500, 320, 55);

  const f1 = act(l2, 'Check the file extension', 140, 250, 360, 45);
  const dExt = vertex(s, {
    value: 'jpg png gif webp\nsvg bmp pdf doc?',
    style: S.decision, x: 230, y: 320, w: 180, h: 90, parent: l2,
  });
  const errExt = act(l2, '400 — format rejected', 560, 335, 220, 60, S.actionTodo);
  const errEndExt = vertex(s, { style: S.final, x: 655, y: 420, w: 30, h: 30, parent: l2 });

  const f2 = act(l2, 'Write the file to\npublic/images/{folder_type}', 140, 440, 360, 55);
  const f3 = act(
    l2,
    'Build the URL from the REQUEST host\nreq.protocol + req.get(host)',
    140, 520, 360, 55, S.actionTodo,
  );
  const f4 = act(l2, 'Save a row in `files`, return the URL', 140, 600, 360, 50);

  const p1 = act(l2, 'Validate the body against CreateProductDto', 140, 700, 360, 50);
  const p2 = act(
    l2,
    'Copy ONLY whitelisted fields\nanything else is dropped in silence',
    140, 775, 360, 55, S.actionTodo,
  );
  const p3 = act(l2, 'Save the product, seller = caller', 140, 855, 360, 50);
  // KHÔNG dùng fork ở đây. Trong code hai việc này nối tiếp nhau (`await`), và
  // "hàng lên sàn ngay" không phải một hành động — nó là hệ quả của việc lưu.
  // Vẽ fork là nói sai rằng chúng chạy song song.
  const p4 = act(l2, 'Listing is public immediately — no review step', 140, 930, 360, 50, S.actionTodo);
  const p5 = act(l2, 'Notify every follower of this seller', 140, 1005, 360, 50);
  const endP = vertex(s, { style: S.final, x: 305, y: 1085, w: 30, h: 30, parent: l2 });

  const d1 = act(l3, 'File on the VPS disk', 30, 440, 270, 50);
  const d2 = act(l3, 'Row in `files`', 30, 600, 270, 50);
  const d3 = act(l3, 'Row in `products`', 30, 855, 270, 50);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, a2);
  f(a2, a3);
  f(a3, f1, '', at(1, 0.5, 0, 0.5));
  f(f1, dExt);
  f(dExt, errExt, 'no', at(1, 0.5, 0, 0.5));
  f(errExt, errEndExt);
  f(dExt, f2, 'yes');
  f(f2, d1, '', at(1, 0.5, 0, 0.5));
  f(f2, f3);
  f(f3, f4);
  f(f4, d2, '', at(1, 0.5, 0, 0.5));
  // Về lại làn người bán để hỏi còn ảnh nào nữa không.
  //
  // Waypoint là toạ độ TUYỆT ĐỐI. x=530 nằm trong lề trái của làn giữa (làn bắt
  // đầu ở 420, ô đầu tiên ở 560) nên rãnh đó trống. Bản thẳng trước đó cắt chéo
  // qua hai cạnh khác.
  f(f4, dMore, '', at(0, 0.5, 1, 0.5), [[530, 665], [530, 462]]);
  f(dMore, a2, 'yes', at(0, 0.5, 0, 0.5), [[70, 422], [70, 312]]);
  f(dMore, a4, 'no');
  f(a4, p1, '', at(1, 0.5, 0, 0.5));
  f(p1, p2);
  f(p2, p3);
  f(p3, d3, '', at(1, 0.5, 0, 0.5));
  f(p3, p4);
  f(p4, p5);
  f(p5, endP);

  vertex(s, {
    value:
      'Three red boxes, three real defects\n\n' +
      '1. THE URL IS BUILT FROM THE REQUEST. files.controller.ts writes\n' +
      '   `${req.protocol}://${req.get(host)}/public/images/...` into the database.\n' +
      '   Every photo therefore carries whichever hostname the uploader happened to\n' +
      '   reach. Behind a reverse proxy that is http://localhost:3000; after a domain\n' +
      '   change every older photo points at the old domain. The stored value should\n' +
      '   be the path, and the host should be added when reading.\n\n' +
      '2. THE WHITELIST DROPS FIELDS WITHOUT SAYING SO. products.service.create()\n' +
      '   copies a fixed list of fields. A field the DTO accepted but the list forgot\n' +
      '   is discarded and the API still answers 201. This already happened once with\n' +
      '   `currency`: send USD, get 201, row says VND.\n\n' +
      '3. NOTHING REVIEWS THE LISTING. It is visible the moment it is saved. For a\n' +
      '   second-hand marketplace whose selling point is trust, that is the gap a\n' +
      '   grader will ask about.',
    style: S.note,
    x: 40, y: 1250, w: 830, h: 300,
  });

  vertex(s, {
    value:
      'Why the loop is drawn instead of one upload step\n\n' +
      'The route uses FileInterceptor(fileUpload) — SINGLE file. The multer config\n' +
      'allows files: 10, which reads like ten photos per request, but that limit\n' +
      'never applies: the interceptor accepts one field, one file. A client with six\n' +
      'photos makes six requests and assembles the URL list itself.\n\n' +
      'Consequence worth saying out loud: those six uploads are not one transaction.\n' +
      'If the browser closes after the fourth, four files sit on disk and in `files`\n' +
      'with no product pointing at them. Nothing collects them.\n\n' +
      'fileSize is 100MB per file — for a marketplace photo that is roughly fifty\n' +
      'times what is needed, and it is the whole VPS disk on the line.',
    style: S.note,
    x: 900, y: 1250, w: 830, h: 300,
  });

  return s;
}

// ===========================================================================
// 2d. ACTIVITY DIAGRAM — vận đơn GHN.
// ===========================================================================
function ghnActivityDiagram() {
  const s = createSheet('Activity Diagram - GHN Shipment');

  // Nhánh lỗi nằm BÊN TRÁI trục chính, không phải bên phải.
  //
  // Bản đầu đặt cả `skip` lẫn `fail` ở cột phải, và hỏng hai lần vì thế: đường
  // vòng từ `skip` xuống `Save the order` chạy xuyên qua ô `fail`, còn cạnh từ
  // `Create the shipment` sang làn GHN chạy ngang qua thân nó — chữ trong ô đỏ
  // bị gạch ngang bởi hai đường kẻ. Bên phải trục chính là đường ra làn GHN,
  // không được để hình nào chắn.
  //
  // Làn giữa chia:
  //   x  20      rãnh dọc cho đường vòng của `skip`, không hình nào đặt vào
  //   x  40-290  cột nhánh lỗi
  //   x 360-700  trục chính (hình thoi w=180 cùng tâm với hành động)
  //   x  >700    trống, để đi thẳng sang làn GHN
  const laneH = 1010;
  const l1 = vertex(s, { value: 'Seller', style: S.laneV, x: 40, y: 40, w: 330, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 370, y: 40, w: 1000, h: laneH });
  const l3 = vertex(s, { value: 'GHN', style: S.laneV, x: 1370, y: 40, w: 340, h: laneH });

  const act = (lane, v, x, y, w = 340, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 150, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Press Confirm on the order', 20, 115, 290);

  const b1 = act(l2, 'Check the caller is the seller', 360, 190);
  const d1 = vertex(s, {
    value: 'No tracking code yet\nAND ghn_district_id set?',
    style: S.decision, x: 440, y: 270, w: 180, h: 100, parent: l2,
  });
  const skip = act(l2, 'Skip the carrier.\nSeller types the code in later.', 40, 285, 250, 60);

  const g1 = act(l2, 'Ask GHN which services serve\nthat district', 360, 410, 340, 55);
  const d2 = vertex(s, {
    value: 'A service with\nservice_type_id = 2?',
    style: S.decision, x: 440, y: 490, w: 180, h: 100, parent: l2,
  });
  const g2 = act(
    l2,
    'Create the shipment\nweight 500g flat · 200g per item\ncod_amount = final_amount if COD, else 0',
    360, 630, 340, 70,
  );
  const g3 = act(l2, 'Store ghnOrder.order_code\nas the tracking code', 360, 730, 340, 55);

  const fail = act(
    l2,
    'catch → console.error\nOrder is STILL confirmed, with no shipment',
    40, 630, 250, 70, S.actionTodo,
  );
  const failEnd = vertex(s, { style: S.flowFinal, x: 150, y: 730, w: 30, h: 30, parent: l2 });

  const b2 = act(l2, 'Save the order as confirmed', 360, 820);
  const endN = vertex(s, { style: S.final, x: 515, y: 900, w: 30, h: 30, parent: l2 });

  const p1 = act(l3, 'available-services', 30, 410, 280, 50);
  const p2 = act(l3, 'shipping-order/create\nreturns order_code', 30, 630, 280, 55);
  const p3 = act(
    l3,
    'Parcel moves.\nNOBODY TELLS ZOLDIFY.',
    30, 800, 280, 60, S.actionTodo,
  );

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, b1, '', at(1, 0.5, 0, 0.5));
  f(b1, d1);
  f(d1, skip, 'no', at(0, 0.5, 1, 0.5));
  // Bỏ qua hãng vận chuyển vẫn phải lưu đơn. Đi vòng trong rãnh x=390 tuyệt
  // đối — bên trái cột nhánh lỗi (bắt đầu ở 410) nên không chạm ô `fail`.
  f(skip, b2, '', at(0, 0.5, 0, 0.5), [[390, 355], [390, 885]]);
  f(d1, g1, 'yes');
  f(g1, p1, '', at(1, 0.5, 0, 0.5));
  f(g1, d2);
  f(d2, fail, 'no', at(0, 0.5, 1, 0.5));
  f(d2, g2, 'yes');
  f(g2, p2, '', at(1, 0.5, 0, 0.5));
  f(g2, g3);
  f(g3, b2);
  f(fail, failEnd);
  f(b2, endN);
  edge(s, {
    source: p2, target: p3, value: 'days later',
    style: S.depend + 'strokeColor=#c62828;',
  });

  vertex(s, {
    value:
      'THE HALF THAT DOES NOT EXIST: STATUS SYNC\n\n' +
      'Zoldify calls GHN once, stores order_code, and never speaks to GHN again.\n' +
      'There is no webhook route and no polling job. Search the repository for a GHN\n' +
      'callback and there is nothing to find.\n\n' +
      'So picked up, in transit, delivered, delivery failed, returned to sender —\n' +
      'none of it reaches the order. `status` only moves when a human presses a\n' +
      'button in the seller UI.\n\n' +
      'That matters more here than on an ordinary shop, because DELIVERED is the\n' +
      'event that releases the escrow. The money is waiting on a fact the system\n' +
      'cannot observe. Today a seller can mark their own order delivered and be paid\n' +
      'for a parcel that never left the house.\n\n' +
      'Two ways to close it: register a GHN webhook, or poll the tracking endpoint on\n' +
      'a schedule. The webhook is cheaper and faster; polling survives a missed call.',
    style: S.note,
    x: 40, y: 1080, w: 800, h: 300,
  });

  vertex(s, {
    value:
      'Smaller things this diagram had to be honest about\n\n' +
      'WEIGHT IS INVENTED. Every parcel is declared 500g, every line item 200g. GHN\n' +
      'prices by weight, so the quoted fee is fiction for anything heavier — and the\n' +
      'buyer already paid the quoted fee. Nothing in the product form asks for weight.\n\n' +
      'THE FAILURE IS SWALLOWED ON PURPOSE, and that part is defensible: a shipment\n' +
      'is not money, and a seller can type the code in by hand. But it goes to\n' +
      'console.error, not the logger, so it lands nowhere anyone looks.\n\n' +
      'service_type_id = 2 IS HARDCODED. If a district only offers another service\n' +
      'type, the order simply gets no shipment.\n\n' +
      'THE CARRIER IS ONE FIXED PICKUP POINT — GHN_FROM_DISTRICT_ID out of the\n' +
      'environment. Every parcel is declared as leaving the same address, no matter\n' +
      'which seller it belongs to. That is a warehouse model, and Zoldify is a\n' +
      'marketplace of individuals.',
    style: S.note,
    x: 870, y: 1080, w: 800, h: 300,
  });

  return s;
}

// ===========================================================================
// 2e. ACTIVITY DIAGRAM — nạp ví.
// ===========================================================================
function topupActivityDiagram() {
  const s = createSheet('Activity Diagram - Top Up the Wallet');

  const laneH = 1120;
  const l1 = vertex(s, { value: 'User', style: S.laneV, x: 40, y: 40, w: 340, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 380, y: 40, w: 980, h: laneH });
  const l3 = vertex(s, { value: 'PayOS · bank', style: S.laneV, x: 1360, y: 40, w: 340, h: laneH });

  const act = (lane, v, x, y, w = 330, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 155, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Enter an amount, press Top up', 20, 115, 300);
  const a2 = act(l1, 'Scan the QR and pay from the bank app', 20, 470, 300, 55);

  const b1 = act(l2, 'POST /payos/create-link  type = topup', 140, 190, 360, 50);
  const d1 = vertex(s, {
    value: '10.000đ ≤ amount\n≤ 50.000.000đ?',
    style: S.decision, x: 230, y: 270, w: 180, h: 90, parent: l2,
  });
  const err1 = act(l2, '400 — amount out of range', 580, 285, 230, 60, S.actionTodo);
  const errEnd1 = vertex(s, { style: S.final, x: 680, y: 375, w: 30, h: 30, parent: l2 });

  const b2 = act(
    l2,
    'Ask PayOS for a link, save a PENDING payment\nWALLET_TOPUP · expires in 15 min',
    140, 390, 360, 60,
  );

  // `parent: l2` là bắt buộc. Thiếu nó, toạ độ được hiểu là tuyệt đối trên
  // trang chứ không phải theo làn, và khung rơi lệch sang trái tới mức cạnh
  // phải của nó cắt đôi ô bút toán bên trong.
  vertex(s, {
    value: 'ONE TRANSACTION',
    style:
      'rounded=0;html=1;fillColor=none;strokeColor=#2e7d32;strokeWidth=2;dashed=1;' +
      'verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=11;fontColor=#2e7d32;',
    x: 110, y: 605, w: 430, h: 320, parent: l2,
  });

  const w1 = act(l2, 'Verify the PayOS signature', 140, 645, 360, 45);
  const d2 = vertex(s, {
    value: 'Idempotency key\nalready posted?',
    style: S.decision, x: 230, y: 710, w: 180, h: 90, parent: l2,
  });
  const dupEnd = vertex(s, { style: S.flowFinal, x: 655, y: 740, w: 30, h: 30, parent: l2 });
  const w2 = act(
    l2,
    'Post to the ledger\ngateway_clearing −X → user.available +X',
    140, 840, 360, 60, S.actionDone,
  );
  const endN = vertex(s, { style: S.final, x: 305, y: 960, w: 30, h: 30, parent: l2 });

  const p1 = act(l3, 'Return checkoutUrl + QR', 25, 390, 290, 50);
  const p2 = act(l3, 'Money lands in the real\nbank account', 25, 545, 290, 55);
  const p3 = act(l3, 'Call the webhook', 25, 645, 290, 45);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, b1, '', at(1, 0.5, 0, 0.5));
  f(b1, d1);
  f(d1, err1, 'no', at(1, 0.5, 0, 0.5));
  f(err1, errEnd1);
  f(d1, b2, 'yes');
  f(b2, p1, '', at(1, 0.5, 0, 0.5));
  // Đường trả link về cho người dùng. Đi xuống trong rãnh x=1300 tuyệt đối
  // (bên phải mọi hình của làn giữa, ô xa nhất hết ở 1190) rồi mới rẽ ngang ở
  // y=537 — đúng tâm ô `Scan the QR`, và dưới đáy ô `Ask PayOS for a link`
  // (hết ở 490) nên đoạn ngang không chạm hình nào.
  f(p1, a2, '', at(0, 0.5, 1, 0.5), [[1300, 455], [1300, 537]]);
  f(a2, p2, '', at(1, 0.5, 0, 0.5));
  f(p2, p3);
  f(p3, w1, '', at(0, 0.5, 1, 0.5));
  f(w1, d2);
  f(d2, dupEnd, 'yes', at(1, 0.5, 0, 0.5));
  f(d2, w2, 'no');
  f(w2, endN, 'COMMIT');

  vertex(s, {
    value:
      'THE HOLE THAT WAS HERE UNTIL 14 AUGUST\n\n' +
      'POST /api/v1/payments with body {"amount": 999999999} called\n' +
      'walletsService.topup(user.id, amount) directly. Any signed-in account could\n' +
      'credit itself any sum. No bank transfer, no admin, no PayOS — and the ledger\n' +
      'entry it produced was indistinguishable from a real top-up.\n\n' +
      'The money was immediately spendable, and withdrawable through\n' +
      'POST /withdrawals. Only the admin approval step stood between a fabricated\n' +
      'balance and a real bank payout — and the admin sees nothing but a normal\n' +
      'looking balance.\n\n' +
      'POST /wallets/topup was worse in a quieter way: WalletsController carried no\n' +
      'guard at all, so a route into a function that writes to the ledger was\n' +
      'reachable without logging in. It answered 500 rather than 401 only because\n' +
      '@User() returned undefined and the code tripped over user.id.\n\n' +
      'Fixed: the /payments branch refuses and names the PayOS route; the wallets\n' +
      'controller takes JwtAuthGuard at class level and AdminGuard on topup;\n' +
      'route-guards.spec.ts now fails the build if any route loses its guard.',
    style: S.note,
    x: 40, y: 1190, w: 840, h: 330,
  });

  vertex(s, {
    value:
      'Why the wallet is only credited by the webhook\n\n' +
      'The ledger account `gateway_clearing` represents money that PayOS is holding\n' +
      'on our behalf. Every credit to a user wallet is paid for out of it, so the sum\n' +
      'of what we have handed out must always match what the gateway actually\n' +
      'received. Crediting a wallet without a matching bank event breaks that\n' +
      'equality, and it breaks it invisibly — the books still balance to zero because\n' +
      'the fake entry has two sides. It only surfaces when someone compares\n' +
      'gateway_clearing against the PayOS statement.\n\n' +
      'That is the whole reason the credit lives in the webhook and nowhere else.\n\n' +
      'The idempotency key is payos:{orderCode}:{paymentLinkId}, so PayOS may call\n' +
      'the webhook as many times as it likes. The second call finds the transaction\n' +
      'already posted and stops — a flow final, not an activity final: the request\n' +
      'still returns 200, which is what stops PayOS retrying forever.\n\n' +
      'The same key is used by GET /payos/refresh/:orderId, so whichever arrives\n' +
      'first wins and the other becomes a no-op.',
    style: S.note,
    x: 910, y: 1190, w: 840, h: 330,
  });

  return s;
}

// ===========================================================================
// 2f. ACTIVITY DIAGRAM — đăng nhập và vòng đời token.
// ===========================================================================
function loginActivityDiagram() {
  const s = createSheet('Activity Diagram - Login and Token Lifetime');

  // MỘT luồng duy nhất, không phải ba luồng rời.
  //
  // Bản đầu vẽ đăng nhập, gọi API và đăng xuất như ba đoạn tách nhau, mỗi đoạn
  // treo lơ lửng — riêng `Serve the request` không có cạnh ra nào cả, tức là
  // một hành động không bao giờ kết thúc. Nối liền lại thành một mạch: đăng
  // nhập → dùng token → đăng xuất, đúng nghĩa "vòng đời token" ở tiêu đề.
  const laneH = 1180;
  const l1 = vertex(s, { value: 'User', style: S.laneV, x: 40, y: 40, w: 340, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 380, y: 40, w: 980, h: laneH });
  const l3 = vertex(s, { value: 'MySQL', style: S.laneV, x: 1360, y: 40, w: 300, h: laneH });

  const act = (lane, v, x, y, w = 340, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 155, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Enter email and password', 20, 115, 300);
  const a2 = act(l1, 'Call an endpoint with the access token', 20, 690, 300, 55);
  const a3 = act(l1, 'Press Log out', 20, 1000, 300);

  const b1 = act(l2, 'LocalAuthGuard → validateUser', 140, 190, 340);
  const d1 = vertex(s, {
    value: 'bcrypt compare\nmatches?',
    style: S.decision, x: 225, y: 265, w: 180, h: 90, parent: l2,
  });
  const err1 = act(l2, '401 — wrong credentials', 580, 280, 230, 60, S.actionTodo);
  const errEnd1 = vertex(s, { style: S.final, x: 680, y: 370, w: 30, h: 30, parent: l2 });

  const b2 = act(l2, 'Read token_version from the user row', 140, 385, 340);
  // Thanh fork phải TRÙM được tâm của cả hai nhánh, nếu không hai cạnh toả ra
  // đều là đường chéo và nhìn không ra là song song. Tâm b3 = 255, tâm b4 = 535.
  const fork = vertex(s, { style: S.bar, x: 240, y: 460, w: 310, h: 8, parent: l2 });
  const b3 = act(l2, 'Sign the access token', 130, 500, 250, 45);
  const b4 = act(l2, 'Sign the refresh token,\nstore it on the user row', 410, 500, 250, 55);
  const join = vertex(s, { style: S.bar, x: 240, y: 600, w: 310, h: 8, parent: l2 });

  const b5 = act(l2, 'JwtStrategy decodes the token', 140, 760, 340, 45);
  const d2 = vertex(s, {
    value: 'payload.token_version\n= the row today?',
    style: S.decision, x: 225, y: 830, w: 180, h: 90, parent: l2,
  });
  const err2 = act(l2, '401 — token retired', 580, 845, 230, 60, S.actionTodo);
  const errEnd2 = vertex(s, { style: S.final, x: 680, y: 935, w: 30, h: 30, parent: l2 });
  const ok = act(l2, 'Serve the request', 140, 950, 340, 45, S.actionDone);

  const b6 = act(l2, 'token_version += 1, clear refresh_token', 140, 1030, 340, 50);
  const endN = vertex(s, { style: S.final, x: 295, y: 1105, w: 30, h: 30, parent: l2 });

  const m1 = act(l3, 'users.refresh_token', 20, 500, 250, 55);
  const m2 = act(l3, 'users.token_version', 20, 1030, 250, 50);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, b1, '', at(1, 0.5, 0, 0.5));
  f(b1, d1);
  f(d1, err1, 'no', at(1, 0.5, 0, 0.5));
  f(err1, errEnd1);
  f(d1, b2, 'yes');
  f(b2, fork);
  f(fork, b3, '', at(0.05, 1, 0.5, 0));
  f(fork, b4, '', at(0.95, 1, 0.5, 0));
  f(b4, m1, '', at(1, 0.5, 0, 0.5));
  f(b3, join, '', at(0.5, 1, 0.05, 0));
  f(b4, join, '', at(0.5, 1, 0.95, 0));
  // Token về tay người dùng, rồi người dùng mang nó đi gọi API.
  f(join, a2, '', at(0, 0.5, 0.5, 0));
  f(a2, b5, '', at(1, 0.5, 0, 0.5));
  f(b5, d2);
  f(d2, err2, 'no', at(1, 0.5, 0, 0.5));
  f(err2, errEnd2);
  f(d2, ok, 'yes');
  // Mạch chạy tiếp: phục vụ xong thì tới lúc người dùng đăng xuất.
  f(ok, a3, '', at(0, 0.5, 1, 0.5));
  f(a3, b6, '', at(1, 0.5, 0, 0.5));
  f(b6, m2, '', at(1, 0.5, 0, 0.5));
  f(b6, endN);

  vertex(s, {
    value:
      'THERE IS NO REFRESH ENDPOINT\n\n' +
      'The refresh token is signed at login and written to users.refresh_token, and\n' +
      'then nothing ever reads it. AuthController has login, register, OTP, firebase,\n' +
      'forgot-password, change-password, logout and profile — and no route that\n' +
      'exchanges a refresh token for a new access token.\n\n' +
      'So the second half of the usual pair does not exist. When the access token\n' +
      'expires the user is simply logged out and types their password again. The\n' +
      'refresh token is a stored credential that buys nothing.\n\n' +
      'Worth stating plainly at the defence, because the diagram of a login flow\n' +
      'normally implies a refresh loop, and a grader will look for it. Either build\n' +
      'POST /auth/refresh, or stop issuing and storing the token.\n\n' +
      'Storing it is not free: user.entity.ts already notes that a leaked row hands\n' +
      'over a valid refresh token, and nothing checks whether the stored one matches\n' +
      'the one presented — because nothing presents one.',
    style: S.note,
    x: 40, y: 1290, w: 820, h: 300,
  });

  vertex(s, {
    value:
      'What token_version buys, and what it costs\n\n' +
      'A JWT cannot be withdrawn once handed out — that is the trade a stateless\n' +
      'token makes. token_version buys the withdrawal back: the number is signed into\n' +
      'the payload, JwtStrategy compares it against the row on EVERY request, and\n' +
      'logout increments it. Every token issued before that moment stops working at\n' +
      'once, on every device.\n\n' +
      'That is the right call for a system holding money. A stolen token stops being\n' +
      'useful the moment the owner logs out, instead of staying valid until it\n' +
      'expires.\n\n' +
      'The cost is one row read per authenticated request, which is exactly the cost\n' +
      'a stateless token was supposed to avoid. Worth it here; worth knowing it is\n' +
      'the reason `users` is the hottest table in the system.\n\n' +
      'The parallel bars are a real fork: the two tokens are signed independently and\n' +
      'the response needs both. UML requires the fork to be closed by a join, and\n' +
      'the join is what the response waits on.',
    style: S.note,
    x: 890, y: 1290, w: 820, h: 300,
  });

  return s;
}

// ===========================================================================
// 2g. ACTIVITY DIAGRAM — đối soát sổ cái.
//
// Vẽ theo quy ước TO-BE: đây là luồng ĐÚNG, và gần như toàn bộ nó là ô đỏ, vì
// hiện chưa có dòng code nào chạy nó.
// ===========================================================================
function reconcileActivityDiagram() {
  const s = createSheet('Activity Diagram - Ledger Reconciliation (TO BE)');

  const laneH = 900;
  const l1 = vertex(s, { value: 'Hourly job', style: S.laneV, x: 40, y: 40, w: 340, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 380, y: 40, w: 1120, h: laneH });
  const l3 = vertex(s, { value: 'Admin', style: S.laneV, x: 1500, y: 40, w: 320, h: laneH });

  const act = (lane, v, x, y, w = 340, h = 50, style = S.actionTodo) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  const start = vertex(s, { style: S.initial, x: 155, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Wake up on the hour', 20, 115, 300);

  // Thanh fork phải trùm tâm của cả BA nhánh (210 · 550 · 890), nếu không
  // nhánh ngoài cùng bị nối bằng một đường chéo dài trông như cạnh lạc.
  const fork = vertex(s, { style: S.bar, x: 200, y: 200, w: 700, h: 8, parent: l2 });

  const c1 = act(
    l2,
    'CHECK 1 — every transaction balances\nSUM(entries) per transaction = 0',
    60, 250, 300, 60,
  );
  const c2 = act(
    l2,
    'CHECK 2 — cached balance matches\naccounts.balance = SUM(its entries)',
    400, 250, 300, 60,
  );
  const c3 = act(
    l2,
    'CHECK 3 — escrow rows match the ledger\nHOLDING rows = escrow_hold balance',
    740, 250, 300, 60,
  );

  const join = vertex(s, { style: S.bar, x: 200, y: 350, w: 700, h: 8, parent: l2 });

  const d1 = vertex(s, {
    value: 'All three\nagree?',
    style: S.decision, x: 250, y: 400, w: 180, h: 90, parent: l2,
  });
  const okBox = act(l2, 'Log the totals, do nothing else', 660, 415, 300, 50, S.action);
  const okEnd = vertex(s, { style: S.final, x: 795, y: 490, w: 30, h: 30, parent: l2 });

  const e1 = act(l2, 'Write a discrepancy record\nwith the account and the gap', 160, 540, 340, 60);
  const e2 = act(l2, 'RAISE AN ALARM — do NOT auto-correct', 160, 630, 340, 50);
  const e3 = act(l2, 'Freeze withdrawals until it is cleared', 160, 710, 340, 50);
  const endN = vertex(s, { style: S.final, x: 315, y: 800, w: 30, h: 30, parent: l2 });

  const p1 = act(l3, 'Sees the alarm,\ninvestigates by hand', 20, 630, 260, 60);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, a1);
  f(a1, fork, '', at(1, 0.5, 0, 0.5));
  f(fork, c1, '', at(0.014, 1, 0.5, 0));
  f(fork, c2, '', at(0.5, 1, 0.5, 0));
  f(fork, c3, '', at(0.986, 1, 0.5, 0));
  f(c1, join, '', at(0.5, 1, 0.014, 0));
  f(c2, join, '', at(0.5, 1, 0.5, 0));
  f(c3, join, '', at(0.5, 1, 0.986, 0));
  f(join, d1);
  f(d1, okBox, 'yes', at(1, 0.5, 0, 0.5));
  f(okBox, okEnd);
  f(d1, e1, 'no');
  f(e1, e2);
  f(e2, e3);
  f(e2, p1, '', at(1, 0.5, 0, 0.5));
  f(e3, endN);

  vertex(s, {
    value:
      'EVERY BOX IS RED. NONE OF THIS EXISTS.\n\n' +
      'Four places in the source already describe this job as though it runs:\n' +
      'ledger-account.entity.ts says an hourly job compares the two numbers,\n' +
      'orders.service.ts says the reconciliation job will spot the drift, seed.ts\n' +
      'says it surfaces in production, r6-state-escrow-lifecycle says an hourly\n' +
      'reconciliation job checks it.\n\n' +
      'The only cron in the repository is TasksService.autoCancelOrders. There is no\n' +
      'reconciliation job. Comments described an intention and then were read back as\n' +
      'a description of the system — which is exactly how a team ends up believing it\n' +
      'has a safety net it does not have.\n\n' +
      'This diagram is drawn to the same TO BE convention as the rest of the set: it\n' +
      'is the correct flow, drawn in red because it is not built. It is the smallest\n' +
      'piece of real work left that would most change what the system can promise.',
    style: S.note,
    x: 40, y: 970, w: 800, h: 260,
  });

  vertex(s, {
    value:
      'Why it must not correct anything by itself\n\n' +
      'A gap between the ledger and the cached balance means one of two things: the\n' +
      'ledger is right and the cache drifted, or something wrote money by a path\n' +
      'nobody knows about. Those need opposite responses, and the job cannot tell\n' +
      'them apart. A job that silently rewrites the balance to match destroys the\n' +
      'evidence of the second case — and the second case is the one that matters.\n\n' +
      'So: record, alarm, freeze withdrawals, and let a person look. Freezing is the\n' +
      'part that is easy to leave out and expensive to leave out, because a\n' +
      'withdrawal is the one operation that turns a number in the database into money\n' +
      'that cannot be recalled.\n\n' +
      'CHECK 1 is the invariant the whole double-entry design exists to guarantee, so\n' +
      'a failure there means a bug in LedgerService.post itself. CHECK 3 is the one\n' +
      'that catches the bugs found on 14 August: an escrow left HOLDING with no money\n' +
      'behind it shows up here and nowhere else.',
    style: S.note,
    x: 870, y: 970, w: 800, h: 260,
  });

  return s;
}

// ===========================================================================
// 3. CLASS DIAGRAM — slide 8
// ===========================================================================
function classDiagram() {
  const s = createSheet('Class Diagram');

  const user = umlClass(s, {
    value: 'User', x: 40, y: 60,
    attrs: ['+ id: int', '+ full_name: string', '+ email: string', '- password: string',
      '+ role: UserRole', '+ email_verified: bool'],
    methods: ['+ isSeller(): bool', '+ canModerate(): bool'],
  });

  const product = umlClass(s, {
    value: 'Product', x: 40, y: 400,
    attrs: ['+ id: int', '+ name: string', '+ price: decimal', '+ stock: int',
      '+ status: ProductStatus'],
    methods: ['+ isAvailable(): bool', '+ decreaseStock(qty): void'],
  });

  const category = umlClass(s, {
    value: 'Category', x: 40, y: 700,
    attrs: ['+ id: int', '+ name: string', '+ slug: string'],
  });

  const order = umlClass(s, {
    value: 'Order', x: 400, y: 60,
    attrs: ['+ id: int', '+ order_code: string', '+ final_amount: decimal',
      '+ status: OrderStatus', '+ is_paid: bool', '+ tracking_code: string'],
    methods: ['+ canTransitionTo(next): bool', '+ isCancellable(): bool'],
  });

  const orderItem = umlClass(s, {
    value: 'OrderItem', x: 400, y: 400,
    attrs: ['+ id: int', '+ product_name: string', '+ price: decimal',
      '+ quantity: int', '+ subtotal: decimal'],
  });

  const payment = umlClass(s, {
    value: 'Payment', x: 400, y: 640,
    attrs: ['+ id: int', '+ amount: decimal', '+ status: PaymentStatus',
      '+ payos_order_code: string'],
  });

  const escrow = umlClass(s, {
    value: 'Escrow', x: 760, y: 60,
    attrs: ['+ id: int', '+ amount: decimal', '+ status: EscrowStatus',
      '+ released_at: datetime'],
    methods: ['+ isReleasable(): bool'],
  });

  const ledgerTx = umlClass(s, {
    value: 'LedgerTransaction', x: 760, y: 320,
    attrs: ['+ id: bigint', '+ type: LedgerTxType', '+ idempotency_key: string',
      '+ reference_type: string', '+ reference_id: bigint'],
  });

  const ledgerEntry = umlClass(s, {
    value: 'LedgerEntry', x: 760, y: 600,
    attrs: ['+ id: bigint', '+ amount: bigint', '+ balance_after: bigint'],
  });

  const ledgerAcc = umlClass(s, {
    value: 'LedgerAccount', x: 1120, y: 600,
    attrs: ['+ id: bigint', '+ owner_type: LedgerOwnerType', '+ owner_id: bigint',
      '+ purpose: LedgerPurpose', '+ balance: bigint'],
  });

  const ledgerSvc = umlClass(s, {
    value: 'LedgerService', x: 1120, y: 60,
    attrs: ['- dataSource: DataSource'],
    methods: [
      '+ post(input, manager?): LedgerTransaction',
      '+ getBalance(type, id, purpose): bigint',
      '+ getOrCreateAccount(...): LedgerAccount',
      '- lockAccounts(em, ids): Map',
    ],
  });

  const withdrawal = umlClass(s, {
    value: 'Withdrawal', x: 1120, y: 350,
    attrs: ['+ id: int', '+ amount: decimal', '+ bank_account: string',
      '+ status: WithdrawalStatus'],
  });

  const rel = (a, b, v, style = 'endArrow=open;endFill=0;html=1;fontSize=11;') =>
    edge(s, { source: a, target: b, value: v, style });

  const compose =
    'endArrow=open;endFill=0;startArrow=diamondThin;startFill=1;startSize=12;html=1;fontSize=11;';

  rel(user, product, '1  sells  0..*');
  rel(user, order, '1  places  0..*');
  rel(user, withdrawal, '1  requests  0..*');
  rel(category, product, '1  classifies  0..*');
  edge(s, { source: order, target: orderItem, value: '1        1..*', style: compose });
  rel(product, orderItem, '1  appears in  0..*');
  rel(order, payment, '1  paid by  0..*');
  rel(order, escrow, '1  splits into  1..*');
  rel(escrow, user, 'held for seller');
  edge(s, { source: ledgerTx, target: ledgerEntry, value: '1        2..*', style: compose });
  rel(ledgerAcc, ledgerEntry, '1  records  0..*');
  edge(s, { source: ledgerSvc, target: ledgerTx, value: '«creates»', style: S.depend });
  edge(s, { source: escrow, target: ledgerSvc, value: '«uses»', style: S.depend });
  edge(s, { source: withdrawal, target: ledgerSvc, value: '«uses»', style: S.depend });

  vertex(s, {
    value:
      'LedgerService has no table of its own — it is the only class\n' +
      'allowed to change a balance. That is what a Class Diagram\n' +
      'shows and an ERD cannot: behaviour, not just storage.',
    style: S.note,
    x: 1120, y: 850, w: 400, h: 70,
  });

  return s;
}

// ===========================================================================
// 4. SEQUENCE DIAGRAM — slide 9. Webhook PayOS chống lặp.
// ===========================================================================
function sequenceDiagram() {
  const s = createSheet('Sequence Diagram - PayOS Webhook');

  const TOP = 60;
  const LIFE_H = 900;

  // Tâm mỗi lifeline. Thông điệp vẽ từ tâm sang tâm nên phải giữ lại con số.
  // Khoảng cách ledger↔db phải rộng hơn nhãn dài nhất chạy giữa hai cột đó
  // (bước 8, ~305px), nếu không chữ tràn lên thanh kích hoạt của lifeline.
  const L = {
    payos: 130,
    api: 400,
    ledger: 680,
    db: 1000,
    notif: 1290,
  };
  const lane = (v, cx, w) =>
    vertex(s, { value: v, style: S.lifeline, x: cx - w / 2, y: TOP, w, h: LIFE_H });

  lane('PayOS', L.payos, 150);
  lane('PayosService', L.api, 180);
  lane('LedgerService', L.ledger, 180);
  lane('MySQL', L.db, 150);
  lane('NotificationsService', L.notif, 200);

  // Hộp kích hoạt đặt bằng toạ độ tuyệt đối cho khớp với thông điệp
  const bar = (cx, y, h) =>
    vertex(s, { style: S.activation, x: cx - 5, y, w: 10, h });

  bar(L.api, 150, 690);
  bar(L.ledger, 250, 490);
  bar(L.db, 290, 380);
  bar(L.notif, 770, 40);

  const m = (from, to, y, v, style = S.msg) =>
    edgeAt(s, { x1: from, y1: y, x2: to, y2: y, value: v, style });

  /** Thông điệp tự gọi chính mình — vẽ thành móc vuông */
  const self = (cx, y, v) => {
    edgeAt(s, {
      x1: cx + 5, y1: y, x2: cx + 5, y2: y + 30, value: v,
      style: S.msg + 'edgeStyle=orthogonalEdgeStyle;rounded=0;exitX=1;exitY=0;entryX=1;entryY=0;',
    });
  };

  m(L.payos, L.api, 150, '1. POST /api/v1/payos/webhook');
  self(L.api, 190, '2. verify signature');
  m(L.api, L.ledger, 250, '3. post(key = payos:orderCode:linkId, manager)');
  m(L.ledger, L.db, 290, '4. BEGIN TRANSACTION');
  m(L.ledger, L.db, 330, '5. SELECT ledger_transactions WHERE idempotency_key');
  m(L.db, L.ledger, 370, '6. found / not found', S.ret);

  // ─────────────────────────────────────────────────────────────────────────
  // Khung `alt` phải có ĐỦ HAI NGĂN, ngăn cách bằng một nét đứt ngang, và
  // guard của ngăn thứ hai nằm BÊN TRONG khung.
  //
  // Bản trước chỉ vẽ một ngăn `[key is new]` rồi đẩy `else [key already used]`
  // xuống thành một ghi chú rời ở đáy trang. Đó không phải `alt` — một `alt`
  // một ngăn nói rằng khi khoá đã dùng thì KHÔNG có gì xảy ra cả, trong khi
  // thực tế đường đi ấy vẫn phải đóng transaction đã mở ở bước 4. Người đọc
  // sơ đồ không có nghĩa vụ ghép hai chỗ rời nhau lại với nhau.
  // ─────────────────────────────────────────────────────────────────────────
  // Mép trái khung lùi ra 540 để cái tab `alt` (rộng 120) kết thúc TRƯỚC
  // thanh kích hoạt của LedgerService ở x=675, thay vì đè lên nó.
  const ALT_X = 540;
  const ALT_W = 550;
  vertex(s, {
    value: 'alt  [key is new]',
    style: S.frame.replace('width=80', 'width=120'),
    x: ALT_X, y: 400, w: ALT_W, h: 300,
  });

  m(L.ledger, L.db, 450, '7. INSERT transaction, INSERT entries');
  m(L.ledger, L.db, 490, '8. SELECT ledger_accounts FOR UPDATE, UPDATE balance');
  m(L.ledger, L.db, 530, '9. UPDATE orders, INSERT escrows');
  m(L.ledger, L.db, 570, '10. COMMIT');

  // Vách ngăn giữa hai toán hạng của `alt`
  vertex(s, {
    style: 'line;strokeWidth=1;html=1;dashed=1;strokeColor=#666666;fillColor=none;',
    x: ALT_X, y: 600, w: ALT_W, h: 10,
  });
  vertex(s, {
    value: '[key already used]',
    style: 'text;html=1;align=left;verticalAlign=middle;fontSize=11;fontStyle=1;',
    x: ALT_X + 10, y: 610, w: 220, h: 18,
  });
  m(L.ledger, L.db, 660, "7'. COMMIT — nothing was written");

  m(L.ledger, L.api, 730, '11. LedgerTransaction', S.ret);
  m(L.api, L.notif, 780, '12. notify buyer, after commit');
  m(L.api, L.payos, 830, '13. 200 OK', S.ret);

  vertex(s, {
    value:
      'Steps 4 to 10 are ONE transaction. The idempotency key and the money share a fate:\n' +
      'a crash rolls both back, so the retry succeeds cleanly. The old code committed the\n' +
      'key first, so a crash silently swallowed the payment.\n\n' +
      'The lower branch is the normal path when PayOS resends the webhook, not an error.\n' +
      'LedgerService finds the existing row at step 5, writes nothing, and returns it —\n' +
      'so the caller gets the same LedgerTransaction it got the first time. That is what\n' +
      'makes the endpoint safe to retry any number of times.',
    style: S.note,
    x: 60, y: 1010, w: 700, h: 130,
  });

  return s;
}

// ===========================================================================
// 5. ENTITY RELATIONSHIP DIAGRAM — slide 10
// ===========================================================================
function erDiagram() {
  const s = createSheet('Entity Relationship Diagram');

  const ent = (value, x, y, cols) =>
    umlClass(s, { value, x, y, w: 300, attrs: cols });

  const users = ent('users', 40, 60, [
    'PK  id: int',
    '     email: varchar(150)  UNIQUE',
    '     password: varchar(255)',
    '     role: enum',
    '     email_verified: tinyint',
  ]);

  const orders = ent('orders', 420, 60, [
    'PK  id: int',
    '     order_code: varchar(50)  UNIQUE',
    'FK  user_id: int',
    '     final_amount: decimal(15,2)',
    '     status: enum',
    '     is_paid: tinyint',
  ]);

  const orderItems = ent('order_items', 420, 340, [
    'PK  id: int',
    'FK  order_id: int',
    'FK  product_id: int',
    '     quantity: int',
    '     subtotal: decimal(15,2)',
  ]);

  const products = ent('products', 40, 340, [
    'PK  id: int',
    'FK  seller_id: int',
    'FK  category_id: int',
    '     price: decimal(15,2)',
    '     stock: int',
    '     status: enum',
  ]);

  const escrows = ent('escrows', 800, 60, [
    'PK  id: int',
    'FK  order_id: int',
    'FK  buyer_id: int',
    'FK  seller_id: int',
    '     amount: decimal(15,2)',
    '     status: enum',
  ]);

  const ledgerTx = ent('ledger_transactions', 800, 340, [
    'PK  id: bigint',
    '     type: enum',
    '     idempotency_key: varchar(191)  UNIQUE',
    '     reference_type: varchar(50)',
    '     reference_id: bigint',
  ]);

  const ledgerEntries = ent('ledger_entries', 800, 600, [
    'PK  id: bigint',
    'FK  transaction_id: bigint',
    'FK  account_id: bigint',
    '     amount: bigint',
    '     balance_after: bigint',
  ]);

  const ledgerAccounts = ent('ledger_accounts', 420, 600, [
    'PK  id: bigint',
    '     owner_type: enum',
    '     owner_id: bigint',
    '     purpose: enum',
    '     balance: bigint',
  ]);

  // Ký pháp chân chim: một-nhiều
  const oneMany =
    'endArrow=ERmany;startArrow=ERone;endFill=0;startFill=0;html=1;fontSize=11;';

  const r = (a, b, v) => edge(s, { source: a, target: b, value: v, style: oneMany });

  r(users, orders, 'places');
  r(users, products, 'sells');
  r(orders, orderItems, 'contains');
  r(orders, escrows, 'splits into');
  r(ledgerTx, ledgerEntries, 'balances to zero');
  r(ledgerAccounts, ledgerEntries, 'records');

  // Hai quan hệ này cùng đi qua rãnh giữa `products` và `order_items`, và
  // draw.io đặt nhãn ở điểm giữa mỗi đường — nên "owns" và "appears in" rơi
  // chồng lên nhau, cách nhau chưa tới 20px, đọc thành một cục.
  //
  // Neo `appears in` xuống 80% chiều cao hai hộp để nó tụt hẳn xuống dưới, còn
  // `owns` giữ nguyên đường chéo. Hai nhãn tách ra khoảng 70px.
  edge(s, {
    source: products, target: orderItems, value: 'appears in',
    style: oneMany + 'exitX=1;exitY=0.8;exitDx=0;exitDy=0;entryX=0;entryY=0.8;entryDx=0;entryDy=0;',
  });
  r(users, ledgerAccounts, 'owns');

  vertex(s, {
    value:
      'ledger_entries is append-only: no column may be updated.\n' +
      'To reverse a transaction, post the opposite one.\n' +
      'idempotency_key is UNIQUE at the database level, not in code.',
    style: S.note,
    x: 40, y: 640, w: 340, h: 70,
  });

  return s;
}

// ===========================================================================
// 6. DEPLOYMENT DIAGRAM — slide 11. Node hộp 3D theo UML.
// ===========================================================================
function deploymentDiagram() {
  const s = createSheet('Deployment Diagram');

  const dev = vertex(s, {
    value: '«device»\nUser Device',
    style: S.node3d, x: 40, y: 80, w: 260, h: 220,
  });
  vertex(s, { value: 'Browser\n(Next.js shop client)\nzoldify.com', style: S.artifact, x: 60, y: 145, w: 210, h: 60 });
  vertex(s, { value: 'Android / iOS app\n(React Native, Expo)', style: S.artifact, x: 60, y: 215, w: 210, h: 55 });

  // Máy của quản trị viên là một origin khác, không phải một tab khác của cùng
  // trang. Đỏ = đã chốt 13/08/2026, chưa dựng.
  const adminDev = vertex(s, {
    value: '«device»\nAdmin workstation  (planned)',
    style: S.node3d + 'fillColor=#ffe0e0;strokeColor=#c62828;',
    x: 40, y: 340, w: 260, h: 140,
  });
  vertex(s, {
    value: 'Browser\n(Next.js admin client)\nadmin.zoldify.com\nseparate session',
    style: S.artifact, x: 60, y: 400, w: 210, h: 65,
  });

  const vps = vertex(s, {
    value: '«device»\nVPS — Ubuntu, Docker Compose',
    style: S.node3d, x: 420, y: 40, w: 620, h: 530,
  });

  vertex(s, { value: '«container»  caddy:2\nTLS termination, reverse proxy, :80 :443\nserves zoldify.com and admin.zoldify.com',
    style: S.artifact, x: 450, y: 120, w: 560, h: 65 });

  const apiNode = vertex(s, {
    value: '«execution environment»\nNode.js 20 — API replicas',
    style: S.node3d, x: 450, y: 200, w: 560, h: 150,
  });
  vertex(s, { value: 'zoldify-api  x3\nNestJS, stateless, mem_limit 512M',
    style: S.artifact, x: 475, y: 265, w: 250, h: 60 });
  vertex(s, { value: 'zoldify-worker  x1\nBullMQ + cron, mem_limit 256M',
    style: S.artifact, x: 740, y: 265, w: 245, h: 60 });

  vertex(s, { value: '«database»  mysql:8\nmax_connections 200, volume mysql_data',
    style: S.artifact, x: 450, y: 380, w: 270, h: 65 });
  vertex(s, { value: '«database»  redis:7\ncache, throttle, socket adapter, queue',
    style: S.artifact, x: 740, y: 380, w: 270, h: 65 });

  vertex(s, { value: 'cron on host\ndaily mysqldump, 14-day retention',
    style: S.artifact, x: 450, y: 470, w: 270, h: 55 });

  const cf = vertex(s, {
    value: '«device»\nCloudflare R2',
    style: S.node3d, x: 1140, y: 120, w: 240, h: 130,
  });
  vertex(s, { value: 'product images\ndatabase backups', style: S.artifact, x: 1165, y: 185, w: 190, h: 50 });

  const gw = vertex(s, {
    value: '«device»\nPayOS / GHN / FCM',
    style: S.node3d, x: 1140, y: 320, w: 240, h: 120,
  });
  vertex(s, { value: 'external HTTPS APIs', style: S.artifact, x: 1165, y: 385, w: 190, h: 35 });

  const gh = vertex(s, {
    value: '«device»\nGitHub Actions',
    style: S.node3d, x: 1140, y: 520, w: 240, h: 120,
  });
  vertex(s, { value: 'build image, push GHCR', style: S.artifact, x: 1165, y: 585, w: 190, h: 35 });

  const link = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });
  link(dev, vps, 'HTTPS  /api/v1\nWebSocket  /chat');
  link(adminDev, vps, 'HTTPS  /api/v1/admin');
  link(vps, cf, 'S3 API');
  link(vps, gw, 'HTTPS');
  link(gh, vps, 'SSH  compose pull && up -d');

  vertex(s, {
    value:
      'UML deployment notation: nodes are 3D boxes, artifacts sit inside them.\n' +
      'Three API replicas are only possible because every piece of state\n' +
      'lives in MySQL, Redis or R2 — never in process memory or on local disk.',
    style: S.note,
    x: 420, y: 780, w: 620, h: 80,
  });

  return s;
}

// ===========================================================================
// 7. SYSTEM CONTEXT — C4 mức 1. Chương I của báo cáo.
// ===========================================================================
function contextDiagram() {
  const s = createSheet('System Context Diagram');

  const zoldify = vertex(s, {
    value: 'ZOLDIFY\nSecond-hand marketplace for students\nwith wallet and escrow',
    style: S.component + 'fontStyle=1;verticalAlign=middle;align=center;spacingLeft=0;',
    x: 480, y: 300, w: 320, h: 140,
  });

  const actor = (v, x, y) =>
    vertex(s, { value: v, style: S.actor, x, y, w: 30, h: 60 });
  const ext = (v, x, y) =>
    vertex(s, { value: v, style: S.artifact + 'align=center;spacingLeft=0;verticalAlign=middle;', x, y, w: 190, h: 60 });

  const buyer = actor('Buyer\n(student)', 90, 180);
  const seller = actor('Seller\n(student)', 90, 380);
  const admin = actor('Admin\n(operations)', 90, 580);

  // SePay đã gỡ: PayOS là cổng thanh toán duy nhất. Dồn lại các ô phía dưới
  // thay vì để trống chỗ cũ — một khoảng hở giữa cột hệ thống ngoài trông như
  // sơ đồ vẽ thiếu, chứ không như một thứ đã được bỏ có chủ đích.
  const payos = ext('PayOS\npayment gateway', 1060, 100);
  const ghn = ext('GHN\nshipping', 1060, 190);
  const fcm = ext('Firebase FCM\npush notifications', 1060, 280);
  const r2 = ext('Cloudflare R2\nimage storage', 1060, 370);
  const smtp = ext('Gmail SMTP\nemail', 1060, 460);
  const bank = ext('Bank\nmanual payouts', 1060, 550);

  const f = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });

  f(buyer, zoldify, 'browse · buy · pay · chat');
  f(seller, zoldify, 'list items · fulfil · withdraw');
  f(admin, zoldify, 'approve withdrawals · reconcile');

  f(zoldify, payos, 'create payment link');
  f(payos, zoldify, 'confirmation webhook');
  f(zoldify, ghn, 'create and track shipments');
  f(zoldify, fcm, 'send notifications');
  f(zoldify, r2, 'store and read images');
  f(zoldify, smtp, 'verification email');
  f(admin, bank, 'manual bank transfer');

  vertex(s, {
    value:
      'Payouts are MANUAL: an admin transfers the money and marks it done.\n' +
      'A deliberate choice at this scale — bank payout APIs need a registered\n' +
      'company. The ledger models it honestly with a withdrawal_pending account.',
    style: S.note,
    x: 420, y: 700, w: 480, h: 80,
  });

  return s;
}

// ===========================================================================
// 8. CONTAINER — C4 mức 2. Chương I và VI.
// ===========================================================================
function containerDiagram() {
  const s = createSheet('Container Diagram');

  const box = (v, x, y, w, h) =>
    vertex(s, { value: v, style: S.component + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w, h });
  const store = (v, x, y) =>
    vertex(s, { value: v, style: S.node3d + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w: 220, h: 90 });

  const web = box('Shop web\nNext.js 14 App Router, SSR\nzoldify.com', 60, 70, 240, 90);
  const app = box('Mobile\nReact Native + Expo\nAndroid and iOS', 60, 195, 240, 90);

  // Đỏ = chưa dựng, cùng quy ước với các sơ đồ hoạt động và lớp.
  const admin = vertex(s, {
    value: 'Admin web  (planned)\nNext.js, separate deployable\nadmin.zoldify.com',
    style:
      S.component +
      'verticalAlign=middle;align=center;spacingLeft=0;fillColor=#ffe0e0;strokeColor=#c62828;',
    x: 60, y: 320, w: 240, h: 90,
  });

  vertex(s, {
    value: 'Single VPS — Docker Compose  (target deployment)',
    style: S.boundary, x: 400, y: 40, w: 640, h: 620,
  });

  const caddy = box('Caddy\nautomatic TLS, load balancing', 440, 90, 280, 70);
  const api = box('API x3\nNestJS, stateless', 440, 210, 280, 80);
  const worker = box('Worker x1\nBullMQ + cron', 760, 210, 240, 80);
  const mysql = store('MySQL 8\nsource of truth', 440, 340);
  const redis = store('Redis 7\ncache · throttle\nsocket adapter · queue', 760, 340);

  // R2 CHƯA CÓ THẬT. Không có client R2/S3 nào trong `src/`; multer ghi thẳng
  // xuống `public/images/{folder}` trên đĩa VPS (xem catalog/files/multer.config.ts).
  //
  // Bản trước vẽ R2 bằng đúng màu của thành phần đã dựng, và ghi chú khẳng
  // định "Images are not on the VPS disk". Cả hai đều sai so với code. Sơ đồ
  // kiến trúc mà nói sai chỗ để ảnh là thứ giám khảo hỏi một câu là lộ.
  //
  // Nay: ổ đĩa VPS vẽ thật (nằm trong khung), R2 vẽ đỏ = đã quyết, chưa dựng.
  // Đặt giữa, ngay dưới khe hở MySQL–Redis (x 660-760), để đường từ API đi
  // thẳng đứng trong khe đó. Bản đầu để ở (760,470) nên đường phải cắt chéo
  // qua khe và nhãn `writes images today` rơi đè lên hộp Redis.
  const disk = store('VPS disk\npublic/images/{folder}', 600, 480);
  const r2 = vertex(s, {
    value: 'Cloudflare R2  (planned)\nobject storage, outside the VPS',
    style:
      S.component +
      'verticalAlign=middle;align=center;spacingLeft=0;fillColor=#ffe0e0;strokeColor=#c62828;',
    x: 1100, y: 90, w: 250, h: 80,
  });

  const f = (a, b, v, style = S.flow) => edge(s, { source: a, target: b, value: v, style });

  /** Neo cạnh vào một điểm cụ thể trên hai hộp. */
  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;

  // Bốn client cùng đi vào Caddy. Không neo thì cả bốn đâm vào một cạnh và bốn
  // cái nhãn xếp chồng vùng nhau — nhìn không ra đường nào của ai.
  f(web, caddy, 'HTTPS /api/v1', S.flow + at(1, 0.5, 0, 0.3));
  f(app, caddy, 'HTTPS /api/v1', S.flow + at(1, 0.3, 0, 0.8));
  f(app, caddy, 'WebSocket /chat', S.depend + at(1, 0.7, 0.15, 1));
  f(admin, caddy, 'HTTPS admin API', S.flow + at(1, 0.4, 0.45, 1));
  f(caddy, api, '');
  f(api, mysql, '');
  f(api, redis, '');
  f(worker, mysql, '');
  f(worker, redis, '');
  // Rời api từ cạnh TRÊN và vào R2 từ cạnh TRÁI, đi qua hành lang trống giữa
  // hàng Caddy và hàng API. Bản trước để draw.io tự định tuyến: đường cắt thẳng
  // qua hộp MySQL và nhãn "upload" dính vào nhãn "MySQL 8" thành "MySQupload".
  f(api, disk, 'writes images today', S.flow + at(0.96, 1, 0.5, 0));
  f(api, r2, 'upload  (planned)', S.depend + at(0.5, 0, 0, 0.5));

  vertex(s, {
    value:
      'Four things this diagram states:\n' +
      '1. The API keeps NO state, so it can be replicated. Everything that used to\n' +
      '   live in process memory — cache, rate-limit counters, socket lists — is in Redis.\n' +
      '2. Exactly ONE worker. Cron inside the API would run the reconciliation job\n' +
      '   three times; for a job that touches money that is a serious bug.\n' +
      '3. Images ARE on the VPS disk today — multer writes to public/images/{folder},\n' +
      '   and there is no R2 or S3 client anywhere in src/. That blocks point 1: a\n' +
      '   second API replica cannot serve an image the first one wrote. Moving to R2\n' +
      '   is decided, not built.\n' +
      '4. Admin is its own deployable on its own hostname, so admin code is never\n' +
      '   shipped in the customer bundle. Sessions are per-origin, so an admin who\n' +
      '   also sells signs in twice.\n\n' +
      'Checked against the code on 14/08/2026. Red = decided, not built.\n\n' +
      'The VPS box itself is a target, not a running system: there is no Dockerfile and\n' +
      'no compose file in any of the four repos, and scripts/test-db.mjs starts MySQL\n' +
      'with a bare `docker run`. What is drawn inside the box is how it is meant to be\n' +
      'deployed. Whether a redeploy would keep user uploads cannot be answered from\n' +
      'this repository — that depends on a volume mount that has not been written yet.',
    style: S.note,
    x: 60, y: 700, w: 740, h: 285,
  });

  return s;
}

// ===========================================================================
// 9. COMPONENT — C4 mức 3, sáu bounded context và luật phụ thuộc.
// ===========================================================================
function componentDiagram() {
  const s = createSheet('Component Diagram - Bounded Contexts');

  const ctx = (v, x, y, w = 300, h = 90) =>
    vertex(s, { value: v, style: S.component + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w, h });

  // ─────────────────────────────────────────────────────────────────────────
  // Bản trước tự mâu thuẫn: ghi chú viết "Arrows point DOWNWARD only" nhưng
  // `Ordering` và `Money` lại được vẽ NGANG HÀNG nhau, nên mũi tên phụ thuộc
  // giữa chúng nằm ngang. Sơ đồ tuyên bố kiến trúc phân tầng mà không xếp
  // theo tầng thì người đọc không có cách nào kiểm chứng luật ấy bằng mắt.
  //
  // Nay xếp đúng bốn tầng, tầng dưới không bao giờ biết tầng trên:
  //   tầng 3  Ops        — chỉ nó gọi xuống, không ai gọi nó
  //   tầng 2  Ordering
  //   tầng 1  Catalog · Money · Messaging
  //   tầng 0  Identity   — nền móng, phụ thuộc vào không ai
  //
  // Mũi tên `Ordering → Money` trước cắm vào cạnh TRÁI của Money, đúng chỗ ba
  // ô cổng (port) của ký hiệu component, nhìn ra hai đầu mũi tên chồng nhau.
  // Nay vào từ cạnh trên, tránh hẳn vùng cổng.
  // ─────────────────────────────────────────────────────────────────────────

  const ops = ctx('Ops\nadmin · settings · tasks', 560, 60);
  const ordering = ctx('Ordering\ncarts · orders · ghn', 560, 220);
  const catalog = ctx(
    'Catalog\nproducts · categories · shop\nfiles · interactions · follows',
    120, 390, 320, 110);
  const money = ctx(
    'Money\nledger · wallets · escrows\npayments · payos · withdrawals',
    520, 390, 380, 110);
  const messaging = ctx('Messaging\nchat · notifications · firebase', 980, 390, 300, 110);
  const identity = ctx('Identity\nauth · users · addresses', 520, 610, 320, 90);

  // Money tô đậm vì nó là context được bảo vệ chặt nhất
  vertex(s, {
    value: '',
    style: 'rounded=0;html=1;fillColor=none;strokeColor=#2C67C8;strokeWidth=3;dashed=1;',
    x: 505, y: 375, w: 410, h: 140,
  });

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const dep = (a, b, anchors = '', points) =>
    edge(s, { source: a, target: b, style: S.flow + anchors, points });

  // Ops gọi xuống ba context. Hai đường vòng ra ngoài hẳn để không đi xuyên
  // qua `Ordering` đang nằm chắn ngay bên dưới.
  dep(ops, ordering, at(0.5, 1, 0.5, 0));
  // Vào Money từ CẠNH TRÊN chứ không phải cạnh phải: cạnh phải nằm sát viền
  // đứt "protected core", mũi tên đâm vào đó trông như đang trỏ vào cái viền.
  dep(ops, money, at(1, 0.5, 0.85, 0), [[960, 105], [960, 355], [843, 355]]);
  dep(ops, catalog, at(0, 0.5, 0, 0.5), [[90, 105], [90, 445]]);

  dep(ordering, money, at(0.5, 1, 0.5, 0));
  dep(ordering, catalog, at(0, 0.5, 0.8, 0));
  dep(ordering, identity, at(0, 0.75, 0.2, 0), [[480, 285], [480, 575], [584, 575]]);

  dep(catalog, identity, at(0.5, 1, 0, 0.7), [[280, 500], [280, 673]]);
  dep(money, identity, at(0.5, 1, 0.6, 0));
  dep(messaging, identity, at(0.2, 1, 1, 0.5));

  vertex(s, {
    value:
      'Arrows point DOWNWARD only. Identity is the foundation and depends on nobody.\n' +
      'Money depends only on Identity.\n\n' +
      'Money must NOT point at Ordering. Ordering computes the amount and calls Money,\n' +
      'passing a reference like {type: order, id: 123}. To Money that reference is an\n' +
      'opaque string — it does not know what an order is. That is what makes Money the\n' +
      'easiest context to split into its own service later.\n\n' +
      'The rule is enforced by eslint-plugin-boundaries, not by convention. Current\n' +
      'debt: 29 legacy violations, allowed to shrink but never to grow.',
    style: S.note,
    x: 80, y: 760, w: 660, h: 155,
  });

  vertex(s, {
    value: 'Money — the protected core.\nEvery balance change goes through LedgerService.post()',
    style: S.note,
    x: 980, y: 580, w: 320, h: 70,
  });

  return s;
}

// ===========================================================================
// 10. FUND FLOW — T-account. Slide 13 hoặc 14.
// ===========================================================================
function fundFlowDiagram() {
  const s = createSheet('Fund Flow Diagram');

  const acc = (v, x, y, fill) =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=12;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 230, h: 80,
    });

  // Khoảng cách ngang giữa các cột phải RỘNG HƠN nhãn dài nhất chạy qua nó.
  // Bản trước để cột 2 ở x=380, cách gateway đúng 90px, trong khi nhãn
  // `1b · order paid via PayOS` rộng ~145px — nên nó tràn lên cả hai hộp.
  // Ba cột nay cách nhau 150px, 120px và 140px.
  const gateway = acc('gateway_clearing\nmoney arriving from PayOS', 60, 260, '#eef6ff');
  const buyer = acc('buyer.available\nbuyer wallet', 440, 100, '#ffffff');
  const hold = acc('escrow_hold\nheld by Zoldify', 440, 320, '#ffd700');
  const seller = acc('seller.available\nseller wallet', 790, 200, '#ffffff');
  const revenue = acc('platform.revenue\nZoldify revenue', 790, 420, '#90ee90');
  const pending = acc('seller.withdrawal_pending\nawaiting manual payout', 1160, 200, '#fff3cd');
  const bank = acc('bank_external\nleft the system', 1160, 380, '#e8e8e8');

  const f = (a, b, v, anchors = '') =>
    edge(s, { source: a, target: b, value: v, style: S.flow + anchors });

  // Hai cặp đi hai chiều giữa cùng một cặp hộp. Không tách điểm neo thì
  // draw.io vẽ chúng chồng khít lên nhau và hai nhãn dính thành một chuỗi
  // vô nghĩa.
  const DOWN_LEFT = 'exitX=0.3;exitY=1;entryX=0.3;entryY=0;';
  const UP_RIGHT = 'exitX=0.7;exitY=0;entryX=0.7;entryY=1;';
  const RIGHT_HIGH = 'exitX=1;exitY=0.3;entryX=0;entryY=0.3;';
  const LEFT_LOW = 'exitX=0;exitY=0.7;entryX=1;entryY=0.7;';

  f(gateway, buyer, '1 · wallet top-up');
  f(gateway, hold, '1b · order paid via PayOS',
    'exitX=1;exitY=0.75;entryX=0;entryY=0.5;');
  f(buyer, hold, '2 · place order', DOWN_LEFT);
  f(hold, buyer, '4 · refund', UP_RIGHT);
  f(hold, seller, '3a · delivered, 95%');
  f(hold, revenue, '3b · platform fee, 5%');
  f(seller, pending, '5 · seller requests', RIGHT_HIGH);
  f(pending, seller, '6a · rejected', LEFT_LOW);
  f(pending, bank, '6b · transfer completed');

  vertex(s, {
    value:
      'The yellow box is the single most important number in the system. Its balance\n' +
      'must always equal the real money sitting in Zoldify\'s bank account.\n\n' +
      'It answers the first question any auditor, investor or payment partner asks:\n' +
      '"How much of your users\' money are you holding, and how do you prove it?"\n' +
      'One SQL query. The old architecture could not answer it at all.\n\n' +
      'Steps 5 and 6 are separate because the payout is a human action. Between them\n' +
      'the money has left the seller\'s wallet but not the system — without a dedicated\n' +
      'account for that state, the books cannot be reconciled against the bank.',
    style: S.note,
    x: 60, y: 560, w: 720, h: 160,
  });

  return s;
}

// ===========================================================================
// 11 + 12. STATE MACHINE — vòng đời đơn hàng và ký quỹ. Chương III.
// ===========================================================================
function orderStateDiagram() {
  const s = createSheet('State Machine - Order Lifecycle');

  const st = (v, x, y, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=30;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;' +
        `verticalAlign=middle;align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 170, h: 55,
    });

  // ─────────────────────────────────────────────────────────────────────────
  // Bản trước có ba lỗi nhìn thấy ngay trên hình:
  //
  //  1. Nhãn `RELEASE escrow` rơi đúng lên tên trạng thái `refunded`, che mất
  //     chữ. Nguyên nhân: cạnh `delivered → done` đi xuyên qua chính ô
  //     `refunded`, mà điểm giữa cạnh — chỗ draw.io đặt nhãn — nằm trong ô đó.
  //  2. Nhãn `[ship directly]` rơi vào giữa ô `processing`, che luôn tên
  //     trạng thái. Cạnh `confirmed → shipping` nhảy cóc qua `processing` nên
  //     điểm giữa của nó chính là tâm ô bị nhảy cóc.
  //  3. Hai cạnh `delivered → refunded` và `delivered → done` gần như trùng
  //     phương, hai nhãn chồng nhau.
  //
  // Cách chữa chung: KHÔNG để cạnh nào đi xuyên cột trạng thái. Trục chính là
  // một cột dọc; cạnh nhảy cóc chạy trong rãnh trống x=50 bên trái; các
  // trạng thái kết thúc tách hẳn sang phải; mỗi cạnh vào/ra một ô dùng một
  // điểm neo khác nhau.
  // ─────────────────────────────────────────────────────────────────────────

  const start = vertex(s, { style: S.initial, x: 190, y: 50, w: 30, h: 30 });
  const pending = st('pending', 120, 120);
  const confirmed = st('confirmed', 120, 250);
  const processing = st('processing', 120, 380);
  const shipping = st('shipping', 120, 510);
  const delivered = st('delivered', 120, 640, '#d5f5dd');
  const cancelled = st('cancelled', 490, 120, '#ffe0e0');
  const refunded = st('refunded', 490, 420, '#ffe0e0');
  const done = vertex(s, { style: S.final, x: 810, y: 290, w: 30, h: 30 });

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const t = (a, b, v, style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  // Trục chính, thẳng đứng
  t(start, pending, 'buyer places order');
  t(pending, confirmed, 'seller accepts');
  t(confirmed, processing, 'preparing goods');
  t(processing, shipping, 'GHN shipment created');
  t(shipping, delivered, 'buyer confirms receipt');

  // Nhảy cóc qua `processing`: chạy trong rãnh trống bên trái cột trạng thái.
  t(confirmed, shipping, 'ship directly', at(0, 0.5, 0, 0.5), [[50, 277], [50, 537]]);

  // Sang nhánh huỷ / hoàn tiền. Mỗi cạnh một điểm neo riêng để hai nhãn không
  // rơi cùng chỗ.
  t(pending, cancelled, 'cancel before acceptance', at(1, 0.5, 0, 0.5));
  t(confirmed, cancelled, 'cancel after acceptance', at(1, 0.25, 0, 0.85));
  t(cancelled, refunded, 'admin refunds', at(0.5, 1, 0.5, 0));
  t(delivered, refunded, 'admin refunds', at(1, 0.2, 0.5, 1));

  // Ba lối vào trạng thái kết thúc, ba hướng khác nhau.
  t(cancelled, done, 'nothing was paid', at(1, 0.5, 0.5, 0));
  t(refunded, done, 'REFUND escrow', at(1, 0.5, 0, 0.5));
  t(delivered, done, 'RELEASE escrow', at(1, 0.8, 0.5, 1), [[825, 684]]);

  vertex(s, {
    value:
      'Every arrow into the final state moves money. That is why authorization on\n' +
      'this state machine is a financial control, not a UX detail.\n\n' +
      'Who may make each move — enforced by order-status.policy.ts:\n' +
      '  confirmed / processing / shipping ....... seller or admin\n' +
      '  delivered ............................... BUYER or admin, and only from shipping\n' +
      '  refunded ................................ admin only\n' +
      '  cancelled ............................... neither; use /cancel or /cancel-sale,\n' +
      '                                            those also restore stock\n\n' +
      'The principle: whoever gains must not be the one who presses the button.\n' +
      'A seller marking their own order delivered would be releasing their own escrow.',
    style: S.note,
    x: 40, y: 780, w: 700, h: 180,
  });

  return s;
}

function escrowStateDiagram() {
  const s = createSheet('State Machine - Escrow Lifecycle');

  const st = (v, x, y, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=30;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;' +
        `verticalAlign=middle;align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 170, h: 55,
    });

  const start = vertex(s, { style: S.initial, x: 95, y: 60, w: 30, h: 30 });
  const holding = st('holding', 25, 170, '#ffd700');
  // Cột phải đẩy từ x=400 ra 440: nhãn `order cancelled or refunded` rộng
  // ~150px, ở khoảng cách cũ nó chạm mép trái hộp `refunded`.
  const released = st('released', 440, 70, '#d5f5dd');
  const refunded = st('refunded', 440, 190, '#ffe0e0');
  const cancelled = st('cancelled', 440, 310, '#e8e8e8');
  const done = vertex(s, { style: S.final, x: 760, y: 185, w: 30, h: 30 });

  const t = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });

  t(start, holding, 'order paid, money held');
  t(holding, released, 'order delivered');
  t(holding, refunded, 'order cancelled or refunded');
  t(holding, cancelled, 'payment window expired');
  t(released, done, '');
  t(refunded, done, '');
  t(cancelled, done, '');

  vertex(s, {
    value:
      'The escrow_hold balance must ALWAYS match the real bank account.\n' +
      'An hourly reconciliation job checks it.',
    // Ghi chú hạ xuống y=420: ở y=300 nó nằm đúng trên đường
    // `payment window expired`, mép trên hộp chạm vào nét vẽ.
    style: S.note, x: 25, y: 420, w: 340, h: 55,
  });

  vertex(s, {
    value:
      'TERMINAL states. There is no way back.\n' +
      'To reverse one, post an opposite ledger transaction;\n' +
      'never edit the existing rows. ledger_entries is append-only.',
    style: S.note, x: 700, y: 60, w: 360, h: 70,
  });

  return s;
}

// ===========================================================================
// 13. SCREEN NAVIGATION — chương III, mục UI Design.
// ===========================================================================
function navigationDiagram() {
  const s = createSheet('Screen Navigation Diagram');

  const scr = (v, x, y, w = 170, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=14;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#666666;`,
      x, y, w, h: 46,
    });

  // ─────────────────────────────────────────────────────────────────────────
  // Bản trước là cái hỏng nặng nhất trong cả bộ. Bảy đường đi XUYÊN QUA thân
  // các ô màn hình: `Valid token? → home` xuyên `log in` và `forgot password`;
  // `home → product detail` xuyên `search`; `my orders → order detail` xuyên
  // cả `chat` lẫn `cart`; `chat → chat room` và `profile → dashboard` cùng
  // xuyên `cart`; `profile → settings` xuyên `checkout`. Và ô
  // `payment/return` bị CHÍNH GHI CHÚ đè lên, mất hẳn khỏi hình.
  //
  // Nguyên nhân gốc: xếp màn hình thành lưới 2 cột rồi để draw.io tự định
  // tuyến. Trong lưới 2 cột, mọi đường đi ngang đều đâm vào ô cột bên cạnh.
  //
  // Cách dựng lại: mỗi nhóm là MỘT CỘT DỌC, giữa các cột chừa rãnh trống, và
  // mọi đường đi xa được bẻ góc vuông chạy trong rãnh. Đường dài hơn nhưng
  // không có đường nào chạm vào một ô nào.
  //
  //   rãnh x=30            lối `yes` vòng ra ngoài nhóm (auth)
  //   rãnh x 290-360       giữa (tabs) và cột mua hàng
  //   rãnh y 350-430       băng ngang trống giữa (auth) và phần thân
  //   rãnh x 530-620       giữa cột mua hàng và cột sau-đặt-hàng
  //   rãnh x 810-880       trước khối seller
  //   rãnh y > 810         băng ngang dưới đáy mọi cột
  // ─────────────────────────────────────────────────────────────────────────

  const start = vertex(s, { style: S.initial, x: 130, y: 40, w: 30, h: 30 });
  const check = vertex(s, {
    value: 'Valid token?', style: S.decision, x: 60, y: 110, w: 170, h: 70,
  });

  vertex(s, { value: '(auth) — 4 screens', style: S.boundary, x: 60, y: 240, w: 620, h: 110 });
  const login = scr('log in', 75, 280, 140);
  const register = scr('register', 225, 280, 140);
  const forgot = scr('forgot password', 375, 280, 140);
  const verify = scr('verify email', 525, 280, 140);

  // Ô đầu tiên phải cách mép trên hộp nhóm ≥35px, nếu không nó đè lên chính
  // tiêu đề của nhóm — `boundary` đặt tiêu đề bên trong, sát mép trên.
  vertex(s, { value: '(tabs) — 5 screens', style: S.boundary, x: 60, y: 430, w: 230, h: 330 });
  const home = scr('home', 75, 465);
  const search = scr('search', 75, 525);
  const myorders = scr('my orders', 75, 585);
  const chatlist = scr('chat', 75, 645);
  const profile = scr('profile', 75, 705);

  const settings = scr('settings and addresses', 60, 800, 200);

  // Cột mua hàng
  const shop = scr('seller shop', 360, 430);
  const product = scr('product detail', 360, 490);
  const cart = scr('cart', 360, 550);
  const checkout = scr('checkout', 360, 610);
  const payos = scr('PayOS WebView', 360, 670, 170, '#fff3cd');
  const ret = scr('payment/return', 360, 760);

  // Cột sau khi đặt hàng
  const room = scr('chat room', 620, 430);
  const orderDetail = scr('order detail', 620, 550);
  const tracking = scr('GHN tracking', 620, 610);

  vertex(s, { value: 'seller/ — 8 screens', style: S.boundary, x: 880, y: 410, w: 410, h: 280 });
  const dash = scr('dashboard', 900, 450);
  const prods = scr('my products', 1095, 450);
  const newProd = scr('list an item', 900, 510);
  const editProd = scr('edit listing', 1095, 510);
  const sorders = scr('sales orders', 900, 570);
  const wallet = scr('wallet', 1095, 570);
  const withdraw = scr('withdraw', 900, 630);
  const txns = scr('transactions', 1095, 630);

  const at = (ex, ey, nx, ny) =>
    `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
  const f = (a, b, v = '', style = '', points) =>
    edge(s, { source: a, target: b, value: v, style: S.flow + style, points });

  f(start, check);
  f(check, login, 'no', at(0.5, 1, 0.5, 0));
  // `yes` vòng hẳn ra ngoài mép trái để không đâm qua (auth)
  f(check, home, 'yes', at(0, 0.5, 0, 0.5), [[30, 145], [30, 488]]);
  // Vào `home` lệch sang trái: nhãn nhóm `(tabs) — 5 screens` nằm giữa mép
  // trên hộp nhóm, cắm mũi tên vào giữa là đè mất chữ.
  f(login, home, '', at(0.5, 1, 0.15, 0), [[145, 395], [100, 395]]);

  // Trong cột mua hàng mọi bước nối thẳng đứng
  f(home, product, '', at(1, 0.5, 0, 0.5));
  f(search, product, '', at(1, 0.5, 0, 0.85));
  f(product, shop, '', at(0.5, 0, 0.5, 1));
  f(product, cart, '', at(0.5, 1, 0.5, 0));
  f(cart, checkout, '', at(0.5, 1, 0.5, 0));
  f(checkout, payos, '', at(0.5, 1, 0.5, 0));
  edge(s, {
    source: payos, target: ret, value: 'deep link',
    style: S.depend + at(0.5, 1, 0.5, 0),
  });

  // Ba đường dài, bẻ góc vuông trong rãnh trống
  f(ret, orderDetail, '', at(1, 0.5, 0, 0.5), [[600, 783], [600, 573]]);
  f(myorders, orderDetail, '', at(1, 0.5, 0, 0.2), [[310, 608], [310, 380], [560, 380], [560, 559]]);
  f(chatlist, room, '', at(1, 0.5, 0, 0.5), [[330, 668], [330, 400], [580, 400], [580, 453]]);
  f(profile, dash, '', at(1, 0.5, 0, 0.5), [[340, 728], [340, 830], [840, 830], [840, 473]]);

  f(orderDetail, tracking, '', at(0.5, 1, 0.5, 0));
  f(profile, settings, '', at(0.5, 1, 0.5, 0));

  vertex(s, {
    value:
      'The deep link zoldify://payment/return only navigates the UI. The single source\n' +
      'of truth for "this was paid" is the PayOS webhook hitting the backend — a user\n' +
      'can close the browser before being redirected, and a URL can be typed by hand.\n\n' +
      'The eight seller screens are roughly half the total app work. They are the\n' +
      'first thing to cut if the four-person team runs short: sellers already have\n' +
      'the full flow on the web, buyers do not.\n\n' +
      'Screens inside a group box are drawn without arrows between them on purpose —\n' +
      'a group is a navigation stack, and every screen in it is reachable from every\n' +
      'other. Arrows are only drawn where one stack hands over to another.',
    style: S.note,
    x: 360, y: 880, w: 640, h: 175,
  });

  return s;
}

// ===========================================================================
// 14. CI/CD PIPELINE — phụ lục báo cáo.
// ===========================================================================
function cicdDiagram() {
  const s = createSheet('Deployment Pipeline');

  const step = (v, x, y, w = 220, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=20;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w, h: 50,
    });

  const dev = step('Developer pushes\na feature branch', 60, 60);
  const pr = step('Open Pull Request', 60, 150);

  vertex(s, { value: 'CI checks — all must pass', style: S.boundary, x: 340, y: 40, w: 560, h: 250 });
  const c1 = step('lint + typecheck', 370, 90, 240);
  const c2 = step('boundaries:check\nblocks context violations', 370, 155, 240, '#ffe8cc');
  const c3 = step('test\n37 tests, money on real MySQL', 370, 220, 240);
  const c4 = step('build', 640, 90, 230);
  const c5 = step('openapi:check\ndiffers from commit means fail', 640, 155, 230, '#ffe8cc');
  const c6 = step('diagrams:check\n25 diagrams must parse', 640, 220, 230, '#ffe8cc');

  // Nút quyết định đặt DƯỚI khung, không nằm trong.
  //
  // Hai lý do. Đúng về ngữ nghĩa: nó là kết quả của cụm kiểm, không phải một
  // phép kiểm. Và đúng về bố cục: khi nó nằm trong khung, mọi đường thẳng từ nó
  // sang cột bên phải đều xuyên qua ô `diagrams:check`, làm nhãn "yes" dính vào
  // chữ trong ô đó thành "25 diagrams must parsyes".
  const gate = vertex(s, {
    value: 'All green?', style: S.decision, x: 500, y: 330, w: 160, h: 70,
  });

  const review = step('Reviewed by\nanother member', 990, 150, 220);
  const merge = step('Merge into develop', 990, 240, 220);
  const main = step('Merge develop into main', 990, 330, 220);
  const build = step('Build image,\npush to GHCR', 990, 420, 220);
  const deploy = step('SSH to VPS\ncompose pull and up -d', 990, 510, 220);
  const migrate = step('Run migrations\nseparate step, has a rollback', 990, 600, 220);
  const health = vertex(s, {
    value: '/api/v1/health\nok?', style: S.decision, x: 1010, y: 690, w: 180, h: 80,
  });
  const rollback = step('Roll back to\nprevious image', 700, 700, 220, '#ffe0e0');
  const done = step('Done', 1010, 810, 180, '#d5f5dd');

  const f = (a, b, v = '') => edge(s, { source: a, target: b, value: v, style: S.flow });

  f(dev, pr);
  f(pr, c1);
  f(gate, dev, 'no');
  f(gate, review, 'yes');
  f(review, merge);
  f(merge, main);
  f(main, build);
  f(build, deploy);
  f(deploy, migrate);
  f(migrate, health);
  f(health, rollback, 'fails');
  f(health, done, 'ok');

  vertex(s, {
    value:
      'The three orange gates are what makes the architecture hold over time.\n\n' +
      'boundaries:check turns the context dependency rule from a spoken agreement\n' +
      'into a merge blocker. Without it the rule is broken within two weeks.\n\n' +
      'openapi:check guarantees web and mobile never build against a stale contract.\n\n' +
      'diagrams:check means a broken diagram cannot be merged — the report depends\n' +
      'on them rendering.\n\n' +
      'NOT BUILT YET: the backend has no .github/workflows at all. This is B, week 1.',
    style: S.note,
    x: 60, y: 420, w: 620, h: 180,
  });

  // Cùng một hình dạng pipeline chạy cho từng repo. Vẽ bốn lần thì sơ đồ dài
  // gấp bốn mà không nói thêm điều gì, nên liệt kê ở đây kèm chỗ khác nhau.
  vertex(s, {
    value:
      'This pipeline runs per repository. Four repositories:\n\n' +
      'Zoldify_Backend    lint · boundaries:check · test · build · openapi:check · diagrams:check\n' +
      'Zoldify_Frontend   lint · build · gen:api must match the committed schema\n' +
      'Zoldify_Admin      lint · build · check-shared must match Zoldify_Frontend   (planned)\n' +
      'Zoldify_Mobile     lint · typecheck · EAS build\n\n' +
      'check-shared is the gate specific to the admin split: the modules copied from\n' +
      'the shop repo must stay byte-identical. Without it the two copies drift, which\n' +
      'is exactly how the order-status table ended up with four versions.',
    style: S.note,
    x: 60, y: 620, w: 620, h: 190,
  });

  return s;
}

// ===========================================================================

// Kích thước trang đặt riêng từng sơ đồ. Để mặc định thì draw.io vẽ đường
// ngắt trang cắt ngang hình, và lúc export ra ảnh sẽ bị xén.
const FILES = [
  ['05-use-case-diagram.drawio', [useCaseDiagram()], { width: 1400, height: 1540 }],
  ['06-activity-diagram.drawio', [activityDiagram()], { width: 1750, height: 2000 }],
  ['06b-activity-cancel-refund.drawio', [cancelRefundActivityDiagram()], { width: 1900, height: 1600 }],
  ['06c-activity-list-item.drawio', [listItemActivityDiagram()], { width: 1800, height: 1600 }],
  ['06d-activity-ghn-shipment.drawio', [ghnActivityDiagram()], { width: 1750, height: 1430 }],
  ['06e-activity-topup.drawio', [topupActivityDiagram()], { width: 1800, height: 1570 }],
  ['06f-activity-login.drawio', [loginActivityDiagram()], { width: 1760, height: 1660 }],
  ['06g-activity-ledger-reconcile.drawio', [reconcileActivityDiagram()], { width: 1880, height: 1280 }],
  ['08-class-diagram.drawio', [classDiagram()], { width: 1600, height: 1000 }],
  ['09-sequence-diagram.drawio', [sequenceDiagram()], { width: 1400, height: 1110 }],
  ['10-entity-relationship-diagram.drawio', [erDiagram()], { width: 1200, height: 920 }],
  ['11-deployment-diagram.drawio', [deploymentDiagram()], { width: 1450, height: 900 }],

  // Không có slide riêng trong mẫu, nhưng cần cho báo cáo và cho việc hiểu
  // hệ thống. Đặt tên mô tả thay vì số slide.
  ['r1-system-context.drawio', [contextDiagram()], { width: 1350, height: 820 }],
  ['r2-container.drawio', [containerDiagram()], { width: 1420, height: 1060 }],
  ['r3-component-bounded-contexts.drawio', [componentDiagram()], { width: 1250, height: 890 }],
  ['r4-fund-flow.drawio', [fundFlowDiagram()], { width: 1350, height: 760 }],
  ['r5-state-order-lifecycle.drawio', [orderStateDiagram()], { width: 1000, height: 880 }],
  ['r6-state-escrow-lifecycle.drawio', [escrowStateDiagram()], { width: 1050, height: 400 }],
  ['r7-screen-navigation.drawio', [navigationDiagram()], { width: 1400, height: 840 }],
  ['r8-cicd-pipeline.drawio', [cicdDiagram()], { width: 1280, height: 900 }],
];

fs.mkdirSync(OUT, { recursive: true });

let written = 0;
let skipped = 0;
for (const [name, sheets, size] of FILES) {
  const target = path.join(OUT, name);
  if (ONLY.length > 0 && !ONLY.some((frag) => name.includes(frag))) {
    skipped += 1;
    continue;
  }
  if (fs.existsSync(target) && !FORCE) {
    console.log(`  bỏ qua  ${name}  (đã có, dùng --force để ghi đè)`);
    skipped += 1;
    continue;
  }
  fs.writeFileSync(target, buildFile(sheets, size), 'utf8');
  console.log(`  ghi     ${name}`);
  written += 1;
}

console.log(
  `\n${written} file mới, ${skipped} file giữ nguyên. Thư mục: ${path.relative(ROOT, OUT)}`,
);
