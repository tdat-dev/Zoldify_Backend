import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './entities/address.entity';
import { CreateAddressDto, UpdateAddressDto } from './dto/create-address.dto';
import { IUser } from 'src/users/users.interface';

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

  async create(dto: CreateAddressDto, user: IUser) {
    if (dto.is_default) {
      await this.addressRepository.update(
        { user: { id: user.id }, is_default: true },
        { is_default: false },
      );
    }
    const address = this.addressRepository.create({
      ...dto,
      user: { id: user.id },
    });
    return this.addressRepository.save(address);
  }

  async update(id: number, dto: UpdateAddressDto, user: IUser) {
    const address = await this.findOne(id, user);
    if (dto.is_default) {
      await this.addressRepository.update(
        { user: { id: user.id }, is_default: true },
        { is_default: false },
      );
    }
    Object.assign(address, dto);
    return this.addressRepository.save(address);
  }

  async setDefault(id: number, user: IUser) {
    await this.findOne(id, user);
    await this.addressRepository.update(
      { user: { id: user.id }, is_default: true },
      { is_default: false },
    );
    await this.addressRepository.update(id, { is_default: true });
    return { message: 'Đặt địa chỉ mặc định thành công' };
  }

  async remove(id: number, user: IUser) {
    const address = await this.findOne(id, user);
    await this.addressRepository.remove(address);
    return { message: 'Xóa địa chỉ thành công' };
  }
}
