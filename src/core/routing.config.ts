import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';

/**
 * Cấu hình prefix và version cho toàn bộ route.
 *
 * Dùng chung cho main.ts và script xuất openapi.json, để hợp đồng API
 * mà web/app sinh code từ đó luôn khớp với server đang chạy thật.
 *
 * Hai route được loại trừ khỏi prefix vì đường dẫn của chúng là hợp đồng
 * với bên ngoài, không phải với client của mình:
 *  - `/`            healthcheck đơn giản, giữ ở gốc cho tiện kiểm tra
 *  - `/sitemap.xml` Google yêu cầu nằm ở gốc domain, đổi là mất SEO
 *
 * Hai controller đó phải khai báo VERSION_NEUTRAL, vì loại khỏi prefix
 * không đồng nghĩa với loại khỏi version.
 */
export function configureRouting(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'sitemap.xml', method: RequestMethod.GET },
      // Sitemap giờ là bảng chỉ mục trỏ sang các file con, nên các file con
      // cũng phải ở gốc domain: chuẩn sitemap đòi file con nằm cùng thư mục
      // hoặc sâu hơn bảng chỉ mục. Nằm dưới /api thì Google từ chối cả bộ.
      //
      // Thiếu hai dòng này thì route vẫn tồn tại, chỉ là ở /api/sitemap-...,
      // và bảng chỉ mục trỏ vào chỗ trả 404. Đã dính thật lúc thêm — bài kiểm
      // đơn vị không thấy được vì nó gọi thẳng service, không qua HTTP.
      { path: 'sitemap-static.xml', method: RequestMethod.GET },
      { path: 'sitemap-products-:lo.xml', method: RequestMethod.GET },
    ],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
}
