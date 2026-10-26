import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateFollowDto } from './dto/create-follow.dto';
import { UpdateFollowDto } from './dto/update-follow.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Follow } from './entities/follow.entity';
import { Repository } from 'typeorm';

/**
 * Cột được trả ra ở hai danh sách theo dõi. Hai route đó là CÔNG KHAI
 * (@Public), mà bản trước nạp `relations` rồi trả nguyên dòng `users`: email,
 * số điện thoại, vai trò, token_version, is_locked, last_seen của từng người.
 * Ai không đăng nhập cũng gom được email và số điện thoại của toàn bộ người
 * theo dõi một shop.
 *
 * Chọn cột trong câu truy vấn chứ không lọc sau: cột không được SELECT thì
 * không thể lọt ra, kể cả khi ai đó thêm cột nhạy cảm mới vào bảng users. Bộ
 * cột khớp đúng thứ app đang đọc (FollowedUser: id, full_name, avatar,
 * created_at).
 */
const CHON_NGUOI_CONG_KHAI = (quanHe: 'follower' | 'following') => ({
  id: true,
  created_at: true,
  [quanHe]: { id: true, full_name: true, avatar: true, created_at: true },
});

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
  ) {}

  async toggle(followerId: number, followingId: number) {
    if (followerId === followingId) {
      throw new BadRequestException('Bạn không thể theo dõi chính mình');
    }

    const existing = await this.followRepository.findOne({
      where: { follower_id: followerId, following_id: followingId },
    });

    if (existing) {
      await this.followRepository.remove(existing);
      return { followed: false, message: 'Đã hủy theo dỗi' };
    } else {
      await this.followRepository.save({
        follower_id: followerId,
        following_id: followingId,
      });
      return { followed: true, message: 'Đã theo dõi' };
    }
  }

  async isFollowing(followerId: number, followingId: number) {
    const count = await this.followRepository.count({
      where: { follower_id: followerId, following_id: followingId },
    });

    return count > 0;
  }

  async countFollowers(userId: number) {
    return this.followRepository.count({
      where: { following_id: userId },
    });
  }

  async countFollowings(userId: number) {
    return this.followRepository.count({
      where: { follower_id: userId },
    });
  }

  async getFollowers(userId: number, page = 1, limit = 20) {
    const [result, total] = await this.followRepository.findAndCount({
      where: { following_id: userId },
      relations: ['follower'],
      select: CHON_NGUOI_CONG_KHAI('follower'),
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result: result.map((f) => f.follower),
    };
  }

  async getFollowing(userId: number, page = 1, limit = 20) {
    const [result, total] = await this.followRepository.findAndCount({
      where: { follower_id: userId },
      relations: ['following'],
      select: CHON_NGUOI_CONG_KHAI('following'),
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });
    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result: result.map((f) => f.following),
    };
  }
}
