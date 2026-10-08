import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CategoriesService } from './categories.service';
import type { TranslationService } from './translation.service';

/**
 * DANH MỤC — module này trước hôm nay không có bài kiểm nào.
 *
 * Thứ đáng gác nhất ở đây không phải CRUD, mà là **quan hệ với dịch vụ dịch
 * thuật bên ngoài**.
 *
 * `create()` gọi `translation.viToEn(name)` để sinh `name_en` bằng Workers AI.
 * Đó là một lời gọi mạng tới dịch vụ của bên thứ ba, nằm trên đường ghi của
 * một thao tác quản trị. Nếu nó hỏng mà kéo theo cả `create()` hỏng, thì
 * Cloudflare có sự cố là admin không thêm được danh mục — một tính năng phụ
 * (tên tiếng Anh) chặn mất một tính năng chính.
 *
 * Mã hiện tại xử đúng: dịch hỏng thì trả `null` và bỏ qua. Bài kiểm chốt lại
 * điều đó, để ai sửa sau không vô tình biến nó thành bắt buộc.
 *
 * Dùng repository giả: mọi bất biến ở đây nằm trong mã, không trong ràng buộc
 * database. Cùng quy tắc đã ghi ở `follows.service.spec.ts`.
 */
describe('CategoriesService', () => {
  function dungService(opts: {
    daCoTen?: Partial<Category> | null;
    theoId?: Partial<Category> | null;
    dichRa?: string | null;
    dichNem?: boolean;
  }) {
    const daLuu: Array<Partial<Category>> = [];
    const daCapNhat: Array<Partial<Category>> = [];
    const daXoaMem: number[] = [];
    let lanGoiDich = 0;

    const repo = {
      findOne: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'name' in where ? (opts.daCoTen ?? null) : (opts.theoId ?? null),
        ),
      save: (c: Partial<Category>) => {
        daLuu.push(c);
        return Promise.resolve({ ...c, id: 1 });
      },
      update: (_w: unknown, patch: Partial<Category>) => {
        daCapNhat.push(patch);
        return Promise.resolve({ affected: 1 });
      },
      softDelete: (id: number) => {
        daXoaMem.push(id);
        return Promise.resolve({ affected: 1 });
      },
      find: () => Promise.resolve([]),
    } as unknown as Repository<Category>;

    const translation = {
      // Không nhận tham số: bài kiểm chỉ ĐẾM số lần gọi, không quan tâm gọi
      // với tên gì — thứ đáng gác là "có gọi lại khi không đổi tên không".
      viToEn: () => {
        lanGoiDich++;
        if (opts.dichNem) return Promise.reject(new Error('Workers AI sập'));
        return Promise.resolve(opts.dichRa ?? null);
      },
    } as unknown as TranslationService;

    const service = new CategoriesService(repo, translation);
    return {
      service,
      daLuu,
      daCapNhat,
      daXoaMem,
      soLanGoiDich: () => lanGoiDich,
    };
  }

  // ── Tạo ──────────────────────────────────────────────────────────────────
  it('trùng tên thì không tạo được', async () => {
    const { service, daLuu } = dungService({ daCoTen: { id: 1 } });

    await expect(service.create({ name: 'Điện thoại' })).rejects.toThrow(
      BadRequestException,
    );
    expect(daLuu).toHaveLength(0);
  });

  it('dịch được thì lưu kèm name_en', async () => {
    const { service, daLuu } = dungService({
      daCoTen: null,
      theoId: { id: 1, name: 'Điện thoại' },
      dichRa: 'Phones',
    });

    await service.create({ name: 'Điện thoại' });
    expect(daLuu[0]).toMatchObject({ name: 'Điện thoại', name_en: 'Phones' });
  });

  it('DỊCH HỎNG VẪN TẠO ĐƯỢC danh mục, chỉ thiếu name_en', async () => {
    // Bài kiểm đáng giá nhất của file. `viToEn` là một lời gọi mạng tới
    // Cloudflare Workers AI nằm trên đường ghi của thao tác quản trị. Dịch vụ
    // đó sập mà kéo theo `create()` sập thì admin không thêm được danh mục —
    // một tính năng phụ chặn mất một tính năng chính.
    const { service, daLuu } = dungService({
      daCoTen: null,
      theoId: { id: 1, name: 'Điện thoại' },
      dichRa: null,
    });

    await service.create({ name: 'Điện thoại' });
    expect(daLuu).toHaveLength(1);
    expect(daLuu[0].name_en).toBeUndefined();
  });

  // ── Sửa ──────────────────────────────────────────────────────────────────
  it('không tìm thấy thì không sửa được', async () => {
    const { service, daCapNhat } = dungService({ theoId: null });

    await expect(service.update(99, { name: 'X' })).rejects.toThrow(
      BadRequestException,
    );
    expect(daCapNhat).toHaveLength(0);
  });

  it('KHÔNG đổi tên thì KHÔNG gọi lại dịch vụ dịch', async () => {
    // Mỗi lần gọi là một request mạng và một lần trả tiền. Sửa ảnh hay mô tả
    // mà vẫn đi dịch lại tên là trả tiền cho một câu trả lời đã biết.
    const { service, soLanGoiDich } = dungService({
      theoId: { id: 1, name: 'Điện thoại' },
    });

    await service.update(1, { image: 'moi.png' });
    expect(soLanGoiDich()).toBe(0);
  });

  it('đổi tên thì dịch lại', async () => {
    const { service, daCapNhat, soLanGoiDich } = dungService({
      theoId: { id: 1, name: 'Điện thoại' },
      dichRa: 'Laptops',
    });

    await service.update(1, { name: 'Máy tính' });
    expect(soLanGoiDich()).toBe(1);
    expect(daCapNhat[0]).toMatchObject({ name_en: 'Laptops' });
  });

  it('đặt lại ĐÚNG tên cũ thì không dịch lại', async () => {
    // `name !== isExists.name` — gửi lại y nguyên tên cũ là không có gì đổi.
    const { service, soLanGoiDich } = dungService({
      theoId: { id: 1, name: 'Điện thoại' },
    });

    await service.update(1, { name: 'Điện thoại' });
    expect(soLanGoiDich()).toBe(0);
  });

  // ── Xoá và đọc ───────────────────────────────────────────────────────────
  it('xoá là XOÁ MỀM', async () => {
    // Sản phẩm trỏ tới danh mục bằng khoá ngoại. Xoá cứng là làm mồ côi hàng
    // loạt sản phẩm đang bán.
    const { service, daXoaMem } = dungService({ theoId: { id: 1 } });

    await service.remove(1);
    expect(daXoaMem).toEqual([1]);
  });

  it('findOne không thấy thì NotFound', async () => {
    const { service } = dungService({ theoId: null });
    await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
  });

  it('findBySlug không thấy thì NotFound', async () => {
    const { service } = dungService({ theoId: null });
    await expect(service.findBySlug('khong-co')).rejects.toThrow(
      NotFoundException,
    );
  });
});
