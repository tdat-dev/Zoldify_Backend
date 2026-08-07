import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'RAW_RESPONSE';

/**
 * Bỏ qua lớp vỏ { statusCode, message, data } của TransformInterceptor.
 *
 * Cần cho những route trả về định dạng không phải JSON. Ví dụ sitemap.xml:
 * interceptor là global nên nó bọc cả XML vào JSON, trong khi header lại
 * khai là application/xml — Google không đọc được.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
