import { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

/**
 * Danh sách query param thật sự BẮT BUỘC, dạng "METHOD /đường/dẫn:tên".
 * Hiện đang rỗng: mọi tham số lọc và phân trang đều có thể bỏ trống,
 * service tự áp mặc định (`+page || 1`).
 *
 * Thêm vào đây khi nào có tham số bắt buộc thật, để việc đó là quyết định
 * có ý thức chứ không phải kết quả tình cờ của suy luận kiểu.
 */
const REQUIRED_QUERY_PARAMS = new Set<string>();

/**
 * Plugin @nestjs/swagger suy ra "bắt buộc" từ kiểu TypeScript, nên
 * `@Query('q') q: string` bị đánh dấu required dù bỏ trống vẫn chạy bình
 * thường. Không sửa thì client sinh từ spec sẽ bắt lập trình viên truyền
 * đủ 8 bộ lọc mới gọi được danh sách sản phẩm.
 *
 * Sửa ở một chỗ duy nhất thay vì rải 57 decorator ApiQuery khắp 16
 * controller, và không đụng gì tới kiểu TypeScript nên không đổi hành vi.
 */
export function markQueryParamsOptional(
  document: OpenAPIObject,
): OpenAPIObject {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      const params = (operation as { parameters?: unknown[] })?.parameters;
      if (!Array.isArray(params)) continue;

      for (const param of params as {
        in?: string;
        name?: string;
        required?: boolean;
      }[]) {
        if (param.in !== 'query') continue;
        const key = `${method.toUpperCase()} ${path}:${param.name}`;
        param.required = REQUIRED_QUERY_PARAMS.has(key);
      }
    }
  }
  return document;
}

/**
 * Hợp đồng API của Zoldify.
 *
 * Web và app mobile đều sinh client từ file openapi.json xuất ra từ đây,
 * nên mọi thay đổi ở tầng DTO sẽ tự động lan sang cả hai.
 *
 * Lưu ý về v1: một khi app đã lên store thì v1 bị đóng băng. Chỉ được
 * THÊM field tuỳ chọn. Cấm đổi tên, cấm xoá, cấm đổi kiểu — vì app cũ
 * trên máy người dùng vẫn gọi vào đây hàng tháng sau đó.
 */
/**
 * TransformInterceptor bọc MỌI response trong { statusCode, message, data }.
 * Plugin swagger không biết chuyện đó nên nó mô tả phần ruột bên trong —
 * tức spec đang nói sai hình dạng dữ liệu thật.
 *
 * Hàm này bọc lại schema 2xx cho đúng. Endpoint nào chưa khai báo kiểu trả
 * về thì `data` để trống, nghĩa là "biết chắc có vỏ bọc, chưa mô tả ruột" —
 * vẫn đúng, chỉ là chưa đầy đủ.
 *
 * Bỏ qua các route không nằm dưới /api (như `/` và `/sitemap.xml`) vì
 * chúng không đi qua interceptor theo cùng cách.
 */
export function wrapResponsesInEnvelope(
  document: OpenAPIObject,
): OpenAPIObject {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.startsWith('/api/')) continue;

    for (const operation of Object.values(pathItem)) {
      const responses = (operation as { responses?: Record<string, any> })
        ?.responses;
      if (!responses) continue;

      // NestJS ghi mặc định 201 cho POST, còn decorator ApiOkResponse lại
      // khai 200. Kết quả là một endpoint có hai mục 2xx mà chỉ một mục có
      // kiểu, client sinh code đọc nhầm mục trống rồi mất kiểu. Lấy schema
      // đã khai được ở bất kỳ mục 2xx nào rồi dùng chung cho mọi mục 2xx.
      const declared = Object.entries(responses).find(
        ([status, r]) =>
          /^2\d\d$/.test(status) && r?.content?.['application/json']?.schema,
      );
      const declaredSchema = declared?.[1]?.content?.['application/json']
        ?.schema as unknown;

      for (const [status, response] of Object.entries(responses)) {
        if (!/^2\d\d$/.test(status)) continue;

        const inner =
          response?.content?.['application/json']?.schema ?? declaredSchema;

        response.content = {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: { type: 'integer', example: Number(status) },
                message: { type: 'string' },
                // Chưa khai báo kiểu trả về thì để trống thay vì bịa
                data: inner ?? {},
              },
              required: ['statusCode', 'data'],
            },
          },
        };
      }
    }
  }
  return document;
}

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Zoldify API')
  .setDescription(
    'API của sàn mua bán đồ cũ Zoldify. Web (Next.js) và app (React Native) ' +
      'dùng chung hợp đồng này.',
  )
  .setVersion('1.0')
  .addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    'access-token',
  )
  .addServer(process.env.API_PUBLIC_URL || 'http://localhost:3000', 'Server')
  .build();
