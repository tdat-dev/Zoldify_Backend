import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { FollowsService } from './follows.service';

/**
 * THEO DÕI NGƯỜI BÁN — module này trước hôm nay không có bài kiểm nào.
 *
 * VÌ SAO DÙNG REPOSITORY GIẢ Ở ĐÂY, TRONG KHI `wallets` DÙNG MySQL THẬT.
 *
 * Quy tắc tôi theo: **kiểm ở nơi bất biến thật sự sống**.
 *
 * Ở `wallets`, thứ chặn ghi trùng là khoá UNIQUE và transaction của MySQL —
 * mock đi thì bài kiểm xanh mà không chứng minh gì, nên nó chạy trên database
 * thật. Ở đây thì ngược lại: "không được theo dõi chính mình" và "bấm lần hai
 * thì bỏ theo dõi" nằm trọn trong mã TypeScript. Dựng cả MySQL cho hai nhánh
 * `if` chỉ làm bài kiểm chậm và giòn hơn, không làm nó đúng hơn.
 *
 * Entity `Follow` còn có quan hệ tới `User`, nên nạp nó vào một DataSource
 * thật sẽ kéo theo cả chuỗi entity của identity — trả giá lược đồ cho một bài
 * kiểm không đụng tới lược đồ.
 *
 * ĐIỀU NÀY KHÔNG CÒN ĐÚNG nếu sau này thêm khoá UNIQUE(follower, following) để
 * chặn hai request song song cùng tạo một bản ghi. Lúc đó bất biến chuyển
 * xuống database và bài kiểm phải chuyển theo — xem ghi chú ở ca cuối.
 */
describe('FollowsService', () => {
  /** Repo giả: giữ dữ liệu trong một mảng, đủ cho hai nhánh của `toggle`. */
  function repoGia(banDau: Follow[] = []) {
    let kho = [...banDau];
    return {
      kho: () => kho,
      repo: {
        findOne: ({ where }: { where: Partial<Follow> }) =>
          Promise.resolve(
            kho.find(
              (f) =>
                f.follower_id === where.follower_id &&
                f.following_id === where.following_id,
            ) ?? null,
          ),
        count: ({ where }: { where: Partial<Follow> }) =>
          Promise.resolve(
            kho.filter(
              (f) =>
                (where.follower_id === undefined ||
                  f.follower_id === where.follower_id) &&
                (where.following_id === undefined ||
                  f.following_id === where.following_id),
            ).length,
          ),
        save: (f: Partial<Follow>) => {
          kho.push(f as Follow);
          return Promise.resolve(f);
        },
        remove: (f: Follow) => {
          kho = kho.filter((x) => x !== f);
          return Promise.resolve(f);
        },
      } as unknown as Repository<Follow>,
    };
  }

  it('không cho theo dõi chính mình', async () => {
    // Không phải chuyện thẩm mỹ: một dòng tự-theo-dõi làm `countFollowers`
    // đếm thêm một người không có thật, và con số đó hiện trên trang shop.
    const { repo } = repoGia();
    const s = new FollowsService(repo);

    await expect(s.toggle(7, 7)).rejects.toThrow(BadRequestException);
  });

  it('bấm lần đầu là theo dõi, lần hai là bỏ theo dõi', async () => {
    const { repo, kho } = repoGia();
    const s = new FollowsService(repo);

    const lan1 = await s.toggle(1, 2);
    expect(lan1.followed).toBe(true);
    expect(kho()).toHaveLength(1);

    const lan2 = await s.toggle(1, 2);
    expect(lan2.followed).toBe(false);
    expect(kho()).toHaveLength(0);

    // Lần ba phải theo dõi lại được — nếu `remove` xoá nhầm nhiều dòng hoặc
    // `findOne` so sai chiều thì ca này mới lộ.
    const lan3 = await s.toggle(1, 2);
    expect(lan3.followed).toBe(true);
  });

  it('theo dõi có CHIỀU: A theo B không có nghĩa B theo A', async () => {
    // `findOne` so cả hai cột. Đảo nhầm chiều thì bấm theo dõi một người sẽ
    // vô tình bỏ theo dõi người đang theo mình — lỗi im lặng, không ai báo.
    const { repo } = repoGia();
    const s = new FollowsService(repo);

    await s.toggle(1, 2);

    expect(await s.isFollowing(1, 2)).toBe(true);
    expect(await s.isFollowing(2, 1)).toBe(false);
  });

  it('đếm đúng hai chiều', async () => {
    const { repo } = repoGia();
    const s = new FollowsService(repo);

    await s.toggle(1, 10);
    await s.toggle(2, 10);
    await s.toggle(10, 3);

    expect(await s.countFollowers(10)).toBe(2);
    expect(await s.countFollowings(10)).toBe(1);
  });

  it('GHI NHẬN: hai request song song vẫn tạo được hai dòng trùng', async () => {
    // Bài kiểm này KHÔNG phải để bắt lỗi — nó chốt lại một giới hạn đã biết,
    // để người đọc sau không tưởng `toggle` là an toàn với truy cập đồng thời.
    //
    // `toggle` đọc rồi mới ghi, không khoá dòng và bảng không có
    // UNIQUE(follower_id, following_id). Hai request cùng lúc đều thấy "chưa
    // theo dõi" rồi cùng ghi. Hậu quả nhẹ (số đếm lệch 1, không đụng tiền) nên
    // chưa đáng sửa gấp — nhưng cách sửa đúng là thêm khoá UNIQUE, KHÔNG phải
    // thêm kiểm tra trong mã.
    //
    // Khi nào thêm khoá đó thì bài kiểm này phải đổi thành "lần ghi thứ hai bị
    // database từ chối", và nó phải chuyển sang chạy trên MySQL thật.
    const { repo, kho } = repoGia();
    const s = new FollowsService(repo);

    await Promise.all([s.toggle(1, 2), s.toggle(1, 2)]);

    expect(kho()).toHaveLength(2);
  });
});
