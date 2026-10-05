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
    // `isFile()` chứ không `existsSync`, và đây là chuyện đã làm chết cả cụm.
    //
    // `docker-compose.yml` mount `./firebase-service-account.json` vào api.
    // Khoá là secret nên nó bị gitignore: máy nào clone về mà chưa đặt khoá thì
    // KHÔNG có file đó — và Docker, gặp một bind mount trỏ vào đường dẫn không
    // tồn tại, **tự tạo một THƯ MỤC rỗng** ở đó. `existsSync` trả true cho thư
    // mục, nên nhánh "không tìm thấy khoá" không chạy, và `require(<thư mục>)`
    // ném MODULE_NOT_FOUND ngay trong onModuleInit.
    //
    // Hậu quả đo được lúc dựng cụm lần đầu: cả BA bản api vào vòng khởi động
    // lại vô tận, trong khi ý định của mã là chỉ tắt đăng nhập Google.
    const accountPath = this.candidatePaths().find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (!accountPath) {
      this.logger.warn(
        'Khong tim thay firebase-service-account.json — dang nhap bang Google se tat. ' +
          `Da tim o: ${this.candidatePaths().join(' | ')}`,
      );
      return;
    }
    // Bọc try/catch vì một FILE vẫn hỏng được theo cách khác: JSON sai cú pháp,
    // khoá của project khác, file rỗng do `touch` cho qua chuyện. Không bọc thì
    // mọi trường hợp đó đều là api không khởi động nổi — đổi một tính năng phụ
    // (đăng nhập Google) thành cả hệ thống ngừng bán hàng.
    try {
      const serviceAccount = require(accountPath) as admin.ServiceAccount;
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      this.initialized = true;
    } catch (e) {
      this.logger.error(
        `Doc duoc ${accountPath} nhung khong dung duoc lam khoa Firebase — ` +
          'dang nhap bang Google se tat. ' +
          (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
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
