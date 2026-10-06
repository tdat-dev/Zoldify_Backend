#!/usr/bin/env node
/**
 * Sinh 11-deployment-diagram.drawio: UML deployment diagram của hệ thống đang
 * chạy thật (prod = staging, docker-compose.yml + web compose trên cùng VPS).
 *
 *   node «device» / «executionEnvironment» : hộp 3D, lồng nhau
 *   «artifact»                            : thứ được triển khai lên node đó
 *   đường liền có nhãn                     : communication path, ghi giao thức
 *
 * Toạ độ đặt tay; bộ kiểm của drawio-grid từ chối ghi khi đường cắt nhau hay đâm
 * xuyên một node lá.
 *
 *   node scripts/drawio-deployment.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './drawio-lib.mjs';
import { page, check, frame, writePages, FONT } from './drawio-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '11-deployment-diagram.drawio');

const pg = page('Deployment');

/**
 * Node UML (hộp 3D). `leaf` = node không chứa node con: đăng ký để bộ kiểm biết
 * không đường nào được đi xuyên qua nó.
 */
function node(key, stereo, name, x, y, w, h, { leaf = false, body = '', valign = 'top' } = {}) {
  const label = `«${esc(stereo)}»&lt;br&gt;&lt;b&gt;${esc(name)}&lt;/b&gt;${body ? `&lt;br&gt;&lt;font style=&quot;font-size:10px&quot;&gt;${esc(body).replace(/\n/g, '&lt;br&gt;')}&lt;/font&gt;` : ''}`;
  pg.cells.push(
    `<mxCell id="${key}" value="${label}" style="shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;darkOpacity=0.05;darkOpacity2=0.1;size=10;verticalAlign=${valign};align=left;spacingLeft=8;spacingTop=4;spacingBottom=6;fontSize=11;fillColor=#FFFFFF;strokeColor=#000000;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  );
  if (leaf) pg.boxes[key] = { x, y, w, h };
  return { x, y, w, h };
}

function note(text, x, y, w, h) {
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${esc(text)}" style="shape=note;whiteSpace=wrap;html=1;size=12;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=8;fillColor=#FFFFFF;strokeColor=#000000;fontSize=11;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  );
  pg.boxes[`note-${y}-${x}`] = { x, y, w, h };
}

/** Communication path: đường liền đặt toạ độ tuyệt đối, nhãn là giao thức. */
function path_(a, b, pts, label = '', labelAt = 0) {
  const inner = pts.slice(1, -1).map(([px, py]) => `<mxPoint x="${px}" y="${py}"/>`).join('');
  const off = labelAt ? ` x="${labelAt}"` : '';
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${esc(label)}" style="edgeStyle=none;html=1;rounded=0;endArrow=none;strokeColor=#000000;fontSize=10;labelBackgroundColor=#FFFFFF;${FONT}" edge="1" parent="1">` +
      `<mxGeometry${off} relative="1" as="geometry"><mxPoint x="${pts[0][0]}" y="${pts[0][1]}" as="sourcePoint"/><mxPoint x="${pts[pts.length - 1][0]}" y="${pts[pts.length - 1][1]}" as="targetPoint"/>${inner ? `<Array as="points">${inner}</Array>` : ''}</mxGeometry></mxCell>`,
  );
  for (let i = 1; i < pts.length; i++) pg.segs.push({ a, b, p: pts[i - 1], q: pts[i] });
}

// ---------------------------------------------------------------- clients
const phone = node('phone', 'device', 'Điện thoại Android', 40, 200, 220, 130, { leaf: true, body: 'artifact: zoldify-mobile.apk\n(Expo / React Native)\nGoogle Sign-In + Firebase Auth\nnhận push FCM' });
const pc = node('pc', 'device', 'Máy tính', 40, 420, 220, 130, { leaf: true, body: 'Trình duyệt web\nchạy trang Next.js của\nzoldify.com, admin.zoldify.com' });

// ---------------------------------------------------------------- cloudflare
node('cf', 'cloud service', 'Cloudflare', 330, 160, 240, 430, { body: 'DNS *.zoldify.com, proxy (orange cloud)\nSSL mode Full' });
const cfCdn = node('cfCdn', 'executionEnvironment', 'Edge proxy / CDN', 345, 245, 210, 80, { leaf: true, body: 'api., www, admin., staging.*' });
const r2 = node('r2', 'executionEnvironment', 'R2 Object Storage', 345, 355, 210, 110, { leaf: true, body: 'bucket zoldify-images\n(img.zoldify.com)\nbucket zoldify-backups' });
const ai = node('ai', 'executionEnvironment', 'Workers AI', 345, 495, 210, 70, { leaf: true, body: 'm2m100: dịch tên danh mục' });

// ---------------------------------------------------------------- vps
node('vps', 'device', 'VPS Ubuntu 22.04 (103.249.117.151)', 640, 60, 900, 940);
const nginx = node('nginx', 'executionEnvironment', 'nginx (TLS Let\'s Encrypt)', 680, 110, 640, 90, { leaf: true, body: ':443 → 127.0.0.1:3001 web, :3002 admin, :3000 api (prod)\nstaging: :3101 / :3102 / :3100' });
// label at the bottom: nginx's connectors come in through the top edge
node('docker', 'executionEnvironment', 'Docker Engine (docker compose)', 680, 240, 830, 600, { valign: 'bottom' });

const CW = 170, CH = 100;
const cx = [710, 910, 1110, 1310];
const ry = [300, 450, 640];
const ctr = (key, name, col, row, body) => node(key, 'container', name, cx[col], ry[row], CW, CH, { leaf: true, body });
const web = ctr('web', 'web-frontend', 0, 0, 'Next.js 14 standalone\n:3001');
const admin = ctr('admin', 'web-admin', 1, 0, 'Next.js 14 standalone\n:3002');
const api = ctr('api', 'api', 2, 0, 'NestJS :3000, REST + Socket.IO\nảnh lên R2, dịch qua Workers AI');
const worker = ctr('worker', 'worker', 3, 0, 'BullMQ: huy-don-qua-han,\nchot-van-don');
const migrate = ctr('migrate', 'migrate', 0, 1, 'typeorm migration:run\n(chạy xong rồi tắt)');
const backup = ctr('backup', 'backup', 1, 1, 'mysqldump mỗi 24h\ngiữ 14 ngày');
const mysql = ctr('mysql', 'mysql', 2, 1, 'MySQL 8, DB zoldify\nvolume mysql-data');
const redis = ctr('redis', 'redis', 3, 1, 'Redis 7\ncache + hàng đợi');
const offsite = ctr('offsite', 'offsite', 1, 2, 'rclone mỗi 6h\nchép bản backup lên R2');

note('Staging chạy bộ container y hệt trên cùng VPS (project zoldify-staging, cổng 3100-3102), DB và volume riêng.', 680, 870, 520, 50);

// ---------------------------------------------------------------- external systems
const EX = 1620, EW = 220, EH = 90;
const ext = (key, name, y, body) => node(key, 'external system', name, EX, y, EW, EH, { leaf: true, body });
const payos = ext('payos', 'PayOS', 120, 'cổng thanh toán QR');
const ghn = ext('ghn', 'GHN (dev-online-gateway)', 250, 'phí ship, vận đơn');
const fb = ext('fb', 'Firebase', 380, 'xác thực idToken, đẩy FCM');
const smtp = ext('smtp', 'SMTP', 510, 'gửi mail OTP');

// ---------------------------------------------------------------- ci/cd
const gh = node('gh', 'executionEnvironment', 'GitHub Actions', 640, 1060, 420, 100, { leaf: true, body: 'deploy.yml: npm ci, npm run build\nrồi SSH vào VPS: git checkout -B (nhánh), docker compose up -d --build' });

// ---------------------------------------------------------------- communication paths
const R = (b) => b.x + b.w, B = (b) => b.y + b.h, X = (b) => b.x + b.w / 2, Y = (b) => b.y + b.h / 2;
path_('phone', 'cfCdn', [[R(phone), 270], [cfCdn.x, 270]], 'HTTPS, WSS');
path_('pc', 'cfCdn', [[R(pc), 485], [315, 485], [315, 290], [cfCdn.x, 290]], 'HTTPS');
path_('cfCdn', 'nginx', [[R(cfCdn), 265], [610, 265], [610, 155], [nginx.x, 155]], 'HTTPS :443');
path_('nginx', 'web', [[X(web), B(nginx)], [X(web), web.y]], 'HTTP');
path_('nginx', 'admin', [[X(admin), B(nginx)], [X(admin), admin.y]], 'HTTP');
path_('nginx', 'api', [[X(api), B(nginx)], [X(api), api.y]], 'HTTP, WS');
path_('api', 'mysql', [[X(api), B(api)], [X(api), mysql.y]], 'TCP 3306');
path_('worker', 'redis', [[X(worker), B(worker)], [X(worker), redis.y]], 'TCP 6379');
path_('api', 'redis', [[R(api), 370], [1295, 370], [1295, 500], [redis.x, 500]], '');
path_('worker', 'mysql', [[R(worker), 340], [1495, 340], [1495, 600], [X(mysql), 600], [X(mysql), B(mysql)]], '');
path_('backup', 'mysql', [[R(backup), 500], [mysql.x, 500]], 'dump');
path_('migrate', 'mysql', [[X(migrate), B(migrate)], [X(migrate), 615], [1170, 615], [1170, B(mysql)]], '');
path_('offsite', 'r2', [[offsite.x, 690], [660, 690], [660, 420], [R(r2), 420]], 'HTTPS (S3 API)');
for (const [key, b, label] of [['payos', payos, 'HTTPS, webhook'], ['ghn', ghn, 'HTTPS'], ['fb', fb, 'HTTPS'], ['smtp', smtp, 'SMTP TLS']]) {
  path_('api', key, [[1540, Y(b)], [EX, Y(b)]], label);
}
path_('gh', 'nginx', [[X(gh), gh.y], [X(gh), 1000]], 'SSH');

check(pg);
frame(pg, 'deployment Zoldify (production)');
writePages(OUT, [pg]);
