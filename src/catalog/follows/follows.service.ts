import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateFollowDto } from './dto/create-follow.dto';
import { UpdateFollowDto } from './dto/update-follow.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Follow } from './entities/follow.entity';
import { QueryFailedError, Repository } from 'typeorm';

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

/** Mã lỗi MySQL khi đụng ràng buộc UNIQUE. Cùng hằng số mà `cart.service.ts` dùng. */
const ER_DUP_ENTRY = 1062;
/** InnoDB phát hiện vòng chờ khoá và quay lui một giao dịch. */
const ER_LOCK_DEADLOCK = 1213;

/**
 * Tính cả lần đầu. Đo bằng các bài gài sẵn trong `follows.service.spec.ts`: giới
 * hạn 1 và 2 đỏ, 3 xanh; để 5 cho dư hai lượt. Hết lượt thì lỗi 1213 đi tiếp tới
 * `DatabaseExceptionFilter`: 409, mời thử lại.
 */
export const SO_LAN_THU_KHI_DEADLOCK = 5;
const DO_TRE_THU_LAI_MS = 20;

function laLoiMySql(err: unknown, errno: number): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { errno?: number } | undefined;
  return driverError?.errno === errno;
}

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

  /**
   * Đặt trạng thái "đang theo dõi", không lật. Q5/Q6 trên Trello: `toggle` lật
   * theo thứ đang có trên server nên thiết bị còn trạng thái cũ bấm bỏ theo dõi
   * lại thành theo dõi. Gọi bao nhiêu lần cũng ra một kết quả.
   *
   * VÌ SAO KHÔNG `INSERT IGNORE`. Nó nuốt cả lỗi khoá ngoại: không có dòng nào
   * mà vẫn trả `followed: true`. Chèn từ SELECT trên `users` thì một câu trả lời
   * luôn cả ba ca không có ai để theo: id không có, tài khoản đã xoá mềm (khoá
   * ngoại không chặn được ca này), id vượt cột INT (khỏi lỗi 1264). Chèn trùng
   * thì 1062, nghĩa là đã theo dõi rồi, đúng thứ người bấm muốn.
   */
  async follow(followerId: number, followingId: number) {
    if (followerId === followingId) {
      throw new BadRequestException('Bạn không thể theo dõi chính mình');
    }

    return this.thuLaiKhiDeadlock(async () => {
      try {
        const ketQua = await this.followRepository.query<{
          affectedRows: number;
        }>(
          `INSERT INTO follows (follower_id, following_id)
           SELECT ?, id FROM users WHERE id = ? AND deleted_at IS NULL`,
          [followerId, followingId],
        );
        if (ketQua.affectedRows === 0) {
          throw new NotFoundException('Người bán không tồn tại');
        }
      } catch (err) {
        if (!laLoiMySql(err, ER_DUP_ENTRY)) throw err;
      }
      return { followed: true };
    });
  }

  /**
   * Đặt trạng thái "không theo dõi". Không có dòng để xoá cũng là thành công,
   * kể cả với tài khoản đã xoá: người bấm đang muốn gỡ nó đi.
   */
  async unfollow(followerId: number, followingId: number) {
    return this.thuLaiKhiDeadlock(async () => {
      await this.followRepository.delete({
        follower_id: followerId,
        following_id: followingId,
      });
      return { followed: false };
    });
  }

  /**
   * VÌ SAO PHẢI THỬ LẠI. Bỏ theo dõi chỉ đánh dấu xoá bản ghi trong chỉ mục
   * UNIQUE, tới khi purge dọn nó mới mất hẳn. Hai lượt chèn cùng cặp gặp bản ghi
   * đó đều lấy khoá gap CHIA SẺ để kiểm trùng, rồi cùng chờ khoá chèn mà khoá
   * của lượt kia đang chặn: deadlock 1213. Đo 300 đợt 20 lượt lẫn lộn trên MySQL
   * 8.4: gần một nửa số đợt dính, đổi sang `INSERT IGNORE` hay `ON DUPLICATE KEY
   * UPDATE` vẫn y vậy, nên đây là đặc tính của InnoDB chứ không phải của câu
   * lệnh. Khoá dòng `users` để xếp hàng thì đắt hơn cái được: thêm khoá độc quyền
   * đan vào luồng đặt hàng cho một bảng ít giá trị, mà `toggle` vẫn đi ngoài.
   *
   * VÌ SAO THỬ LẠI LÀ ĐÚNG. `viec` là MỘT câu lệnh tự commit, MySQL đã quay lui
   * trọn nó, và nó nói ý định chứ không lật nên chạy lại không đổi nghĩa. Đừng
   * bọc hàm này quanh một transaction nhiều câu: deadlock quay lui cả transaction
   * chứ không chỉ câu cuối. Chỉ bắt 1213; lỗi khác đi nguyên xi.
   */
  private async thuLaiKhiDeadlock<T>(viec: () => Promise<T>): Promise<T> {
    for (let lan = 1; ; lan++) {
      try {
        return await viec();
      } catch (err) {
        if (
          !laLoiMySql(err, ER_LOCK_DEADLOCK) ||
          lan >= SO_LAN_THU_KHI_DEADLOCK
        ) {
          throw err;
        }
        // Lệch ngẫu nhiên để các lượt vừa thua không lao vào đụng nhau lần nữa.
        await new Promise((xong) =>
          setTimeout(xong, Math.random() * DO_TRE_THU_LAI_MS * lan),
        );
      }
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
