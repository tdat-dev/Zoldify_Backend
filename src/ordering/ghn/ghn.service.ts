import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GhnService {
  private readonly baseUrl: string;
  private readonly masterDataUrl: string;
  private readonly token: string;
  private readonly shopId: number;
  private readonly fromDistrictId: number;

  // Danh mục tỉnh/quận/phường của GHN gần như không đổi, cache lại để khỏi gọi
  // GHN mỗi lần khách mở ô chọn địa chỉ. TTL 24h là dư an toàn.
  private readonly cache = new Map<string, { data: unknown; exp: number }>();
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl =
      process.env.GHN_HOST ||
      'https://dev-online-gateway.ghn.vn/shiip/public-api/v2';
    // master-data nằm CÙNG cấp với v2, không nằm trong nó:
    //   .../shiip/public-api/v2            -> đơn hàng, phí
    //   .../shiip/public-api/master-data   -> tỉnh/quận/phường
    this.masterDataUrl = this.baseUrl.replace(/\/v2\/?$/, '') + '/master-data';
    this.token = process.env.GHN_TOKEN || '';
    this.shopId = parseInt(process.env.GHN_SHOP_ID || '0');
    this.fromDistrictId = parseInt(process.env.GHN_FROM_DISTRICT_ID || '0');
  }

  // Header ShopId luôn là một shop GHN đã đăng ký dưới tài khoản của sàn (ngữ
  // cảnh tài khoản/đối soát của GHN). Địa chỉ NGƯỜI GỬI thật của từng người bán
  // đi qua các trường from_* trong body createOrder, không qua header — nên
  // shopId mặc định là shop nền tảng trong env.
  private getHeaders(shopId?: number) {
    return {
      Token: this.token,
      ShopId: shopId ?? this.shopId,
      'Content-Type': 'application/json',
    };
  }

  private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data as T;
    const data = await fetcher();
    this.cache.set(key, { data, exp: Date.now() + GhnService.CACHE_TTL_MS });
    return data;
  }

  /** Danh sách tỉnh/thành. */
  async getProvinces() {
    return this.cached('provinces', async () => {
      const res = await firstValueFrom(
        this.httpService.get(`${this.masterDataUrl}/province`, {
          headers: this.getHeaders(),
        }),
      );
      return res.data.data;
    });
  }

  /** Danh sách quận/huyện theo tỉnh. */
  async getDistricts(provinceId: number) {
    return this.cached(`districts:${provinceId}`, async () => {
      const res = await firstValueFrom(
        this.httpService.post(
          `${this.masterDataUrl}/district`,
          { province_id: provinceId },
          { headers: this.getHeaders() },
        ),
      );
      return res.data.data;
    });
  }

  /** Danh sách phường/xã theo quận. */
  async getWards(districtId: number) {
    return this.cached(`wards:${districtId}`, async () => {
      const res = await firstValueFrom(
        this.httpService.post(
          `${this.masterDataUrl}/ward`,
          { district_id: districtId },
          { headers: this.getHeaders() },
        ),
      );
      return res.data.data;
    });
  }

  async getAvailableServices(toDistrictId: number, fromDistrictId?: number) {
    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/available-services`,
        {
          shop_id: this.shopId,
          from_district: fromDistrictId ?? this.fromDistrictId,
          to_district: toDistrictId,
        },
        { headers: this.getHeaders() },
      ),
    );
    return res.data.data;
  }

  async calculateFee(dto: {
    to_district_id: number;
    to_ward_code: string;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
    insurance_value?: number;
    // Quận người GỬI. Mặc định là điểm gửi của sàn trong env; truyền vào để
    // tính phí theo địa chỉ lấy hàng của từng người bán (C2C).
    from_district_id?: number;
  }) {
    const fromDistrictId = dto.from_district_id ?? this.fromDistrictId;
    const services = await this.getAvailableServices(
      dto.to_district_id,
      fromDistrictId,
    );
    const defaultService = services.find((s) => s.service_type_id === 2);
    if (!defaultService) throw new Error('Không tìm thấy dịch vụ vận chuyển');

    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/fee`,
        {
          from_district_id: fromDistrictId,
          to_district_id: dto.to_district_id,
          to_ward_code: dto.to_ward_code,
          service_id: defaultService.service_id,
          weight: dto.weight,
          length: dto.length || 20,
          width: dto.width || 20,
          height: dto.height || 10,
          insurance_value: dto.insurance_value || 0,
        },
        { headers: this.getHeaders() },
      ),
    );
    return res.data.data;
  }

  async createOrder(dto: {
    to_name: string;
    to_phone: string;
    to_address: string;
    to_ward_code: string;
    to_district_id: number;
    weight: number;
    cod_amount: number;
    items: Array<{
      name: string;
      quantity: number;
      weight: number;
      price: number;
    }>;
    // Địa chỉ NGƯỜI GỬI (pickup của người bán). GHN nhận theo TÊN tỉnh/quận/
    // phường. Thiếu thì GHN tự lấy địa chỉ của shop nền tảng (header ShopId) —
    // đúng hành vi fallback ta muốn khi người bán chưa khai pickup.
    from?: {
      shop_id?: number;
      name: string;
      phone: string;
      address: string;
      ward_name: string;
      district_name: string;
      province_name: string;
    };
  }) {
    const totalWeight =
      dto.weight || dto.items.reduce((s, i) => s + i.weight * i.quantity, 0);
    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/create`,
        {
          to_name: dto.to_name,
          to_phone: dto.to_phone,
          to_address: dto.to_address,
          to_ward_code: dto.to_ward_code,
          to_district_id: dto.to_district_id,
          ...(dto.from
            ? {
                from_name: dto.from.name,
                from_phone: dto.from.phone,
                from_address: dto.from.address,
                from_ward_name: dto.from.ward_name,
                from_district_name: dto.from.district_name,
                from_province_name: dto.from.province_name,
              }
            : {}),
          weight: totalWeight,
          length: 20,
          width: 20,
          height: 10,
          cod_amount: dto.cod_amount,
          service_type_id: 2,
          payment_type_id: 2,
          required_note: 'KHONGCHOXEMHANG',
          items: dto.items,
        },
        { headers: this.getHeaders(dto.from?.shop_id) },
      ),
    );
    return res.data.data;
  }
}
