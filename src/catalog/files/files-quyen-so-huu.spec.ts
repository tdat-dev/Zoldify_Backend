import { NotFoundException } from '@nestjs/common';
import type { IUser } from '@identity/users/users.interface';
import { FilesService } from './files.service';

/**
 * IDOR ở /files: chỉ có JwtAuthGuard, không kiểm chủ.
 *
 *   GET    /files       liệt kê file của MỌI người (tên gốc, URL, thư mục).
 *   GET    /files/:id   đọc bản ghi file kèm uploaded_by là nguyên dòng users
 *                       của người tải (email, số điện thoại, vai trò...).
 *   DELETE /files/:id   xoá bản ghi file của bất kỳ ai.
 * id tăng dần nên quét được hết. Không client nào gọi ba route này (kiểm
 * 25/10: web, admin, app chỉ gọi POST /files/upload), nên siết lại không làm
 * vỡ luồng nào.
 *
 * Người lạ nhận 404 như file không tồn tại.
 */
type DichVuCoQuyen = {
  findAll(
    page: number,
    limit: number,
    folder: string | undefined,
    user: IUser,
  ): Promise<unknown>;
  findOne(id: number, user: IUser): Promise<Record<string, unknown>>;
  remove(id: number, user: IUser): Promise<unknown>;
};

const CHU = { id: 2, role: 'buyer' } as IUser;
const LA = { id: 9, role: 'buyer' } as IUser;
const ADMIN = { id: 1, role: 'admin' } as IUser;

function dung() {
  const banGhi = {
    id: 50,
    url: 'https://img/a.jpg',
    uploaded_by: {
      id: CHU.id,
      full_name: 'Chủ file',
      email: 'chu@gmail.com',
      phone_number: '0901234567',
      role: 'buyer',
      token_version: 4,
    },
  };
  const dieuKienLietKe: unknown[] = [];
  const fileRepository = {
    findOne: jest.fn(() => Promise.resolve(banGhi)),
    findAndCount: jest.fn((o: { where: unknown }) => {
      dieuKienLietKe.push(o.where);
      return Promise.resolve([[], 0]);
    }),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const svc = new FilesService(
    fileRepository as never,
  ) as unknown as DichVuCoQuyen;
  return { svc, fileRepository, dieuKienLietKe };
}

describe('/files chỉ cho chủ file hoặc admin', () => {
  it('người thường chỉ liệt kê được file của mình', async () => {
    const { svc, dieuKienLietKe } = dung();
    await svc.findAll(1, 20, undefined, LA);
    expect(dieuKienLietKe[0]).toEqual(
      expect.objectContaining({ uploaded_by: { id: LA.id } }),
    );
  });

  it('người lạ đọc file của người khác nhận 404', async () => {
    const { svc } = dung();
    await expect(svc.findOne(50, LA)).rejects.toThrow(NotFoundException);
  });

  it('chủ file đọc được, uploaded_by chỉ còn id và full_name', async () => {
    const { svc } = dung();
    const f = await svc.findOne(50, CHU);
    expect(Object.keys(f.uploaded_by as object).sort()).toEqual([
      'full_name',
      'id',
    ]);
  });

  it('người lạ xoá file của người khác nhận 404, không xoá gì', async () => {
    const { svc, fileRepository } = dung();
    await expect(svc.remove(50, LA)).rejects.toThrow(NotFoundException);
    expect(fileRepository.delete).not.toHaveBeenCalled();
  });

  it('admin xoá được file của người khác', async () => {
    const { svc, fileRepository } = dung();
    await svc.remove(50, ADMIN);
    expect(fileRepository.delete).toHaveBeenCalledWith(50);
  });
});
