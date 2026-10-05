/**
 * Cấu hình cache — nguồn DUY NHẤT cho cả tiến trình API lẫn tiến trình worker.
 *
 * VÌ SAO WORKER CŨNG PHẢI CÓ CACHE, TRONG KHI NÓ KHÔNG PHỤC VỤ AI.
 *
 * Không phải vì nó cần đọc nhanh. Là vì đồ thị phụ thuộc bắt nó phải có:
 * JobsModule → TasksModule → OrdersModule → ProductsModule, mà `ProductsService`
 * `@Inject(CACHE_MANAGER)`. Thiếu là Nest không dựng nổi worker và chết ngay
 * lúc khởi động với "can't resolve dependencies of the ProductsService".
 *
 * Đây là lỗi đã dính thật lúc làm task #14: bài tự kiểm 26 mục xanh hết trong
 * khi `node dist/worker` không boot nổi. Bài test lúc đó chỉ hỏi "worker.ts có
 * tồn tại không, có nạp AppModule không" — hai câu đọc mã trả lời được, và
 * không câu nào là câu "worker có dựng được không". Nay selfcheck-worker.ts
 * dựng WorkerModule thật.
 *
 * VÌ SAO DÙNG CHUNG CẤU HÌNH CHỨ KHÔNG CHO WORKER MỘT CACHE IN-MEMORY RIÊNG.
 *
 * Cache in-memory riêng thì rẻ hơn và worker vẫn boot. Nhưng lúc worker huỷ đơn
 * quá hạn, nó trả hàng về kho — tức là dữ liệu mà API đang cache có thể cũ đi.
 * Nếu sau này ai đó cho worker gọi `ProductsService` để xoá key, thì với cache
 * riêng nó sẽ xoá key trong RAM của CHÍNH NÓ, còn bản API vẫn phục vụ dữ liệu
 * cũ. Việc dọn dẹp trông như đã làm mà không có tác dụng — đúng kiểu hỏng câm.
 *
 * Trỏ cả hai vào cùng một Redis thì không có cái bẫy đó.
 */
export async function cacheConfig(): Promise<Record<string, unknown>> {
  const ttl = 60000;
  const url = process.env.REDIS_URL;
  if (!url) return { ttl };
  try {
    // Specifier qua biến: TS/nest build KHÔNG resolve tĩnh gói optional này,
    // nên máy chưa cài @keyv/redis vẫn build được (chỉ prod có REDIS_URL cần).
    //
    // `require` CHỨ KHÔNG PHẢI `await import`. Bản cũ dùng `await import(pkg)`
    // và nó làm sập app ngay lúc khởi động, mỗi khi REDIS_URL có giá trị:
    //
    //   TypeError: Cannot read properties of undefined (reading 'includes')
    //       at Keyv._checkIterableAdapter (keyv/dist/index.cjs:488)
    //       at cachingFactory (@nestjs/cache-manager/dist/cache.providers.js:35)
    //
    // Nguyên nhân là "dual-package hazard", không phải lỗi của Redis hay của
    // cấu hình. Mã này biên dịch ra CommonJS, nên `require('keyv')` mà
    // @nestjs/cache-manager dùng lấy bản keyv/dist/index.CJS. Còn `import()`
    // động luôn đi đường ESM, nên `@keyv/redis` nạp theo đường đó lại kéo bản
    // keyv/dist/index.JS. Hai bản là hai lớp KHÁC NHAU trong bộ nhớ.
    //
    // `createKeyv()` trả về một Keyv (ESM). cache-manager kiểm
    // `store instanceof Keyv` (CJS) — false, vì khác lớp — nên nó tưởng đây là
    // một store thô và bọc thêm một lớp Keyv nữa. Keyv bên trong không có
    // `.opts.dialect`, và câu `.includes` ở trên nổ.
    //
    // Cả hai cùng đi đường CJS thì `instanceof` đúng, cache-manager nhận
    // nguyên Keyv và không bọc lại. Kiểm bằng scripts/selfcheck-worker.ts:
    // nó dựng WorkerModule thật với REDIS_URL trỏ vào Redis thật.
    const pkg = '@keyv/redis';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createKeyv } = require(pkg) as {
      createKeyv: (u: string) => unknown;
    };
    return { stores: [createKeyv(url)], ttl };
  } catch (e) {
    // REDIS_URL có nhưng KHÔNG nạp được @keyv/redis (chưa cài) hoặc lỗi tạo
    // store → KHÔNG chặn boot: rơi về in-memory + cảnh báo. Fail-open ngay từ
    // lúc khởi động, đồng nhất tinh thần C3 (Redis chết không được làm sập app).
    console.warn(
      `[cache] REDIS_URL có nhưng chưa dùng được Redis (${(e as Error).message}) — tạm dùng in-memory. Cài: npm i @keyv/redis`,
    );
    return { ttl };
  }
}
