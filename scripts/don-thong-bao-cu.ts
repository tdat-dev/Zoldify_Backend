/**
 * Dọn thông báo cũ một lần, chạy tay: `npm run notifications:purge`.
 *
 * Cùng hàm với job hằng đêm (khi job được đăng ký, xem TODO ở
 * `NotificationsService.donThongBaoCu`). Nối database theo DB_* trong .env
 * như các script seed. In kết quả dạng JSON; mã thoát 0 khi chạy xong, kể cả
 * khi chạm trần (phần còn lại để lần sau).
 *
 * Tuỳ chọn: `--lo=1000 --tran=100000 --doc=90 --moi=180`.
 */
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { donThongBaoCu } from '../src/messaging/notifications/don-thong-bao-cu';

config();

function thamSo(ten: string): number | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${ten}=`));
  return a ? Number(a.split('=')[1]) : undefined;
}

async function main(): Promise<void> {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'zoldify',
    synchronize: false,
  });
  await ds.initialize();
  try {
    const kq = await donThongBaoCu(ds, {
      lo: thamSo('lo'),
      tranMoiLan: thamSo('tran'),
      docSauNgay: thamSo('doc'),
      moiSauNgay: thamSo('moi'),
    });
    console.log(JSON.stringify(kq));
  } finally {
    await ds.destroy();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
