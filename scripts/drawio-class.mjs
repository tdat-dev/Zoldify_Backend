#!/usr/bin/env node
/**
 * Sinh 08-class-diagram.drawio theo ký pháp UML 2.5 (mẫu uml-diagrams.org):
 *
 *   1. Domain Model   : 21 entity thật trong src/**\/entities, thuộc tính `tên: Kiểu`,
 *                       {id} / {unique} / [0..1], multiplicity ở hai đầu, hợp thành
 *                       (thoi đặc) khi con không sống được thiếu cha.
 *   2. Enumerations   : các enum mà cột entity dùng.
 *   3. Money Services : tầng service giữ luật tiền, có phương thức và phụ thuộc «use».
 *
 * Mọi đường nối là đoạn ngang/dọc đặt toạ độ tay; script tự kiểm không có đường
 * nào cắt nhau hay đi xuyên qua lớp khác trước khi ghi file.
 *
 *   node scripts/drawio-class.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { page, cls, link, check, frame, writePages } from './drawio-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '08-class-diagram.drawio');

const W = 230;
const C = [40, 330, 620, 910, 1200, 1490]; // column x, 60px gutters for routing

// =============================================================== page 1: domain model
const dm = page('Domain Model');
cls(dm, 'User', { x: C[1], y: 80, name: 'User', attrs: ['id: Integer {id}', 'full_name: String', 'email: String {unique}', 'password: String', 'phone_number: String [0..1]', 'role: UserRole', 'email_verified: Boolean', 'is_locked: Boolean', 'token_version: Integer'] });
cls(dm, 'Address', { x: C[0], y: 80, name: 'Address', attrs: ['id: Integer {id}', 'recipient_name: String', 'phone_number: String', 'province: String', 'district: String', 'ward: String [0..1]', 'street: String', 'ghn_district_id: Integer [0..1]', 'ghn_ward_code: String [0..1]', 'is_default: Boolean'] });
cls(dm, 'Shop', { x: C[0], y: 330, name: 'Shop', attrs: ['id: Integer {id}', 'name: String', 'slug: String {unique}', 'description: String [0..1]', 'pickup_address: String [0..1]', 'pickup_district_id: Integer [0..1]', 'status: ShopStatus'] });
cls(dm, 'Product', { x: C[2], y: 80, name: 'Product', attrs: ['id: Integer {id}', 'name: String', 'slug: String [0..1] {unique}', 'price: Decimal', 'currency: String', 'stock: Integer', 'condition: String', 'status: ProductStatus', 'sold_count: Integer'] });
cls(dm, 'Category', { x: C[3], y: 80, name: 'Category', attrs: ['id: Integer {id}', 'name: String {unique}', 'slug: String [0..1] {unique}', 'is_active: Boolean'] });
cls(dm, 'Review', { x: C[3], y: 220, name: 'Review', attrs: ['id: Integer {id}', 'user: User', 'order: Order [0..1]', 'rating: Integer', 'comment: String [0..1]', 'images: String [*]'] });
cls(dm, 'Cart', { x: C[3], y: 410, name: 'Cart', attrs: ['id: Integer {id}', 'user: User', 'quantity: Integer'] });
cls(dm, 'Order', { x: C[1], y: 400, name: 'Order', attrs: ['id: Integer {id}', 'order_code: String {unique}', 'total_amount: Decimal', 'shipping_fee: Decimal', 'final_amount: Decimal', 'status: OrderStatus', 'payment_method: PaymentMethod', 'is_paid: Boolean', 'paid_at: DateTime [0..1]', 'shipping_address: String'] });
cls(dm, 'OrderItem', { x: C[2], y: 400, name: 'OrderItem', attrs: ['id: Integer {id}', 'product_name: String', 'price: Decimal', 'quantity: Integer', 'subtotal: Decimal'] });
cls(dm, 'OrderShipment', { x: C[2], y: 560, name: 'OrderShipment', attrs: ['id: Integer {id}', 'seller: User', 'tracking_code: String [0..1]', 'cod_amount: Decimal', 'status: ShipmentStatus', 'delivered_at: DateTime [0..1]'] });
cls(dm, 'Payment', { x: C[0], y: 540, name: 'Payment', attrs: ['id: Integer {id}', 'user: User', 'amount: Decimal', 'payment_method: PaymentMethod', 'type: PaymentType', 'status: PaymentStatus', 'payos_order_code: String [0..1]', 'paid_at: DateTime [0..1]'] });
cls(dm, 'Escrow', { x: C[1], y: 700, name: 'Escrow', attrs: ['id: Integer {id}', 'buyer: User', 'seller: User', 'amount: Decimal', 'status: EscrowStatus', 'released_at: DateTime [0..1]'] });
cls(dm, 'Withdrawal', { x: C[3], y: 740, name: 'Withdrawal', attrs: ['id: Integer {id}', 'user: User', 'approved_by: User [0..1]', 'amount: Decimal', 'bank_name: String', 'bank_account: String', 'status: WithdrawalStatus', 'processed_at: DateTime [0..1]'] });
cls(dm, 'Wallet', { x: C[4], y: 740, name: 'Wallet', attrs: ['id: Integer {id}', 'user: User', 'balance: Decimal'] });
cls(dm, 'WalletTransaction', { x: C[5], y: 740, name: 'WalletTransaction', attrs: ['id: Integer {id}', 'type: TransactionType', 'amount: Decimal', 'balance_before: Decimal', 'balance_after: Decimal', 'reference: String [0..1]'] });
cls(dm, 'LedgerTransaction', { x: C[3], y: 560, name: 'LedgerTransaction', attrs: ['id: BigInt {id}', 'type: LedgerTxType', 'idempotency_key: String {unique}', 'reference_type: String [0..1]', 'reference_id: String [0..1]'] });
cls(dm, 'LedgerEntry', { x: C[4], y: 560, name: 'LedgerEntry', attrs: ['id: BigInt {id}', 'amount: BigInt', 'balance_after: BigInt'] });
cls(dm, 'LedgerAccount', { x: C[5], y: 560, name: 'LedgerAccount', attrs: ['id: BigInt {id}', 'owner_type: LedgerOwnerType', 'owner_id: String [0..1]', 'purpose: LedgerPurpose', 'balance: BigInt', 'version: Integer'] });
cls(dm, 'Conversation', { x: C[4], y: 80, name: 'Conversation', attrs: ['id: Integer {id}', 'buyer: User', 'seller: User', 'product: Product [0..1]'] });
cls(dm, 'Message', { x: C[5], y: 80, name: 'Message', attrs: ['id: Integer {id}', 'sender: User', 'content: String', 'images: String [*]', 'is_read: Boolean'] });
cls(dm, 'Notification', { x: C[4], y: 240, name: 'Notification', attrs: ['id: Integer {id}', 'user: User', 'type: NotificationType', 'title: String', 'content: String', 'is_read: Boolean'] });

const R = (k) => dm.boxes[k].x + dm.boxes[k].w, Lx = (k) => dm.boxes[k].x;
const T = (k) => dm.boxes[k].y, B = (k) => dm.boxes[k].y + dm.boxes[k].h;
const CX = (k) => dm.boxes[k].x + dm.boxes[k].w / 2;

link(dm, 'comp', 'User', 'Address', [[Lx('User'), 150], [R('Address'), 150]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'User', 'Shop', [[Lx('User'), 250], [300, 250], [300, 411], [R('Shop'), 411]], { ma: '1', mb: '0..1' });
link(dm, 'assoc', 'User', 'Product', [[R('User'), 150], [Lx('Product'), 150]], { ma: ['1', 'seller'], mb: '0..*' });
link(dm, 'assoc', 'Category', 'Product', [[Lx('Category'), 134], [R('Product'), 134]], { ma: '0..1', mb: '0..*' });
link(dm, 'assoc', 'Product', 'Review', [[R('Product'), 240], [Lx('Review'), 240]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'Product', 'Cart', [[R('Product'), 265], [880, 265], [880, 455], [Lx('Cart'), 455]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'User', 'Order', [[CX('User'), B('User')], [CX('User'), T('Order')]], { ma: ['1', 'buyer'], mb: '0..*' });
link(dm, 'comp', 'Order', 'OrderItem', [[R('Order'), 450], [Lx('OrderItem'), 450]], { ma: '1', mb: '1..*' });
link(dm, 'assoc', 'OrderItem', 'Product', [[CX('OrderItem'), T('OrderItem')], [CX('OrderItem'), B('Product')]], { ma: '0..*', mb: '0..1' });
link(dm, 'comp', 'Order', 'OrderShipment', [[R('Order'), 590], [Lx('OrderShipment'), 590]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'Order', 'Payment', [[Lx('Order'), 590], [R('Payment'), 590]], { ma: '0..1', mb: '0..*' });
link(dm, 'assoc', 'Order', 'Escrow', [[CX('Order'), B('Order')], [CX('Order'), T('Escrow')]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'Wallet', 'WalletTransaction', [[R('Wallet'), 790], [Lx('WalletTransaction'), 790]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'LedgerTransaction', 'LedgerEntry', [[R('LedgerTransaction'), 610], [Lx('LedgerEntry'), 610]], { ma: '1', mb: '2..*' });
link(dm, 'assoc', 'LedgerAccount', 'LedgerEntry', [[Lx('LedgerAccount'), 610], [R('LedgerEntry'), 610]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'Conversation', 'Message', [[R('Conversation'), 120], [Lx('Message'), 120]], { ma: '1', mb: '0..*' });
check(dm);
frame(dm, 'class Zoldify Domain Model');

// =============================================================== page 2: enumerations
const en = page('Enumerations');
const enums = [
  ['UserRole', ['buyer', 'seller', 'admin', 'moderator']],
  ['ShopStatus', ['active', 'inactive', 'banned']],
  ['ProductStatus', ['DRAFT', 'PENDING', 'ACTIVE', 'SOLD', 'REJECTED']],
  ['OrderStatus', ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'REFUNDED']],
  ['ShipmentStatus', ['CREATED', 'FAILED', 'DELIVERED', 'RECEIVED']],
  ['PaymentMethod', ['cod', 'bank_transfer', 'wallet', 'momo', 'vnpay', 'payos']],
  ['PaymentStatus', ['pending', 'success', 'failed']],
  ['PaymentType', ['order_payment', 'wallet_topup']],
  ['EscrowStatus', ['HOLDING', 'RELEASED', 'REFUNDED', 'CANCELLED']],
  ['WithdrawalStatus', ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']],
  ['TransactionType', ['TOPUP', 'PAYMENT', 'REFUND', 'WITHDRAWAL']],
  ['LedgerOwnerType', ['user', 'platform', 'external']],
  ['LedgerPurpose', ['AVAILABLE', 'ESCROW_HOLD', 'WITHDRAWAL_PENDING', 'REVENUE', 'GATEWAY_CLEARING', 'BANK_EXTERNAL']],
  ['LedgerTxType', ['TOPUP', 'ORDER_HOLD', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'WITHDRAWAL_APPROVE', 'WITHDRAWAL_COMPLETE', 'ADJUSTMENT']],
  ['NotificationType', ['ORDER_STATUS', 'REVIEW', 'PAYMENT', 'SYSTEM', 'MESSAGE', 'NEW_PRODUCT']],
];
const ENUM_W = 190, ENUM_GAP = 30, PER_ROW = 5;
let rowY = 80;
for (let i = 0; i < enums.length; i += PER_ROW) {
  const row = enums.slice(i, i + PER_ROW);
  const hs = row.map(([name, lits], k) => cls(en, name, { x: 40 + k * (ENUM_W + ENUM_GAP), y: rowY, w: ENUM_W, name, stereo: 'enumeration', attrs: lits }).h);
  rowY += Math.max(...hs) + 40;
}
check(en);
frame(en, 'class Zoldify Enumerations');

// =============================================================== page 3: money services
const sv = page('Money Services');
const SW = 370, SC = [70, 500, 930, 1360];
cls(sv, 'OrdersService', { x: SC[1], y: 80, w: SW, name: 'OrdersService', stereo: 'service', ops: ['+ create(dto: CreateOrderDto, user: IUser): Order', '+ updateStatus(id: Integer, dto: UpdateOrderDto, user: IUser): Order', '+ confirmShipmentReceived(orderId, sellerId, user)', '+ autoConfirmDueShipments(): {due, released}', '+ cancel(id: Integer, user: IUser): Order', '+ cancelExpired(orderId: Integer)'] });
cls(sv, 'WithdrawalsService', { x: SC[3], y: 80, w: SW, name: 'WithdrawalsService', stereo: 'service', ops: ['+ create(userId: Integer, dto): Withdrawal', '+ approve(id: Integer, adminId: Integer)', '+ reject(id: Integer, adminId: Integer, note?: String)', '+ complete(id: Integer, adminId: Integer)'] });
cls(sv, 'GhnService', { x: SC[0], y: 340, w: SW, name: 'GhnService', stereo: 'service', ops: ['+ calculateFee(dto): Integer', '+ createOrder(dto): GhnOrder', '+ getOrderStatus(orderCode: String): String [0..1]'] });
cls(sv, 'PayosService', { x: SC[1], y: 340, w: SW, name: 'PayosService', stereo: 'service', ops: ['+ createOrderPaymentLink(orderId, userId)', '+ createWalletTopupLink(amount, userId)', '+ handleWebhook(rawBody)', '+ refreshOrderStatus(orderId, userId)', '+ voidOpenLinkForOrder(orderId): Boolean'] });
cls(sv, 'EscrowsService', { x: SC[2], y: 340, w: SW, name: 'EscrowsService', stereo: 'service', ops: ['+ createOrderEscrows(orderId, manager?)', '+ release(orderId: Integer, sellerId?: Integer)', '+ refund(orderId: Integer, manager?)', '+ getHeldBalance(sellerId: Integer): Decimal'] });
cls(sv, 'NotificationsService', { x: SC[0], y: 600, w: SW, name: 'NotificationsService', stereo: 'service', ops: ['+ create(dto: CreateNotificationDto): Notification', '+ registerToken(user, token, platform?)', '+ markAsRead(id: Integer, user: IUser)'] });
cls(sv, 'LedgerService', { x: SC[2], y: 600, w: SW, name: 'LedgerService', stereo: 'service', ops: ['+ post(input: PostLedgerTxInput, manager?): LedgerTransaction', '+ getOrCreateAccount(ownerType, ownerId, purpose): LedgerAccount', '+ getBalance(ownerType, ownerId, purpose): BigInt'] });
cls(sv, 'PlatformFeeService', { x: SC[3], y: 600, w: SW, name: 'PlatformFeeService', stereo: 'service', ops: ['+ getPercent(manager?): Decimal', '+ computeFee(amount: BigInt, percent: Decimal): BigInt'] });

const sb = sv.boxes;
const sR = (k) => sb[k].x + sb[k].w, sL = (k) => sb[k].x, sT = (k) => sb[k].y, sB = (k) => sb[k].y + sb[k].h, sX = (k) => sb[k].x + sb[k].w / 2;
const U = { label: '«use»' };
// OrdersService fans out: left to GHN and notifications, down to PayOS, right to escrows
link(sv, 'use', 'OrdersService', 'NotificationsService', [[sL('OrdersService'), 120], [40, 120], [40, sT('NotificationsService') + 40], [sL('NotificationsService'), sT('NotificationsService') + 40]], U);
link(sv, 'use', 'OrdersService', 'GhnService', [[sL('OrdersService'), 160], [sX('GhnService'), 160], [sX('GhnService'), sT('GhnService')]], U);
link(sv, 'use', 'OrdersService', 'PayosService', [[sX('OrdersService'), sB('OrdersService')], [sX('OrdersService'), sT('PayosService')]], U);
link(sv, 'use', 'OrdersService', 'EscrowsService', [[sR('OrdersService'), 160], [sX('EscrowsService'), 160], [sX('EscrowsService'), sT('EscrowsService')]], U);
link(sv, 'use', 'PayosService', 'EscrowsService', [[sR('PayosService'), 400], [sL('EscrowsService'), 400]], U);
link(sv, 'use', 'PayosService', 'NotificationsService', [[sX('PayosService') - 60, sB('PayosService')], [sX('PayosService') - 60, sT('NotificationsService') + 60], [sR('NotificationsService'), sT('NotificationsService') + 60]], U);
link(sv, 'use', 'PayosService', 'LedgerService', [[sX('PayosService') + 60, sB('PayosService')], [sX('PayosService') + 60, sT('LedgerService') + 60], [sL('LedgerService'), sT('LedgerService') + 60]], U);
link(sv, 'use', 'EscrowsService', 'LedgerService', [[sX('EscrowsService'), sB('EscrowsService')], [sX('EscrowsService'), sT('LedgerService')]], U);
link(sv, 'use', 'EscrowsService', 'PlatformFeeService', [[sR('EscrowsService'), 400], [sX('PlatformFeeService'), 400], [sX('PlatformFeeService'), sT('PlatformFeeService')]], U);
const lowY = Math.max(sB('LedgerService'), sB('PlatformFeeService')) + 40;
link(sv, 'use', 'WithdrawalsService', 'LedgerService', [[sR('WithdrawalsService'), 120], [sR('WithdrawalsService') + 30, 120], [sR('WithdrawalsService') + 30, lowY], [sX('LedgerService'), lowY], [sX('LedgerService'), sB('LedgerService')]], U);
check(sv);
frame(sv, 'class Zoldify Money Services');

// =============================================================== write
writePages(OUT, [dm, en, sv]);
