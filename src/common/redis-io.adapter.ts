import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Cho Socket.IO nói chuyện được giữa NHIỀU tiến trình api (task #5).
 *
 * VÌ SAO CẦN.
 *
 * `server.emit(...)` mặc định chỉ tới được các socket đang nối vào CHÍNH tiến
 * trình đó. Chạy một bản api thì không thấy gì bất thường — đó là toàn bộ vấn
 * đề. Chạy ba bản sau một load balancer thì hai người đang chat với nhau, mỗi
 * người rơi vào một bản, và không ai nhận được tin của ai. Không có ngoại lệ
 * nào được ném ra, không có dòng log nào. Chỉ là im lặng, và người dùng nghĩ
 * đối phương không trả lời.
 *
 * Adapter Redis giải quyết bằng cách cho mỗi tiến trình phát mọi sự kiện qua
 * Redis pub/sub, để các tiến trình khác chuyển tiếp tới socket của chúng.
 *
 * HAI KẾT NỐI CHỨ KHÔNG MỘT.
 *
 * Một client Redis đã vào chế độ `subscribe` thì không chạy được lệnh thường
 * nào nữa — đó là ràng buộc của chính giao thức Redis, không phải của thư viện.
 * Dùng chung một client cho cả publish lẫn subscribe là hỏng câm: subscribe
 * chạy, publish lặng lẽ không tới đâu. Nên `sub` phải là `pub.duplicate()`.
 *
 * FAIL-OPEN: nếu không có REDIS_URL thì lớp này không được dùng tới (xem
 * main.ts) và socket chạy y như trước — một tiến trình, hoạt động bình thường.
 * Máy dev không cần Redis.
 */
export class RedisIoAdapter extends IoAdapter {
  private taoAdapter?: ReturnType<typeof createAdapter>;

  async ketNoiRedis(url: string): Promise<void> {
    const pub = new Redis(url);
    const sub = pub.duplicate();

    // Không có listener 'error' thì một lỗi kết nối ioredis trở thành lỗi chưa
    // bắt và giết cả tiến trình Node. Redis chết không được phép làm sập API —
    // socket vẫn phải phục vụ được các client nối vào chính tiến trình này.
    for (const [ten, client] of [
      ['pub', pub],
      ['sub', sub],
    ] as const) {
      client.on('error', (e: Error) => {
        console.warn(`[socket] kết nối Redis ${ten} lỗi: ${e.message}`);
      });
    }

    // Chờ cả hai sẵn sàng trước khi gắn. Gắn adapter lên một client chưa nối
    // xong thì những sự kiện phát ra trong vài giây đầu sau khi khởi động rơi
    // vào khoảng trống — hiếm, và vì hiếm nên rất khó truy ra sau này.
    await Promise.all([pub.ping(), sub.ping()]);
    this.taoAdapter = createAdapter(pub, sub);
    console.log('[socket] đã bật adapter Redis — nhiều bản api thấy được nhau');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (a: unknown) => void;
    };
    if (this.taoAdapter) server.adapter(this.taoAdapter);
    return server;
  }
}
