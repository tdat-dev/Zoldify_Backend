import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMetaDto } from '../dto/pagination.dto';

/**
 * Bộ decorator mô tả kiểu trả về cho client.
 *
 * Chỉ cần mô tả phần RUỘT. Lớp vỏ { statusCode, message, data } do
 * wrapResponsesInEnvelope trong core/swagger.config.ts tự bọc thêm, nên
 * đừng khai báo lại ở đây kẻo bọc hai lần.
 */

/** Trả về danh sách có phân trang: { meta, result: Model[] } */
export const ApiPaginated = <T extends Type<unknown>>(model: T) =>
  applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
          result: { type: 'array', items: { $ref: getSchemaPath(model) } },
        },
        required: ['meta', 'result'],
      },
    }),
  );

/** Trả về đúng một bản ghi */
export const ApiEntity = <T extends Type<unknown>>(model: T) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({ schema: { $ref: getSchemaPath(model) } }),
  );

/** Trả về một mảng không phân trang */
export const ApiEntityArray = <T extends Type<unknown>>(model: T) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: { type: 'array', items: { $ref: getSchemaPath(model) } },
    }),
  );

/**
 * Trả về một object đơn giản tự mô tả, ví dụ { count: 5 } hay
 * { balance: 120000 }. Truyền vào bản đồ tên field -> kiểu.
 */
export const ApiShape = (
  properties: Record<string, 'string' | 'number' | 'boolean'>,
) =>
  ApiOkResponse({
    schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(properties).map(([k, v]) => [
          k,
          { type: v === 'number' ? 'number' : v },
        ]),
      ),
      required: Object.keys(properties),
    },
  });
