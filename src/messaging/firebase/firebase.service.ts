import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private initialized = false;

  /**
   * Nơi tìm khoá service account, theo thứ tự.
   *
   * VÌ SAO KHÔNG DÙNG `__dirname/../..` NHƯ BẢN TRƯỚC: ở bản build, __dirname là
   * `dist/messaging/firebase`, nên đường dẫn đó trỏ vào `dist/` — mà `nest build`
   * XOÁ SẠCH `dist/` mỗi lần chạy. Đặt khoá vào đó thì chạy được đúng một lần;
   * lần build kế tiếp file biến mất và Google login tắt trở lại, log chỉ nói
   * "not found" chứ không nói vì sao nó vừa còn ở đó.
   *
   * Gốc dự án (process.cwd()) sống qua mọi lần build. Vẫn giữ đường dẫn cũ ở
   * cuối danh sách để không phá máy nào đã đặt khoá theo lối cũ.
   */
  private candidatePaths(): string[] {
    const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    return [
      // 1. Khai tường minh — dùng khi triển khai gắn khoá vào một chỗ cố định.
      ...(fromEnv ? [path.resolve(fromEnv)] : []),
      // 2. Gốc dự án: chỗ nên đặt, vì nó không nằm trong thư mục bị xoá.
      path.join(process.cwd(), 'firebase-service-account.json'),
      // 3. Đường dẫn của bản trước, giữ lại cho tương thích ngược.
      path.join(__dirname, '..', '..', 'firebase-service-account.json'),
    ];
  }

  onModuleInit() {
    const accountPath = this.candidatePaths().find((p) => fs.existsSync(p));
    if (!accountPath) {
      this.logger.warn(
        'Khong tim thay firebase-service-account.json — dang nhap bang Google se tat. ' +
          `Da tim o: ${this.candidatePaths().join(' | ')}`,
      );
      return;
    }
    const serviceAccount = require(accountPath);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    this.initialized = true;
    // In ra CHỖ đã nạp, không chỉ "thành công": ba đường dẫn ứng viên nghĩa là
    // khi có hai bản khoá lệch nhau trên cùng một máy, dòng log này là thứ duy
    // nhất cho biết bản nào đang chạy.
    this.logger.log(`Firebase da khoi tao tu ${accountPath}`);
  }

  async verifyIdToken(idToken: string) {
    if (!this.initialized) {
      throw new UnauthorizedException('Firebase chưa được cấu hình');
    }
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email || '',
        phone_number: decoded.phone_number || '',
        name: decoded.name || '',
        avatar: decoded.picture || '',
      };
    } catch {
      throw new UnauthorizedException('Token không hợp lệ');
    }
  }
}
