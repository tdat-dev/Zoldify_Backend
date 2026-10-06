/**
 * Đọc các entity TypeORM (src/**\/entities/*.entity.ts) ra mô hình bảng cho ERD:
 * tên bảng, cột thật trong DB (kiểu, độ dài, NULL, UNIQUE, PK), khoá ngoại và bảng
 * nó trỏ tới. ERD vẽ từ đây nên khớp schema, không gõ tay.
 *
 * Chỉ hiểu đúng những decorator dự án đang dùng; gặp kiểu lạ thì giữ nguyên chữ.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Lấy nội dung trong cặp ngoặc cân bằng bắt đầu ở vị trí `open` (ký tự '('). */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return [src.slice(open + 1, i), i + 1];
  }
  throw new Error('ngoặc không cân');
}

const opt = (args, key) => {
  const m = args.match(new RegExp(`\\b${key}\\s*:\\s*('([^']*)'|"([^"]*)"|([\\w.]+))`));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
};

function sqlType(args, tsType) {
  const t = (opt(args, 'type') || '').toLowerCase();
  const len = opt(args, 'length');
  if (t === 'decimal') return `DECIMAL(${opt(args, 'precision') || 10},${opt(args, 'scale') || 0})`;
  if (t === 'enum') return 'ENUM';
  if (t === 'varchar' || t === 'char') return `${t.toUpperCase()}(${len || 255})`;
  if (t) return t.toUpperCase();
  if (tsType === 'number') return 'INT';
  if (tsType === 'boolean') return 'TINYINT(1)';
  if (tsType === 'Date') return 'DATETIME';
  return 'VARCHAR(255)';
}

export function readEntities(srcRoot) {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.entity\.ts$/.test(e.name) && p.includes(`${path.sep}entities${path.sep}`)) files.push(p);
  });
  walk(srcRoot);

  const tables = {}; // tableName -> { cls, columns: [], uniques: [] }
  const classToTable = {};
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const ent = src.match(/@Entity\(\s*'([^']+)'/);
    const cls = src.match(/export class (\w+)/);
    if (!ent || !cls) continue; // stub class, not a table
    classToTable[cls[1]] = ent[1];
    const t = { cls: cls[1], columns: [], uniques: [] };
    for (const m of src.matchAll(/@Unique\(\s*(?:'[^']*'\s*,\s*)?\[([^\]]+)\]/g)) t.uniques.push(m[1].replace(/['\s]/g, '').split(','));
    for (const m of src.matchAll(/@Index\(\s*'[^']*'\s*,\s*\[([^\]]+)\]\s*,\s*\{\s*unique:\s*true/g)) t.uniques.push(m[1].replace(/['\s]/g, '').split(','));

    // walk decorators inside the class body, grouping them per property
    const body = src.slice(src.indexOf(cls[0]));
    let i = 0, pending = [];
    while (i < body.length) {
      const at = body.indexOf('@', i);
      if (at < 0) break;
      const dm = body.slice(at).match(/^@(\w+)\(/);
      if (!dm) { i = at + 1; continue; }
      const [args, end] = balanced(body, at + dm[0].length - 1);
      pending.push({ name: dm[1], args });
      const after = body.slice(end);
      const next = after.match(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*\s*(@|(\w+)\s*[!?]?\s*:\s*([^;=]+)[;=])/);
      i = end;
      if (next && next[1] !== '@' && next[2]) {
        addColumn(t, pending, next[2], next[3].trim());
        pending = [];
        i = end + next[0].length;
      }
    }
    tables[ent[1]] = t;
  }
  for (const t of Object.values(tables)) {
    for (const c of t.columns) {
      if (!c.refClass) continue;
      c.ref = classToTable[c.refClass];
      // a foreign key has the type of the primary key it points to
      const pk = tables[c.ref]?.columns.find((k) => k.pk);
      if (pk) c.type = pk.type;
    }
    // composite UNIQUE is declared on relation properties: show the real column names
    const byProp = Object.fromEntries(t.columns.filter((c) => c.prop).map((c) => [c.prop, c.name]));
    t.uniques = t.uniques.map((u) => u.map((n) => byProp[n] || n));
  }
  return tables;
}

function addColumn(t, decos, prop, tsType) {
  const by = (n) => decos.find((d) => d.name === n);
  const join = by('JoinColumn');
  const rel = by('ManyToOne') || by('OneToOne');
  if (by('OneToMany') || by('ManyToMany')) return;
  if (rel) {
    if (!join) return; // inverse side of a one-to-one
    const refClass = (rel.args.match(/=>\s*(\w+)/) || [])[1];
    const name = opt(join.args, 'name') || `${prop}Id`;
    if (t.columns.some((c) => c.name === name)) { const ex = t.columns.find((c) => c.name === name); ex.refClass = refClass; ex.fk = true; return; }
    t.columns.push({ name, prop, type: 'INT', fk: true, refClass, unique: rel.name === 'OneToOne', nullable: /nullable\s*:\s*true/.test(rel.args) || /SET NULL/.test(rel.args), onDelete: opt(rel.args, 'onDelete') });
    return;
  }
  const pk = by('PrimaryGeneratedColumn');
  if (pk) { t.columns.push({ name: prop, type: /bigint/.test(pk.args) ? 'BIGINT' : 'INT', pk: true }); return; }
  for (const k of ['CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn']) if (by(k)) { t.columns.push({ name: opt(by(k).args, 'name') || prop, type: 'DATETIME', nullable: k === 'DeleteDateColumn', audit: true }); return; }
  if (by('VersionColumn')) { t.columns.push({ name: prop, type: 'INT' }); return; }
  const col = by('Column');
  if (!col) return;
  t.columns.push({
    name: opt(col.args, 'name') || prop,
    type: sqlType(col.args, tsType.replace(/\s*\|\s*null/, '')),
    nullable: /nullable\s*:\s*true/.test(col.args),
    unique: /unique\s*:\s*true/.test(col.args),
  });
}

if (process.argv[1] && process.argv[1].endsWith('drawio-erd-model.mjs')) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'src');
  const tables = readEntities(root);
  for (const [name, t] of Object.entries(tables)) {
    console.log(`\n${name} (${t.cls})${t.uniques.length ? '  UQ' + JSON.stringify(t.uniques) : ''}`);
    for (const c of t.columns) console.log(`  ${c.pk ? 'PK ' : c.fk ? 'FK ' : '   '}${c.name} ${c.type}${c.nullable ? ' NULL' : ''}${c.unique ? ' UQ' : ''}${c.ref ? ' -> ' + c.ref : ''}${c.audit ? ' (audit)' : ''}`);
  }
}
