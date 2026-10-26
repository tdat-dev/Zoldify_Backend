import { once } from 'node:events';
import { createCache } from 'cache-manager';
import type Redis from 'ioredis';
import type { Repository } from 'typeorm';
import { ProductsService } from './products.service';
import type { Product } from './entities/product.entity';
import type { Follow } from '@catalog/follows/entities/follow.entity';
import type { Shop } from '@catalog/shop/entities/shop.entity';
import type { NotificationsService } from '@messaging/notifications/notifications.service';
import type { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * Socket Redis đếm view_count phải được unref KỂ CẢ khi ai đó thay
 * `this.redis` trước lúc kết nối xong.
 *
 * Đo 26/10: `cache-va-dem-sau-dat-huy.spec.ts` thay `products.redis` bằng bản
 * giả `{ incr }` ngay sau khi dựng service. Hàm nghe `connect` đọc lại
 * `this.redis` lúc chạy, tức unref nhầm vào bản giả, còn socket thật giữ jest
 * sống tới hết hạn 600s của nghiem-thu (602/602 xanh mà cổng test vẫn đỏ).
 *
 * Chỉ chạy khi có REDIS_URL: không có Redis thì service không mở socket nào.
 */
const coRedis = !!process.env.REDIS_URL;
(coRedis ? describe : describe.skip)(
  'ProductsService: unref socket Redis',
  () => {
    it('unref đúng client đã mở dù this.redis bị thay trước lúc nối xong', async () => {
      const ps = new ProductsService(
        {} as Repository<Product>,
        {} as Repository<Follow>,
        {} as Repository<Shop>,
        {} as NotificationsService,
        createCache({ ttl: 1_000 }),
        {} as StockEventsService,
      );
      const goc = (ps as unknown as { redis: Redis }).redis;
      (ps as unknown as { redis: unknown }).redis = {
        incr: () => Promise.resolve(1),
      };
      try {
        await once(goc, 'ready');
        const handle = (
          goc as unknown as {
            stream?: { _handle?: { hasRef?: () => boolean } };
          }
        ).stream?._handle;
        expect(handle?.hasRef?.()).toBe(false);
      } finally {
        goc.disconnect();
      }
    });
  },
);
