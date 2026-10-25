import { Logger } from '@nestjs/common';
import { PayOS } from '@payos/node';
import { PayosService } from './payos.service';

/**
 * Webhook PayOS khi thiếu PAYOS_CHECKSUM_KEY.
 *
 * Constructor ép khoá thiếu thành '' rồi đưa thẳng cho SDK, và không ai biết
 * máy chủ đang chạy không có khoá. Toàn bộ chuyện "webhook giả bị từ chối" lúc
 * đó dựa vào MỘT dòng bên trong SDK: @payos/node 2.0.5 có
 * `if (!data || !key.length) return null` trong createSignatureFromObj, nên
 * chữ ký HMAC bằng khoá rỗng không khớp. Đo 25/10: ký bằng khoá '' thì SDK trả
 * null và verify ném "Data not integrity". Tức hôm nay KHÔNG giả được, nhưng
 * chỉ vì một chi tiết cài đặt của thư viện ngoài, đổi bản là mất.
 *
 * Webhook này là đường cộng tiền vào sổ. Không có khoá thì nó phải đóng, do
 * CHÍNH mã của mình quyết định, và phải la lên ngay lúc khởi động. Không được
 * làm app chết lúc boot: máy chủ thiếu khoá PayOS vẫn phải bán được đơn COD.
 */
const DATA = {
  orderCode: 123,
  amount: 500000,
  description: 'DH123',
  accountNumber: '0001',
  reference: 'FT123',
  transactionDateTime: '2026-10-25 10:00:00',
  currency: 'VND',
  paymentLinkId: 'pl-1',
  code: '00',
  desc: 'success',
  counterAccountBankId: '',
  counterAccountBankName: '',
  counterAccountName: '',
  counterAccountNumber: '',
  virtualAccountName: '',
  virtualAccountNumber: '',
};

function dung(checksumKey: string | undefined) {
  const env: Record<string, string | undefined> = {
    PAYOS_CLIENT_ID: 'client',
    PAYOS_API_KEY: 'api',
    PAYOS_CHECKSUM_KEY: checksumKey,
  };
  const transaction = jest.fn(() =>
    Promise.resolve({ processed: false, reason: 'Payment not found' }),
  );
  const service = new PayosService(
    { get: (k: string) => env[k] } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { transaction } as never,
    {} as never,
    {} as never,
  );
  return { service, transaction };
}

async function kyBang(key: string) {
  const sdk = new PayOS({ clientId: 'x', apiKey: 'x', checksumKey: key });
  return sdk.crypto.createSignatureFromObj(DATA, key);
}

describe('PayosService: webhook khi thiếu PAYOS_CHECKSUM_KEY', () => {
  afterEach(() => jest.restoreAllMocks());

  it('khởi động không có khoá thì ghi log lỗi, không ném', () => {
    const loi = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    expect(() => dung(undefined)).not.toThrow();
    expect(loi).toHaveBeenCalledWith(
      expect.stringContaining('PAYOS_CHECKSUM_KEY'),
    );
  });

  it('không có khoá thì từ chối webhook, kể cả khi SDK không tự chặn', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, transaction } = dung('');
    // Giả lập một bản SDK chấp nhận chữ ký HMAC bằng khoá rỗng: quyết định
    // đóng cửa phải nằm ở mã của mình, không ở chi tiết bên trong thư viện.
    const sdk = (service as unknown as { payos: PayOS }).payos;
    jest.spyOn(sdk.webhooks, 'verify').mockResolvedValue(DATA);

    const res = await service.handleWebhook({
      code: '00',
      desc: 'success',
      success: true,
      data: DATA,
      signature: 'bat-ky',
    });

    expect(res).toEqual(expect.objectContaining({ success: false }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it('không có khoá: chữ ký HMAC bằng khoá rỗng bị từ chối', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, transaction } = dung('');

    const res = await service.handleWebhook({
      code: '00',
      desc: 'success',
      success: true,
      data: DATA,
      signature: await kyBang(''),
    });

    expect(res).toEqual(expect.objectContaining({ success: false }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it('có khoá và chữ ký đúng thì webhook đi tiếp vào transaction', async () => {
    const { service, transaction } = dung('khoa-that');

    await service.handleWebhook({
      code: '00',
      desc: 'success',
      success: true,
      data: DATA,
      signature: await kyBang('khoa-that'),
    });

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
