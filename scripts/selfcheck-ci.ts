/**
 * BỘ TỰ KIỂM CI (task #4 bảng phân công) — viết TEST TRƯỚC.
 *
 * Chạy:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck-ci.ts
 *   npm run check:ci
 *
 * VÌ SAO CẦN BÀI TEST NÀY, TRONG KHI "CI TỰ NÓ ĐÃ LÀ TEST".
 *
 * Một workflow hỏng KHÔNG kêu. Nó vẫn hiện dấu tích xanh. Ba kiểu hỏng câm mà
 * repo này dính được ngay:
 *
 *   1. `npm run lint` ở đây là `eslint --fix`. Cắm thẳng vào CI thì trên runner
 *      nó SỬA file rồi thoát mã 0 — xanh, mà nợ lint không bao giờ lộ. Cổng
 *      lint biến thành đồ trang trí và không ai biết.
 *   2. Gõ nhầm tên script (`npm run openapi-check`) → npm thoát mã khác 0 với
 *      thông báo "Missing script", job đỏ vì lý do chẳng liên quan tới chất
 *      lượng mã.
 *   3. Job chạy `npm test` mà quên khai service mysql → 5 spec tiền đỏ mãi mãi,
 *      cả nhóm quen nhìn dấu X rồi bỏ qua CI luôn.
 *
 * Nên bài test hỏi về HỢP ĐỒNG của workflow, đọc từ chính file YAML: đủ cổng
 * chưa, cổng có gọi đúng script có thật không, cổng lint có bị --fix vô hiệu
 * hoá không, job nào cần database thì đã khai chưa. Trả lời được mà KHÔNG cần
 * database, không cần mạng, không cần đợi GitHub chạy.
 *
 * Ranh giới của nó: file này kiểm workflow NÓI đúng thứ cần nói. Việc workflow
 * CHẠY được thật thì chỉ có GitHub trả lời — nghiệm thu cuối là nhìn CI xanh
 * trên chính PR của nhánh này.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.join(__dirname, '..');
const CI_PATH = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const DEPLOY_PATH = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
const PKG_PATH = path.join(ROOT, 'package.json');

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

// ── Kiểu tối thiểu của một workflow, chỉ khai phần bài test thật sự đụng tới ──
interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  steps?: Step[];
  services?: Record<string, unknown>;
}
interface Workflow {
  on?: Record<string, any>;
  jobs?: Record<string, Job>;
  concurrency?: unknown;
}

/** Mọi lệnh `run:` trong một job. */
function runsOf(job: Job): string[] {
  return (job.steps ?? [])
    .filter((s) => typeof s.run === 'string')
    .map((s) => s.run as string);
}

/**
 * Tên các script npm mà một chuỗi lệnh gọi: "npm run build" -> ["build"].
 *
 * Phải bắt CẢ hai lối viết, nếu không bài test nói dối. `npm test` là lối tắt
 * có sẵn của npm cho `npm run test` và là cách viết thông dụng hơn — bản đầu
 * của hàm này chỉ bắt `npm run …` nên báo "THIẾU cổng test" trong khi workflow
 * có chạy test thật. Lỗi nằm ở bài test chứ không ở workflow.
 *
 * Chỉ nhận đúng ba lối tắt npm thật sự có (`test`, `t`, `start`). KHÔNG được
 * quét chung chung kiểu `npm <chữ>`, nếu không `npm ci` bị hiểu nhầm thành
 * script tên "ci" rồi báo thiếu trong package.json.
 */
function npmScriptsIn(cmd: string): string[] {
  const out: string[] = [];
  // `npm run x`, `npm run-script x`, kèm cờ phía sau như --if-present.
  const chay = /npm\s+run(?:-script)?\s+([a-zA-Z0-9:_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = chay.exec(cmd)) !== null) out.push(m[1]);

  // Lối tắt: `npm test`, `npm t`, `npm start`.
  const tat = /npm\s+(test|t|start)\b/g;
  while ((m = tat.exec(cmd)) !== null) out.push(m[1] === 't' ? 'test' : m[1]);

  return [...new Set(out)];
}

/** node-version khai trong các bước actions/setup-node của một workflow. */
function nodeVersionsOf(wf: Workflow): string[] {
  const found: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (
        typeof step.uses === 'string' &&
        step.uses.startsWith('actions/setup-node')
      ) {
        const v = step.with?.['node-version'];
        if (v !== undefined) found.push(String(v));
      }
    }
  }
  return found;
}

function main(): void {
  console.log('\x1b[1m═══ TỰ KIỂM CI (task #4) — test trước ═══\x1b[0m\n');

  // ── 1. File tồn tại và parse được ─────────────────────────────────────────
  // Đặt trước mọi thứ: thiếu file thì các kiểm sau vô nghĩa, dừng luôn cho gọn.
  if (!fs.existsSync(CI_PATH)) {
    bad('.github/workflows/ci.yml chưa tồn tại');
    console.log(
      '\n\x1b[31m═══ ĐỎ — chưa có workflow CI. Đây là trạng thái ĐÚNG trước khi làm. ═══\x1b[0m',
    );
    process.exit(1);
  }
  ok('.github/workflows/ci.yml tồn tại');

  let wf: Workflow;
  try {
    wf = yaml.load(fs.readFileSync(CI_PATH, 'utf8')) as Workflow;
  } catch (e) {
    bad(`ci.yml KHÔNG parse được thành YAML hợp lệ: ${(e as Error).message}`);
    process.exit(1);
  }
  if (!wf || !wf.jobs || Object.keys(wf.jobs).length === 0) {
    bad('ci.yml parse được nhưng không có job nào');
    process.exit(1);
  }
  ok(
    `ci.yml parse hợp lệ — ${Object.keys(wf.jobs).length} job: ${Object.keys(wf.jobs).join(', ')}`,
  );

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) as {
    scripts: Record<string, string>;
  };
  const allRuns = Object.values(wf.jobs).flatMap(runsOf);
  const allScripts = [...new Set(allRuns.flatMap(npmScriptsIn))];

  // ── 2. Đủ 6 cổng mà bảng phân công yêu cầu ────────────────────────────────
  // Nguồn: docs/system-design/2026-08-08-phan-cong-4-nguoi.md, task #4 —
  // "lint · boundaries · test · build · openapi:check · diagrams:check".
  console.log('\n\x1b[1m— 6 cổng theo bảng phân công —\x1b[0m');
  const gates: Array<{ ten: string; khop: (s: string) => boolean }> = [
    { ten: 'lint', khop: (s) => s === 'lint' || s === 'lint:check' },
    { ten: 'boundaries', khop: (s) => s === 'boundaries:check' },
    { ten: 'test', khop: (s) => s === 'test' || s.startsWith('test:') },
    { ten: 'build', khop: (s) => s === 'build' },
    { ten: 'openapi:check', khop: (s) => s === 'openapi:check' },
    {
      ten: 'diagrams:check',
      khop: (s) => s === 'diagrams:check' || s === 'drawio:check',
    },
  ];
  for (const g of gates) {
    const hit = allScripts.filter(g.khop);
    if (hit.length > 0) {
      ok(`cổng ${g.ten} — gọi qua: ${hit.map((h) => `npm run ${h}`).join(', ')}`);
    } else {
      bad(`THIẾU cổng ${g.ten}`);
    }
  }

  // ── 3. Mọi script được gọi phải CÓ THẬT trong package.json ────────────────
  // Gõ nhầm tên script chỉ lộ ra lúc CI chạy, và lộ dưới dạng job đỏ vì
  // "Missing script" — thông báo chẳng nói gì về chất lượng mã.
  console.log('\n\x1b[1m— script được gọi có thật không —\x1b[0m');
  for (const s of allScripts) {
    if (pkg.scripts[s]) ok(`npm run ${s} → có trong package.json`);
    else bad(`npm run ${s} → KHÔNG có script này trong package.json (gõ nhầm?)`);
  }

  // ── 4. Cổng lint không được bị --fix vô hiệu hoá (chốt R1) ────────────────
  console.log('\n\x1b[1m— cổng lint có thật sự chặn không (R1) —\x1b[0m');
  const lintScripts = allScripts.filter((s) => s === 'lint' || s === 'lint:check');
  if (lintScripts.length === 0) {
    bad('không có cổng lint nào để kiểm');
  } else {
    for (const s of lintScripts) {
      const def = pkg.scripts[s] ?? '';
      if (/--fix\b/.test(def)) {
        bad(
          `npm run ${s} = "${def}" — có --fix. Trên CI nó SỬA file rồi vẫn thoát 0, ` +
            'cổng lint thành trang trí. Dùng một script riêng không --fix.',
        );
      } else {
        ok(`npm run ${s} không dùng --fix — báo lỗi thay vì tự sửa`);
      }
    }
  }

  // ── 5. Job chạy `npm test` phải khai service mysql (chốt R2) ──────────────
  // 5 spec tiền (escrows, ledger, payos, withdrawals, tasks) chạy trên MySQL
  // THẬT, dùng chung database zoldify_test — xem ghi chú maxWorkers trong
  // jest.config.js. Runner sạch không có MySQL thì chúng đỏ 100%.
  console.log('\n\x1b[1m— job chạy test có database không (R2) —\x1b[0m');
  const testJobs = Object.entries(wf.jobs).filter(([, j]) =>
    runsOf(j).some((r) =>
      npmScriptsIn(r).some((s) => s === 'test' || s.startsWith('test:')),
    ),
  );
  if (testJobs.length === 0) {
    bad('không job nào chạy npm test');
  } else {
    for (const [name, job] of testJobs) {
      const svc = Object.keys(job.services ?? {});
      if (svc.some((s) => /mysql|mariadb/i.test(s))) {
        ok(`job "${name}" khai service database: ${svc.join(', ')}`);
      } else {
        bad(
          `job "${name}" chạy npm test nhưng KHÔNG khai service mysql — ` +
            '5 spec tiền sẽ đỏ vĩnh viễn',
        );
      }
    }
  }

  // ── 6. node-version khớp deploy.yml (chốt R3) ─────────────────────────────
  // openapi:check so `openapi.json` trong git với bản sinh lại. Sinh bằng Node
  // khác phiên bản với lúc commit thì rất dễ lệch định dạng → CI đỏ GIẢ, không
  // ai đổi API mà vẫn đỏ. Neo vào đúng phiên bản deploy.yml đang dùng.
  console.log('\n\x1b[1m— phiên bản Node khớp deploy.yml (R3) —\x1b[0m');
  const ciNodes = [...new Set(nodeVersionsOf(wf))];
  if (ciNodes.length === 0) {
    bad(
      'ci.yml không khai node-version ở bước setup-node — runner đổi mặc định là CI đổi theo',
    );
  } else if (!fs.existsSync(DEPLOY_PATH)) {
    ok(`ci.yml pin node-version ${ciNodes.join(', ')} (không có deploy.yml để đối chiếu)`);
  } else {
    const dep = yaml.load(fs.readFileSync(DEPLOY_PATH, 'utf8')) as Workflow;
    const depNodes = [...new Set(nodeVersionsOf(dep))];
    const lech = ciNodes.filter((v) => !depNodes.includes(v));
    if (depNodes.length === 0) {
      ok(`ci.yml pin node-version ${ciNodes.join(', ')}`);
    } else if (lech.length === 0) {
      ok(`node-version khớp deploy.yml: ${ciNodes.join(', ')}`);
    } else {
      bad(
        `ci.yml dùng Node ${ciNodes.join(', ')} còn deploy.yml dùng ${depNodes.join(', ')} — ` +
          'build ở hai nơi hai kiểu, openapi:check dễ đỏ giả',
      );
    }
  }

  // ── 7. Kích hoạt đúng chỗ (chốt R6) ───────────────────────────────────────
  // Chạy trên MỌI push của MỌI nhánh thì vừa đốt phút Actions vừa trùng với
  // deploy.yml (vốn đã build khi push staging). CI cần chạy ở nơi nó có tác
  // dụng nhất: pull request.
  console.log('\n\x1b[1m— chạy đúng lúc (R6) —\x1b[0m');
  const on = wf.on ?? {};
  if ('pull_request' in on) {
    ok('có on.pull_request — CI chạy trên PR, đúng chỗ nó có tác dụng');
  } else {
    bad('KHÔNG có on.pull_request — merge vào staging mà không cổng nào chặn trước');
  }

  const push = on['push'];
  if (push === undefined) {
    ok('không chạy trên push — mọi kiểm nằm ở PR');
  } else if (push && Array.isArray(push.branches) && push.branches.length > 0) {
    ok(`push giới hạn ở nhánh: ${push.branches.join(', ')}`);
  } else {
    bad(
      'on.push không giới hạn nhánh — chạy trên mọi push của mọi nhánh, đốt phút Actions',
    );
  }

  if (wf.concurrency) ok('có concurrency — push liên tiếp huỷ lần chạy cũ');
  else bad('thiếu concurrency — đẩy 3 commit liên tiếp là 3 lần chạy song song vô ích');

  // ── Tổng kết ──────────────────────────────────────────────────────────────
  console.log('');
  if (failures === 0) {
    console.log('\x1b[32m\x1b[1m═══ TẤT CẢ PASS ✓ — hợp đồng CI đầy đủ ═══\x1b[0m');
    console.log(
      '\x1b[2mNghiệm thu cuối vẫn là nhìn CI chạy xanh thật trên PR của nhánh này.\x1b[0m',
    );
  } else {
    console.log(`\x1b[31m\x1b[1m═══ ${failures} FAIL — xem chi tiết phía trên ═══\x1b[0m`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
