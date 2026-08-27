/**
 * BỘ TỰ KIỂM BACKUP + KHÔI PHỤC (task #24 và #25 bảng phân công) — viết TEST TRƯỚC.
 *
 * Chạy:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck-backup.ts
 *   npm run check:backup
 *
 * VÌ SAO BÀI TEST NÀY TỒN TẠI.
 *
 * Backup là loại việc hỏng CÂM nhất trong cả hệ thống. Không như một API lỗi —
 * có người dùng kêu ngay — một cron backup hỏng vẫn chạy đúng giờ mỗi đêm, vẫn
 * ghi log "xong", và chỉ lộ ra đúng vào ngày mất dữ liệu, tức là ngày duy nhất
 * không sửa được nữa. Bảng phân công viết thẳng ở task #25: "Backup chưa từng
 * restore thử thì không phải backup."
 *
 * Bốn kiểu hỏng câm mà việc này dính được ngay, và đều KHÔNG kêu:
 *
 *   1. `mysqldump` sai mật khẩu vẫn TẠO RA FILE — chỉ có vài dòng comment đầu.
 *      Nén lại thành .gz vẫn "thành công". Cron chạy 14 ngày, thư mục đầy file
 *      trông rất giống backup, không cái nào khôi phục được.
 *   2. Script `.sh` viết trên Windows mang theo CRLF. Trên VPS Linux nó chết
 *      ngay dòng đầu với `bad interpreter: /bin/sh^M`. Repo này CHƯA có file
 *      .sh nào và CHƯA có .gitattributes, nên đây là lần đầu dính bẫy.
 *   3. Git trên Windows không đặt bit thực thi. Cron gọi ./backup-mysql.sh →
 *      `Permission denied`, nuốt vào log cron mà không ai đọc.
 *   4. Một bản dump production chứa email thật, hash mật khẩu và sổ cái tiền.
 *      Một lần `git add .` là nó nằm vĩnh viễn trong lịch sử repo.
 *
 * Nên bài test hỏi về HỢP ĐỒNG của hai script, đọc từ chính file và từ chỉ mục
 * git — nơi hai bẫy (2) và (3) thật sự sống. Phần dọn file cũ (retention) thì
 * KHÔNG đọc mà CHẠY THẬT: dựng 20 file giả nhiều ngày tuổi rồi đếm lại. Xoá
 * nhầm là rủi ro không được phép đoán.
 *
 * Ranh giới của nó: file này không cần MySQL, không cần Docker, không cần VPS.
 * Việc dump ra khôi phục lại được thật thì chỉ có một cuộc diễn tập trên
 * database thật trả lời — đó là task #25, ghi trong docs/bao-cao/.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const BACKUP_SH = path.join(ROOT, 'scripts', 'backup-mysql.sh');
const RESTORE_SH = path.join(ROOT, 'scripts', 'restore-mysql.sh');
const GITATTR = path.join(ROOT, '.gitattributes');
const GITIGNORE = path.join(ROOT, '.gitignore');

/** Thư mục tạm cho phần chạy thật. Nằm trong repo để không phải dịch đường dẫn
 *  Windows (C:\...) sang dạng bash (/c/...) — chỗ đó rất dễ sai lặng lẽ. */
const TMP_REL = '.tmp-selfcheck-backup';
const TMP_ABS = path.join(ROOT, TMP_REL);

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

/** Đọc file, trả '' nếu không có — để bài test báo FAIL có ý nghĩa thay vì ném. */
function doc(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Một dòng của `git ls-files -s`: "<mode> <sha> <stage>\t<path>".
 * Trả null khi file chưa được git theo dõi.
 *
 * Phải hỏi CHỈ MỤC GIT chứ không hỏi hệ thống tệp: bit thực thi và ký tự xuống
 * dòng mà VPS nhận được đến từ blob trong git, không phải từ bản sao đang nằm
 * trên đĩa máy Windows này. Hỏi nhầm chỗ thì bài test xanh mà VPS vẫn chết.
 */
function chiMucGit(relPath: string): { mode: string; sha: string } | null {
  const r = spawnSync('git', ['ls-files', '-s', '--', relPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const line = (r.stdout ?? '').trim();
  if (!line) return null;
  const m = /^(\d{6})\s+([0-9a-f]{40})\s+\d\s+/.exec(line);
  return m ? { mode: m[1], sha: m[2] } : null;
}

/** Nội dung blob trong git (bản mà Linux sẽ nhận), dạng byte thô. */
function blobGit(sha: string): Buffer {
  const r = spawnSync('git', ['cat-file', 'blob', sha], {
    cwd: ROOT,
    encoding: 'buffer',
  });
  return (r.stdout as unknown as Buffer) ?? Buffer.alloc(0);
}

/** Đường dẫn bash chạy được. Trên Windows `bash` có thể không nằm trong PATH
 *  của tiến trình node dù Git Bash đã cài, nên dò thêm chỗ mặc định. */
function timBash(): string | null {
  const ungVien = [
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const b of ungVien) {
    const r = spawnSync(b, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout ?? '').trim() === 'ok') return b;
  }
  return null;
}

function main(): void {
  console.log(
    '\x1b[1m═══ TỰ KIỂM BACKUP + KHÔI PHỤC (task #24, #25) — test trước ═══\x1b[0m\n',
  );

  // ── 1. Hai script tồn tại ────────────────────────────────────────────────
  // Đặt trước mọi thứ: thiếu file thì các kiểm sau vô nghĩa.
  console.log('\x1b[1m— 1. Script tồn tại —\x1b[0m');
  const coBackup = fs.existsSync(BACKUP_SH);
  const coRestore = fs.existsSync(RESTORE_SH);
  coBackup
    ? ok('scripts/backup-mysql.sh tồn tại')
    : bad('scripts/backup-mysql.sh CHƯA tồn tại');
  coRestore
    ? ok('scripts/restore-mysql.sh tồn tại')
    : bad('scripts/restore-mysql.sh CHƯA tồn tại');

  if (!coBackup || !coRestore) {
    console.log(
      '\n\x1b[31m═══ ĐỎ — chưa có script backup/khôi phục. Đây là trạng thái ĐÚNG trước khi làm. ═══\x1b[0m',
    );
    process.exit(1);
  }

  const backup = doc(BACKUP_SH);
  const restore = doc(RESTORE_SH);

  /**
   * Bản script đã BỎ HẾT dòng comment.
   *
   * Vì sao cần: bản đầu của bài test khớp thẳng vào nội dung file và báo đỏ
   * "script có `rm -rf` trần" — trong khi chuỗi đó nằm đúng trong câu comment
   * *"Không dùng `rm -rf` ở đây"*. Bài test đọc lời cảnh báo rồi tưởng là hành
   * vi. Chiều ngược lại còn tệ hơn: một comment nhắc `--single-transaction` sẽ
   * làm bài test XANH GIẢ dù lệnh thật không có cờ ấy.
   *
   * Nên: kiểm HÀNH VI thì đọc bản này; kiểm TÀI LIỆU (hướng dẫn cron) thì đọc
   * bản đầy đủ, vì tài liệu vốn sống trong comment.
   */
  const bodyOnly = (s: string) =>
    s
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
  const backupCode = bodyOnly(backup);
  const restoreCode = bodyOnly(restore);

  // ── 2. Hợp đồng với Linux: LF và bit thực thi (R3, R4) ───────────────────
  //
  // Hai bẫy này chỉ sống trong CHỈ MỤC GIT. Bản trên đĩa Windows có CRLF là
  // chuyện bình thường và vô hại; thứ giết cron là byte trong blob.
  console.log('\n\x1b[1m— 2. Hợp đồng với Linux (CRLF · bit thực thi) —\x1b[0m');

  const gitattr = doc(GITATTR);
  if (/^\s*\*\.sh\s+text\s+eol=lf\s*$/m.test(gitattr)) {
    ok('.gitattributes ép `*.sh text eol=lf`');
  } else {
    bad(
      '.gitattributes THIẾU dòng `*.sh text eol=lf` — .sh có thể mang CRLF lên VPS',
    );
  }

  for (const rel of ['scripts/backup-mysql.sh', 'scripts/restore-mysql.sh']) {
    const idx = chiMucGit(rel);
    if (!idx) {
      bad(`${rel} CHƯA được git theo dõi — không kiểm được mode và CRLF`);
      continue;
    }

    if (idx.mode === '100755') {
      ok(`${rel} — mode 100755 (có bit thực thi)`);
    } else {
      bad(
        `${rel} — mode ${idx.mode}, THIẾU bit thực thi. ` +
          `Sửa: git update-index --chmod=+x ${rel}`,
      );
    }

    const blob = blobGit(idx.sha);
    if (blob.length === 0) {
      bad(`${rel} — blob rỗng trong git`);
    } else if (blob.includes(0x0d)) {
      bad(
        `${rel} — blob trong git CÓ ký tự \\r (CRLF). ` +
          `Trên VPS sẽ chết với "bad interpreter: /bin/sh^M"`,
      );
    } else {
      ok(`${rel} — blob trong git thuần LF (${blob.length} byte)`);
    }
  }

  // ── 3. Dump production KHÔNG được lọt vào git (R10) ──────────────────────
  //
  // Một bản dump chứa email thật, hash mật khẩu và toàn bộ sổ cái tiền. Lọt vào
  // lịch sử git thì xoá đi cũng không sạch — phải viết lại lịch sử.
  console.log('\n\x1b[1m— 3. Dump không lọt vào git —\x1b[0m');
  const gitignore = doc(GITIGNORE);
  if (/^\s*\/?backups?\/?\s*$/m.test(gitignore)) {
    ok('.gitignore chặn thư mục backup');
  } else {
    bad('.gitignore KHÔNG chặn thư mục backup — dump có thể bị `git add .`');
  }
  if (/^\s*\*\.sql(\.gz)?\s*$/m.test(gitignore) || /\*\.sql\.gz/.test(gitignore)) {
    ok('.gitignore chặn thêm *.sql.gz (hàng rào thứ hai)');
  } else {
    bad('.gitignore nên chặn cả `*.sql.gz` phòng khi dump nằm ngoài thư mục backup');
  }

  // Chỉ quét thứ script backup SINH RA, không quét mọi file .sql trong repo.
  // Bản đầu của kiểm này quét `*.sql` và báo đỏ vì 30 file schema/seed thời PHP
  // ở docs/php/database/ — chúng được commit có chủ đích và không phải dump
  // production. Kiểm quá rộng thì nó kêu vào ngày bình thường, và người ta học
  // cách bỏ qua tiếng kêu đó trước khi có ngày bất thường.
  const daTheoDoi = spawnSync(
    'git',
    ['ls-files', '--', 'backups/', '*.sql.gz', 'zoldify-*.sql'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const lot = (daTheoDoi.stdout ?? '').trim();
  lot === ''
    ? ok('không có file dump nào đang bị git theo dõi')
    : bad(`CÓ file dump đang nằm trong git: ${lot.split('\n').join(', ')}`);

  // ── 4. Hợp đồng nội dung script backup (R2, R6, R7) ─────────────────────
  console.log('\n\x1b[1m— 4. Script backup nói đúng thứ cần nói —\x1b[0m');

  // R7: dump mặc định khoá bảng. Với 1 triệu bản ghi, khoá vài phút giữa giờ
  // chạy là một sự cố tự gây ra.
  /--single-transaction/.test(backupCode)
    ? ok('dùng --single-transaction (không khoá ghi khi dump InnoDB)')
    : bad('THIẾU --single-transaction — dump sẽ khoá bảng, tự gây sự cố');

  /--quick/.test(backupCode)
    ? ok('dùng --quick (không nạp cả bảng vào RAM)')
    : bad('THIẾU --quick — bảng 1 triệu dòng có thể làm hết RAM VPS');

  // R6: `docker compose exec` không có -T sẽ đòi TTY. Chạy tay thì được, chạy
  // từ cron thì hỏng với "the input device is not a TTY".
  if (/docker\s+compose[^\n]*exec[^\n]*-T/.test(backupCode)) {
    ok('docker compose exec có cờ -T (chạy được từ cron, không đòi TTY)');
  } else {
    bad('docker compose exec THIẾU -T — từ cron sẽ hỏng "input device is not a TTY"');
  }

  // R2: đây là kiểm quan trọng nhất của cả bài test.
  const coKiemDump =
    /Dump completed/.test(backupCode) && /CREATE TABLE/.test(backupCode);
  coKiemDump
    ? ok('có tự kiểm nội dung dump (CREATE TABLE + marker "Dump completed")')
    : bad(
        'KHÔNG tự kiểm nội dung dump — mysqldump sai mật khẩu vẫn tạo file, ' +
          'thư mục sẽ đầy file trông giống backup mà không khôi phục được',
      );

  // Dump hỏng phải bị XOÁ, không được để lại làm người ta tưởng có backup.
  /rm\s+-f/.test(backupCode)
    ? ok('dump không đạt thì bị xoá, không để lại file giả')
    : bad('dump hỏng không bị xoá — sẽ nằm đó giả làm backup thật');


  // ── 5. Retention: CHẠY THẬT, không đọc (R5) ─────────────────────────────
  //
  // Xoá nhầm là loại rủi ro không được phép suy đoán từ việc đọc mã. Dựng 20
  // file giả nhiều ngày tuổi, thêm một file KHÔNG phải backup, chạy prune,
  // rồi đếm lại.
  console.log('\n\x1b[1m— 5. Dọn file cũ — chạy thật trên thư mục giả —\x1b[0m');

  /RETENTION_DAYS:-14|RETENTION_DAYS=\{?:?-?14/.test(backupCode) ||
  /RETENTION_DAYS[:-]*-14/.test(backupCode)
    ? ok('retention mặc định 14 ngày (khớp sơ đồ deployment)')
    : bad('retention mặc định KHÁC 14 ngày — sơ đồ deployment ghi 14-day retention');

  // Chỉ được xoá đúng mẫu tên của chính mình, trong đúng thư mục của mình.
  /zoldify-\*\.sql\.gz/.test(backupCode)
    ? ok('prune chỉ khớp mẫu `zoldify-*.sql.gz`')
    : bad('prune không giới hạn theo mẫu tên — có thể xoá file không phải của nó');

  /rm\s+-rf/.test(backupCode)
    ? bad('script có `rm -rf` trần — quá rộng cho việc dọn backup')
    : ok('không có `rm -rf` trần trong script');

  const bash = timBash();
  if (!bash) {
    bad('không tìm thấy bash để chạy thử phần dọn file — bỏ qua kiểm quan trọng nhất');
  } else {
    try {
      fs.rmSync(TMP_ABS, { recursive: true, force: true });
      fs.mkdirSync(TMP_ABS, { recursive: true });

      const NGAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      // 20 file, tuổi 0..19 ngày. Với retention 14 ngày, đúng 14 file (tuổi
      // 0..13) phải sống sót.
      //
      // Tên phải DUY NHẤT theo i. Bản đầu đặt tên bằng `i % 10` nên 20 vòng lặp
      // chỉ tạo ra 10 tên, cái sau ghi đè cái trước và mang theo mtime cũ hơn —
      // bài test báo "còn 4, đáng lẽ 14" và tôi suýt đi sửa phần prune vốn đang
      // chạy đúng. Dữ liệu dựng sai thì kết luận sai, dù phép đo có đúng.
      for (let i = 0; i < 20; i++) {
        const f = path.join(
          TMP_ABS,
          `zoldify-zoldify-${String(i).padStart(3, '0')}-000000.sql.gz`,
        );
        fs.writeFileSync(f, 'gia-vo-la-backup');
        const t = new Date(now - i * NGAY - 60_000);
        fs.utimesSync(f, t, t);
      }
      // Một file KHÔNG phải backup, rất cũ. Nó phải sống sót — prune không được
      // đụng tới thứ không thuộc về nó.
      const laMat = path.join(TMP_ABS, 'khong-phai-backup.txt');
      fs.writeFileSync(laMat, 'dung dung vao toi');
      const cu = new Date(now - 999 * NGAY);
      fs.utimesSync(laMat, cu, cu);

      const r = spawnSync(bash, ['scripts/backup-mysql.sh', '--prune-only'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, BACKUP_DIR: TMP_REL, RETENTION_DAYS: '14' },
      });

      if (r.status !== 0) {
        bad(
          `chạy \`backup-mysql.sh --prune-only\` thoát mã ${r.status}: ` +
            `${(r.stderr ?? '').trim().split('\n').slice(0, 3).join(' | ')}`,
        );
      } else {
        const conLai = fs.readdirSync(TMP_ABS);
        const conBackup = conLai.filter((f) => f.endsWith('.sql.gz'));
        conBackup.length === 14
          ? ok(`giữ đúng 14 bản gần nhất (còn ${conBackup.length}/20)`)
          : bad(`giữ SAI: còn ${conBackup.length} bản .sql.gz, đáng lẽ 14`);

        conLai.includes('khong-phai-backup.txt')
          ? ok('file không phải backup KHÔNG bị đụng tới')
          : bad('prune đã XOÁ file không thuộc về nó — phạm vi quá rộng');
      }
    } finally {
      fs.rmSync(TMP_ABS, { recursive: true, force: true });
    }
  }

  // ── 6. Script khôi phục (R9) ────────────────────────────────────────────
  //
  // Diễn tập khôi phục mà restore đè lên chính database đang chạy thì không
  // phải diễn tập, đó là sự cố tự gây ra.
  console.log('\n\x1b[1m— 6. Script khôi phục có chốt an toàn —\x1b[0m');

  /--force|FORCE/.test(restoreCode)
    ? ok('có cờ --force: đè lên database đang chạy phải nói rõ ràng ra')
    : bad('KHÔNG có chốt --force — restore có thể đè database production trong im lặng');

  /gunzip|zcat|gzip\s+-d/.test(restoreCode)
    ? ok('đọc được file .sql.gz đã nén')
    : bad('không thấy chỗ giải nén — backup lưu dạng .gz');

  /drill|DRILL/.test(restoreCode)
    ? ok('có khái niệm database diễn tập tách riêng (task #25)')
    : bad('không thấy đường restore vào database diễn tập riêng');

  // ── 7. Cron: hướng dẫn cài phải nằm cạnh script ─────────────────────────
  console.log('\n\x1b[1m— 7. Hướng dẫn cài cron —\x1b[0m');
  /crontab/.test(backup)
    ? ok('script có ghi cách cài vào crontab')
    : bad('script không ghi cách cài cron — người deploy phải tự đoán');

  // ── Tổng kết ────────────────────────────────────────────────────────────
  console.log('');
  if (failures === 0) {
    console.log('\x1b[32m\x1b[1m═══ TẤT CẢ PASS ✓ ═══\x1b[0m');
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1m═══ ${failures} MỤC FAIL ═══\x1b[0m`);
  process.exit(1);
}

main();
