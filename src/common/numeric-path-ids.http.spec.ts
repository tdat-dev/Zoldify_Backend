import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CanActivate,
  INestApplication,
  ParseIntPipe,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '@core/http-exception.filter';
import { DatabaseExceptionFilter } from '@core/db-exception.filter';
import { TransformInterceptor } from '@core/transform.interceptor';

/**
 * ID SAI DẠNG TRÊN ĐƯỜNG DẪN PHẢI RA 400, KHÔNG ĐƯỢC RA 500 — GỌI HTTP THẬT.
 *
 * `numeric-path-ids.spec.ts` (issue #42) đọc mã nguồn và đòi mọi `@Param('…id')`
 * có `ParseIntPipe`. Nó chặn đúng dạng lỗi cũ, nhưng chỉ chứng minh được "mã CÓ
 * gắn pipe", không chứng minh được "/cart/abc ra 400". Bài này đi đường HTTP:
 * dựng từng controller với service giả, gắn đúng pipe/filter/interceptor toàn
 * cục như `main.ts`, rồi gọi mọi route có tham số kiểu id bằng `abc`.
 *
 * Tham số được coi là id khi tên kết thúc bằng `id`/`Id`, HOẶC đã gắn
 * `ParseIntPipe` dù tên khác (như `:code`). Route nào thiếu pipe thì handler
 * chạy với service giả và trả mã khác 400 — bài đỏ, kèm tên route.
 *
 * Service giả trả `null` cho mọi lời gọi; guard được thay bằng guard cho qua
 * và gắn sẵn `req.user`. Nghĩa là bài chỉ đo tầng HTTP (pipe → filter → mã
 * trả về), không đo quyền — quyền đã có bài riêng ở từng module.
 */

type Lop = new (...args: never[]) => object;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

function laController(x: unknown): x is Lop {
  return (
    typeof x === 'function' &&
    Reflect.getMetadata(PATH_METADATA, x) !== undefined &&
    Reflect.getMetadataKeys(x).includes('__controller__')
  );
}

interface Tuyen {
  phuongThuc: RequestMethod;
  duongDan: string;
  thamSoId: string[];
}

const TEN_PHUONG_THUC: Partial<
  Record<RequestMethod, 'get' | 'post' | 'put' | 'patch' | 'delete'>
> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

function noi(...phan: string[]): string {
  return (
    '/' +
    phan
      .flatMap((p) => p.split('/'))
      .filter(Boolean)
      .join('/')
  );
}

/** Mọi route của controller có ít nhất một tham số kiểu id trên đường dẫn. */
function tuyenCoId(C: Lop): Tuyen[] {
  const goc = [
    Reflect.getMetadata(PATH_METADATA, C) as string | string[],
  ].flat();
  const ra: Tuyen[] = [];
  for (const ten of Object.getOwnPropertyNames(C.prototype)) {
    const ham = (C.prototype as Record<string, unknown>)[ten];
    if (typeof ham !== 'function' || ten === 'constructor') continue;
    const duong = Reflect.getMetadata(PATH_METADATA, ham) as
      | string
      | string[]
      | undefined;
    const pt = Reflect.getMetadata(METHOD_METADATA, ham) as
      | RequestMethod
      | undefined;
    if (duong === undefined || pt === undefined || !TEN_PHUONG_THUC[pt])
      continue;

    // Tham số gắn ParseIntPipe của hàm này. Nest lưu metadata đối số theo
    // (lớp, tên hàm), khoá bên trong là "loại:chỉ-số".
    const coPipe = new Set<string>();
    const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, C, ten) ??
      {}) as Record<string, { data?: unknown; pipes?: unknown[] }>;
    for (const v of Object.values(meta)) {
      const coParseInt = (v.pipes ?? []).some(
        (p) => p === ParseIntPipe || p instanceof ParseIntPipe,
      );
      if (coParseInt && typeof v.data === 'string') coPipe.add(v.data);
    }

    for (const g of goc) {
      for (const d of [duong].flat()) {
        const full = noi(g, d);
        const thamSo = [...full.matchAll(/:(\w+)/g)].map((m) => m[1]);
        const thamSoId = thamSo.filter(
          (t) => /(id|Id)$/.test(t) || coPipe.has(t),
        );
        if (thamSoId.length)
          ra.push({ phuongThuc: pt, duongDan: full, thamSoId });
      }
    }
  }
  return ra;
}

/** Guard nào được khai ở controller hoặc ở hàm thì thay bằng guard cho qua. */
function cacGuard(C: Lop): Lop[] {
  const tap = new Set<Lop>();
  const them = (x: unknown) => {
    for (const g of (Reflect.getMetadata(GUARDS_METADATA, x as object) ??
      []) as unknown[]) {
      if (typeof g === 'function') tap.add(g as Lop);
    }
  };
  them(C);
  for (const ten of Object.getOwnPropertyNames(C.prototype)) {
    const ham = (C.prototype as Record<string, unknown>)[ten];
    if (typeof ham === 'function') them(ham);
  }
  return [...tap];
}

const choQua: CanActivate = {
  canActivate: (ctx) => {
    const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
    req.user = { id: 1, sub: 1, email: 'x@x.vn', role: 'admin' };
    return true;
  },
};

/** Service giả: mọi thuộc tính là hàm trả về null. */
function gia(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, k) =>
        k === 'then' ? undefined : jest.fn().mockResolvedValue(null),
    },
  );
}

const root = join(__dirname, '..');
const dsController: { file: string; C: Lop }[] = [];
for (const file of controllerFiles(root)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file) as Record<string, unknown>;
  for (const x of Object.values(mod)) {
    if (laController(x))
      dsController.push({ file: relative(root, file), C: x });
  }
}

describe('ID sai dạng trên đường dẫn → 400 qua HTTP thật', () => {
  const coTuyen = dsController
    .map((x) => ({ ...x, tuyen: tuyenCoId(x.C) }))
    .filter((x) => x.tuyen.length > 0);

  it('tìm thấy đủ controller để bài có nghĩa', () => {
    // Chặn xanh giả: nếu cách dò metadata hỏng thì danh sách rỗng và mọi
    // `describe` phía dưới không chạy ca nào.
    expect(coTuyen.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(coTuyen.map((x) => [x.file, x] as const))(
    '%s',
    (_f, { C, tuyen }) => {
      let app: INestApplication;

      beforeAll(async () => {
        // Token `Object` là tham số tuỳ chọn không kiểu (như `options` của
        // ParseIntPipe). Mock nó thì `exceptionFactory` giả trả một Promise và
        // pipe "ném" Promise đó thành 500 — lỗi của bài, không phải của mã.
        let b = Test.createTestingModule({ controllers: [C] }).useMocker((t) =>
          t === Object ? undefined : gia(),
        );
        for (const g of cacGuard(C)) b = b.overrideGuard(g).useValue(choQua);
        const mod = await b.compile();
        app = mod.createNestApplication({ logger: false });
        app.useGlobalPipes(
          new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
          }),
        );
        app.useGlobalFilters(
          new HttpExceptionFilter(),
          new DatabaseExceptionFilter(),
        );
        app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
        await app.init();
      });

      afterAll(async () => {
        await app?.close();
      });

      it.each(
        tuyen.map(
          (t) => [`${TEN_PHUONG_THUC[t.phuongThuc]} ${t.duongDan}`, t] as const,
        ),
      )('%s', async (_ten, t) => {
        let url = t.duongDan;
        for (const ts of t.thamSoId) url = url.replace(`:${ts}`, 'abc');
        // Tham số không phải id (slug…) điền số cho hợp lệ, để chỉ đo đúng một biến.
        url = url.replace(/:\w+/g, '1');
        const res = await request(app.getHttpServer())
          [TEN_PHUONG_THUC[t.phuongThuc]!](url)
          .send({});
        expect({ url, status: res.status }).toEqual({ url, status: 400 });
      });
    },
  );
});
