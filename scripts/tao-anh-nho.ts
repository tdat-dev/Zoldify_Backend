/**
 * Bù ảnh nhỏ 480px (`_480.webp`) cho ảnh ĐÃ tải lên trước khi upload biết nén.
 *
 * VÌ SAO: đo 28/10 trên prod, ảnh sản phẩm cũ là PNG gốc 1,1 đến 1,6 MB mà app
 * chỉ hiện cỡ 400px; trang chủ tải cỡ 20 MB ảnh. Ảnh tải lên từ nay có sẵn ảnh
 * nhỏ (xem src/catalog/files/nen-anh.ts), còn ảnh cũ thì chưa, và client lùi
 * về ảnh gốc nặng. Script này tạo ảnh nhỏ cho chúng.
 *
 * KHÔNG đụng ảnh gốc, KHÔNG đụng database: chỉ THÊM object `<tên>_480.webp`
 * cạnh ảnh cũ, đúng tên khoaAnhNho() mà client đoán. Ảnh cũ vẫn là PNG, bảng
 * files vẫn trỏ về nó.
 *
 *   npm run anh:bu-thumb                  # xem trước, KHÔNG ghi
 *   npm run anh:bu-thumb -- --ghi         # ghi thật
 *   npm run anh:bu-thumb -- --gioi-han=5  # chỉ làm 5 ảnh đầu (thử trước)
 *
 * Mặc định là xem trước: đây là script ghi vào bucket đang phục vụ người dùng,
 * nên phải gõ thêm chữ mới ghi được.
 *
 * CHẠY LẠI ĐƯỢC: ảnh đã có `_480.webp` thì bỏ qua (kiểm trên chính danh sách
 * vừa liệt kê), nên chạy lần hai chỉ làm phần còn thiếu hoặc lần trước lỗi.
 *
 * Biến môi trường: y như StorageService (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_KEY_PREFIX). R2_KEY_PREFIX rỗng nghĩa là
 * quét CẢ bucket, kể cả tiền tố của môi trường khác (vd staging/): script cảnh
 * báo trước khi làm.
 */
import 'dotenv/config';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  chonKhoaCanBuAnhNho,
  khoaAnhNho,
  taoAnhNho,
} from '../src/catalog/files/nen-anh';
import { CACHE_ANH } from '../src/catalog/files/storage.service';

const GHI = process.argv.includes('--ghi');
const GIOI_HAN = Number(
  process.argv.find((a) => a.startsWith('--gioi-han='))?.split('=')[1] ?? 0,
);
// Hai ảnh cùng lúc: một ảnh đang tải về/đẩy lên trong khi ảnh kia nén. Nhiều
// hơn cũng không nhanh hơn, vì nenAnh xử lý lần lượt từng ảnh (giới hạn RAM).
const SONG_SONG = 2;

function canBien(ten: string): string {
  const v = process.env[ten];
  if (!v) {
    console.error(`Thiếu biến ${ten}. Cần đủ biến R2_* như StorageService.`);
    process.exit(1);
  }
  return v;
}

async function lietKe(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const trang = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }),
    );
    for (const o of trang.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = trang.IsTruncated ? trang.NextContinuationToken : undefined;
    process.stdout.write(`\r  đã liệt kê ${keys.length} khoá`);
  } while (token);
  process.stdout.write('\n');
  return keys;
}

async function main() {
  const bucket = canBien('R2_BUCKET');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${canBien('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: canBien('R2_ACCESS_KEY_ID'),
      secretAccessKey: canBien('R2_SECRET_ACCESS_KEY'),
    },
  });
  // Cắt "/" hai đầu giống StorageService, rồi liệt kê đúng "<prefix>/".
  const tienTo = (process.env.R2_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const prefix = tienTo ? `${tienTo}/` : '';

  console.log(
    `Bucket ${bucket}, tiền tố "${prefix}"` +
      (GHI ? ', GHI THẬT' : ', xem trước'),
  );
  if (!prefix) {
    console.log(
      '  CẢNH BÁO: R2_KEY_PREFIX rỗng, quét cả bucket (gồm cả tiền tố môi trường khác).',
    );
  }

  const tatCa = await lietKe(client, bucket, prefix);
  let canLam = chonKhoaCanBuAnhNho(tatCa);
  const tongCanLam = canLam.length;
  if (GIOI_HAN > 0) canLam = canLam.slice(0, GIOI_HAN);

  console.log(
    `${tatCa.length} khoá, ${tongCanLam} ảnh chưa có ảnh nhỏ` +
      (GIOI_HAN > 0 ? `, làm ${canLam.length} (--gioi-han)` : ''),
  );

  if (!GHI) {
    for (const k of canLam.slice(0, 20)) {
      console.log(`  sẽ tạo  ${khoaAnhNho(k)}`);
    }
    if (canLam.length > 20)
      console.log(`  ... và ${canLam.length - 20} ảnh nữa`);
    console.log('\nĐây mới là XEM TRƯỚC. Thêm -- --ghi để ghi thật.');
    return;
  }

  let xong = 0;
  let loi = 0;
  let byteGoc = 0;
  let byteNho = 0;
  let viTri = 0;

  const motLuong = async () => {
    while (viTri < canLam.length) {
      const key = canLam[viTri++];
      const thuTu = `[${viTri}/${canLam.length}]`;
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (!res.Body) throw new Error('object rỗng');
        const goc = Buffer.from(await res.Body.transformToByteArray());
        const nho = await taoAnhNho(goc);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: khoaAnhNho(key),
            Body: nho,
            ContentType: 'image/webp',
            CacheControl: CACHE_ANH,
          }),
        );
        xong++;
        byteGoc += goc.length;
        byteNho += nho.length;
        console.log(`  ${thuTu} ${key} ${goc.length} -> ${nho.length} byte`);
      } catch (e) {
        // Một ảnh hỏng không dừng cả lượt: ghi lại rồi đi tiếp. Chạy lại script
        // sẽ thử lại đúng những ảnh này, vì chúng vẫn chưa có ảnh nhỏ.
        loi++;
        console.log(
          `  ${thuTu} LỖI ${key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: SONG_SONG }, motLuong));

  console.log(
    `\n${xong} tạo, ${loi} lỗi, ${tongCanLam - canLam.length} để lượt sau. ` +
      `Ảnh gốc ${(byteGoc / 1e6).toFixed(1)} MB, ảnh nhỏ ${(byteNho / 1e6).toFixed(2)} MB.`,
  );
  if (loi > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
