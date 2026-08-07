import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GhnService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly shopId: number;
  private readonly fromDistrictId: number;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl = process.env.GHN_HOST || 'https://dev-online-gateway.ghn.vn/shiip/public-api/v2';
    this.token = process.env.GHN_TOKEN || '';
    this.shopId = parseInt(process.env.GHN_SHOP_ID || '0');
    this.fromDistrictId = parseInt(process.env.GHN_FROM_DISTRICT_ID || '0');
  }

  private getHeaders() {
    return {
      'Token': this.token,
      'ShopId': this.shopId,
      'Content-Type': 'application/json',
    };
  }

  async getAvailableServices(toDistrictId: number) {
    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/available-services`,
        { shop_id: this.shopId, from_district: this.fromDistrictId, to_district: toDistrictId },
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
  }) {
    const services = await this.getAvailableServices(dto.to_district_id);
    const defaultService = services.find(s => s.service_type_id === 2);
    if (!defaultService) throw new Error('Không tìm thấy dịch vụ vận chuyển');

    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/fee`,
        {
          from_district_id: this.fromDistrictId,
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
    items: Array<{ name: string; quantity: number; weight: number; price: number }>;
  }) {
    const totalWeight = dto.weight || dto.items.reduce((s, i) => s + i.weight * i.quantity, 0);
    const res = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/shipping-order/create`,
        {
          to_name: dto.to_name,
          to_phone: dto.to_phone,
          to_address: dto.to_address,
          to_ward_code: dto.to_ward_code,
          to_district_id: dto.to_district_id,
          weight: totalWeight,
          length: 20, width: 20, height: 10,
          cod_amount: dto.cod_amount,
          service_type_id: 2,
          payment_type_id: 2,
          required_note: 'KHONGCHOXEMHANG',
          items: dto.items,
        },
        { headers: this.getHeaders() },
      ),
    );
    return res.data.data;
  }
}