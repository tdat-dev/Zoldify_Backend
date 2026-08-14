/**
 * Bộ dựng file .drawio (định dạng mxGraph XML).
 *
 * Vì sao không dùng Mermaid cho sáu sơ đồ bảo vệ: Mermaid không vẽ được ký
 * pháp UML chuẩn — actor phải là hình người que, node triển khai phải là hộp
 * 3D, fork/join phải là thanh đậm. Mermaid vẽ tất cả bằng hộp chữ nhật. Thầy
 * chấm ký pháp, nên ba chỗ đó là mất điểm thật.
 *
 * draw.io có sẵn shape UML cho cả ba. File sinh ra mở thẳng bằng draw.io và
 * sửa tay được như mọi file vẽ tay khác.
 */

/** Escape cho thuộc tính XML. draw.io lưu nhãn trong thuộc tính `value`. */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Nhãn hiển thị, đổi ký tự xuống dòng thành thẻ ngắt dòng của HTML.
 *
 * Nhãn đi qua HAI lần giải mã: draw.io đọc thuộc tính XML trước, rồi vì mọi
 * style ở đây bật `html=1` nên nó đọc kết quả đó như HTML. Cho nên phải ghi
 * `&lt;br&gt;` chứ KHÔNG phải `<br>` — dấu `<` thô nằm trong thuộc tính là XML
 * hỏng, draw.io từ chối mở cả file với thông báo "Not a diagram file".
 */
export function escLabel(s) {
  return esc(s).replace(/\r?\n/g, '&lt;br&gt;');
}

/** Bộ đếm id, mỗi sơ đồ một bộ riêng */
export function createSheet(name) {
  return { name, cells: [], seq: 0, nextId() { return `n${++this.seq}`; } };
}

export function vertex(sheet, { id, value = '', style, x, y, w, h, parent = '1' }) {
  const cid = id || sheet.nextId();
  sheet.cells.push(
    `<mxCell id="${cid}" value="${escLabel(value)}" style="${style}" vertex="1" parent="${parent}">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>` +
      `</mxCell>`,
  );
  return cid;
}

export function edge(sheet, { source, target, value = '', style, parent = '1', points }) {
  const cid = sheet.nextId();
  const geo = points?.length
    ? `<mxGeometry relative="1" as="geometry"><Array as="points">` +
      points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('') +
      `</Array></mxGeometry>`
    : `<mxGeometry relative="1" as="geometry"/>`;
  sheet.cells.push(
    `<mxCell id="${cid}" value="${escLabel(value)}" style="${style}" edge="1" parent="${parent}" ` +
      `source="${source}" target="${target}">${geo}</mxCell>`,
  );
  return cid;
}

/**
 * Cạnh đặt bằng toạ độ tuyệt đối, không gắn vào node nào.
 *
 * Sequence diagram cần đúng cách này: thông điệp phải nằm ở một độ cao xác
 * định trên trục thời gian. Nối vào hộp kích hoạt rồi để draw.io tự định
 * tuyến sẽ cho ra một mớ đường vòng.
 */
export function edgeAt(sheet, { x1, y1, x2, y2, value = '', style, parent = '1' }) {
  const cid = sheet.nextId();
  sheet.cells.push(
    `<mxCell id="${cid}" value="${escLabel(value)}" style="${style}" edge="1" parent="${parent}">` +
      `<mxGeometry relative="1" as="geometry">` +
      `<mxPoint x="${x1}" y="${y1}" as="sourcePoint"/>` +
      `<mxPoint x="${x2}" y="${y2}" as="targetPoint"/>` +
      `</mxGeometry></mxCell>`,
  );
  return cid;
}

/** Gói nhiều sheet thành một file .drawio nhiều tab */
export function buildFile(sheets, { width = 1600, height = 1100 } = {}) {
  const diagrams = sheets
    .map(
      (s, i) =>
        `  <diagram id="d${i + 1}" name="${esc(s.name)}">\n` +
        `    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" ` +
        `connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${width}" ` +
        `pageHeight="${height}" math="0" shadow="0">\n` +
        `      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
        s.cells.map((c) => '        ' + c).join('\n') +
        `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
    )
    .join('\n');
  return `<mxfile host="app.diagrams.net" type="device">\n${diagrams}\n</mxfile>\n`;
}

// ---------------------------------------------------------------------------
// Style UML. Gom vào một chỗ để đổi diện mạo cả bộ chỉ sửa một dòng.
// ---------------------------------------------------------------------------

export const S = {
  /** Hình người que — bắt buộc cho actor trong Use Case Diagram */
  actor:
    'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;' +
    'outlineConnect=0;fontSize=13;',

  /** Bầu dục — bắt buộc cho use case */
  useCase: 'ellipse;whiteSpace=wrap;html=1;fontSize=12;fillColor=#f5f5f5;strokeColor=#666666;',

  /** Khung hệ thống bao quanh các use case */
  boundary:
    'rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;fillColor=none;' +
    'strokeColor=#333333;fontSize=14;fontStyle=1;',

  /** Hộp 3D — bắt buộc cho node trong Deployment Diagram */
  node3d:
    'shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;' +
    'darkOpacity=0.05;darkOpacity2=0.1;verticalAlign=top;align=left;spacingLeft=12;' +
    'spacingTop=6;size=12;fontSize=12;fontStyle=1;fillColor=#f0f4fa;strokeColor=#33587a;',

  /** Artifact nằm trong node triển khai */
  artifact:
    'html=1;whiteSpace=wrap;shape=note;size=14;verticalAlign=top;align=left;' +
    'spacingLeft=6;fontSize=11;fillColor=#ffffff;strokeColor=#999999;',

  /** Component UML2 — hộp có hai tai bên trái */
  component:
    'html=1;dropTarget=0;whiteSpace=wrap;shape=module;align=left;spacingLeft=30;' +
    'fontSize=12;fillColor=#eef6ff;strokeColor=#33587a;',

  /** Nút bắt đầu của Activity Diagram */
  initial: 'ellipse;html=1;fillColor=#000000;strokeColor=none;',

  /** Nút kết thúc — vòng tròn có viền */
  final: 'ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#000000;',

  /** Hành động — chữ nhật bo tròn */
  action:
    'rounded=1;arcSize=40;whiteSpace=wrap;html=1;fontSize=12;' +
    'fillColor=#ffffff;strokeColor=#333333;',

  /** Hành động đã hiện thực xong — tô xanh để đọc tiến độ */
  actionDone:
    'rounded=1;arcSize=40;whiteSpace=wrap;html=1;fontSize=12;' +
    'fillColor=#d5f5dd;strokeColor=#2e7d32;',

  /** Hành động chưa làm */
  actionTodo:
    'rounded=1;arcSize=40;whiteSpace=wrap;html=1;fontSize=12;' +
    'fillColor=#ffe0e0;strokeColor=#c62828;',

  /** Rẽ nhánh — hình thoi */
  decision: 'rhombus;whiteSpace=wrap;html=1;fontSize=11;fillColor=#fff8e1;strokeColor=#b8860b;',

  /** Thanh fork/join — bắt buộc là THANH ĐẬM, không phải hình tròn */
  bar: 'html=1;fillColor=#000000;strokeColor=none;',

  /** Làn bơi dọc (partition) của Activity Diagram */
  laneV:
    'swimlane;html=1;startSize=28;horizontal=1;fontSize=12;fontStyle=1;' +
    'fillColor=none;strokeColor=#999999;swimlaneFillColor=none;',

  /** Đầu lớp UML — dùng kèm attr/method/divider */
  classHead:
    'swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;' +
    'horizontal=1;startSize=26;horizontalStack=0;resizeParent=1;resizeParentMax=0;' +
    'html=1;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;fontSize=13;' +
    'fillColor=#ffffff;strokeColor=#333333;',

  classRow:
    'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;' +
    'spacingLeft=6;spacingRight=6;overflow=hidden;rotatable=0;' +
    'points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;fontSize=11;',

  classDiv:
    'line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;' +
    'spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];' +
    'portConstraint=eastwest;strokeColor=inherit;',

  /** Lifeline của Sequence Diagram */
  lifeline:
    'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;' +
    'dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;fontSize=12;' +
    'fontStyle=1;fillColor=#eef6ff;strokeColor=#33587a;',

  /** Hộp kích hoạt trên lifeline */
  activation:
    'html=1;points=[];perimeter=orthogonalPerimeter;fillColor=#dae8fc;strokeColor=#6c8ebf;',

  /** Thông điệp đồng bộ — mũi tên đặc */
  msg: 'html=1;verticalAlign=bottom;endArrow=block;endFill=1;fontSize=11;',

  /** Thông điệp trả về — nét đứt, mũi tên mở */
  ret: 'html=1;verticalAlign=bottom;endArrow=open;endFill=0;dashed=1;fontSize=11;',

  /** Khung alt/loop của Sequence Diagram */
  frame:
    'shape=umlFrame;whiteSpace=wrap;html=1;width=80;height=26;fontSize=11;' +
    'fillColor=none;strokeColor=#666666;verticalAlign=top;align=left;',

  /** Liên kết actor với use case — đường thẳng không mũi tên */
  assoc: 'endArrow=none;html=1;strokeColor=#333333;',

  /**
   * Tổng quát hoá — tam giác RỖNG, nét liền. Dùng cho kế thừa actor và kế
   * thừa lớp.
   *
   * Phân biệt với `flow` (tam giác ĐẶC): đặc là luồng đi hoặc phụ thuộc
   * hướng, rỗng là quan hệ "là một". Vẽ nhầm hai cái này là lỗi ký pháp mà
   * người chấm UML nhìn ra ngay.
   */
  generalize: 'endArrow=block;endFill=0;endSize=14;html=1;strokeColor=#333333;',

  /** Phụ thuộc — nét đứt có mũi tên mở */
  depend: 'endArrow=open;endFill=0;dashed=1;html=1;strokeColor=#666666;fontSize=11;',

  /** Nối thường có mũi tên */
  flow: 'endArrow=block;endFill=1;html=1;strokeColor=#333333;fontSize=11;',

  /** Ghi chú UML */
  note:
    'shape=note;whiteSpace=wrap;html=1;size=14;verticalAlign=top;align=left;' +
    'spacingLeft=6;fontSize=11;fillColor=#fffbe6;strokeColor=#c8a415;',
};

/**
 * Dựng một lớp UML đủ ba ngăn: tên, thuộc tính, phương thức.
 * draw.io dùng stackLayout nên chiều cao phải tính đúng, nếu không các ngăn
 * chồng lên nhau.
 */
export function umlClass(sheet, { value, x, y, w = 230, attrs = [], methods = [] }) {
  const ROW = 20;
  const HEAD = 26;
  const DIV = 8;
  const h = HEAD + attrs.length * ROW + (methods.length ? DIV : 0) + methods.length * ROW;
  const id = vertex(sheet, { value, style: S.classHead, x, y, w, h });

  let offset = HEAD;
  for (const a of attrs) {
    vertex(sheet, { value: a, style: S.classRow, x: 0, y: offset, w, h: ROW, parent: id });
    offset += ROW;
  }
  if (methods.length) {
    vertex(sheet, { value: '', style: S.classDiv, x: 0, y: offset, w, h: DIV, parent: id });
    offset += DIV;
    for (const m of methods) {
      vertex(sheet, { value: m, style: S.classRow, x: 0, y: offset, w, h: ROW, parent: id });
      offset += ROW;
    }
  }
  return id;
}
