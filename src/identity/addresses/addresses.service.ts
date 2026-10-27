import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto, UpdateAddressDto } from './dto/create-address.dto';
import { IUser } from '@identity/users/users.interface';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address)
    private readonly addressRepository: Repository<Address>,
  ) {}

  async findAll(user: IUser) {
    return this.addressRepository.find({
      where: { user: { id: user.id } },
      order: { is_default: 'DESC', created_at: 'DESC' },
    });
  }

  async findOne(id: number, user: IUser) {
    const address = await this.addressRepository.findOne({
      where: { id, user: { id: user.id } },
    });
    if (!address) throw new NotFoundException('Không tìm thấy địa chỉ');
    return address;
  }

  /**
   * Chạy `viec` trong MỘT transaction, sau khi khoá dòng `users` của người này.
   *
   * VÌ SAO. Bản cũ "bỏ mặc định mọi địa chỉ" rồi "đặt mặc định một cái" bằng
   * hai câu rời, ngoài transaction. Hai yêu cầu chen nhau (hai thiết bị, app
   * gửi lại khi mạng chập) thì cả hai câu "bỏ" chạy trước cả hai câu "đặt": hai
   * địa chỉ cùng mặc định, và màn thanh toán gửi hàng tới cái người dùng không
   * chọn. Đo bằng `dia-chi-mac-dinh-dua.spec.ts` (2 mặc định trước bản vá).
   *
   * VÌ SAO KHOÁ DÒNG `users` CHỨ KHÔNG `SELECT ... FROM addresses FOR UPDATE`.
   * Khoá các dòng địa chỉ không chặn được trường hợp người dùng CHƯA có địa
   * chỉ nào (không có dòng để khoá), còn khoá khoảng trống (gap lock) của
   * InnoDB thì hai lượt cùng giữ được rồi cùng chèn: deadlock 1213. Dòng users
   * thì luôn tồn tại và là một mutex sạch cho đúng một người: mọi đường đổi
   * `is_default` của người đó xếp hàng qua đây, người khác không bị ảnh hưởng.
   */
  private trongKhoaNguoiDung<T>(
    userId: number,
    viec: (repo: Repository<Address>) => Promise<T>,
  ): Promise<T> {
    return this.addressRepository.manager.transaction(async (em) => {
      await em.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      return viec(em.getRepository(Address));
    });
  }

  /** Bỏ mặc định mọi địa chỉ của người dùng. Chỉ gọi trong `trongKhoaNguoiDung`. */
  private boMacDinh(repo: Repository<Address>, userId: number) {
    return repo.update(
      { user: { id: userId }, is_default: true },
      { is_default: false },
    );
  }

  async create(dto: CreateAddressDto, user: IUser) {
    return this.trongKhoaNguoiDung(user.id, async (repo) => {
      if (dto.is_default) await this.boMacDinh(repo, user.id);
      const address = repo.create({
        ...dto,
        user: { id: user.id },
      });
      return repo.save(address);
    });
  }

  async update(id: number, dto: UpdateAddressDto, user: IUser) {
    const address = await this.findOne(id, user);
    return this.trongKhoaNguoiDung(user.id, async (repo) => {
      if (dto.is_default) await this.boMacDinh(repo, user.id);
      Object.assign(address, dto);
      return repo.save(address);
    });
  }

  async setDefault(id: number, user: IUser) {
    await this.findOne(id, user);
    await this.trongKhoaNguoiDung(user.id, async (repo) => {
      await this.boMacDinh(repo, user.id);
      // Kèm user_id trong điều kiện: phép kiểm chủ sở hữu ở `findOne` phía
      // trên chạy ngoài khoá, đây là lớp thứ hai không tốn gì.
      await repo.update({ id, user: { id: user.id } }, { is_default: true });
    });
    return { message: 'Đặt địa chỉ mặc định thành công' };
  }

  async remove(id: number, user: IUser) {
    const address = await this.findOne(id, user);
    await this.addressRepository.remove(address);
    return { message: 'Xóa địa chỉ thành công' };
  }
}
