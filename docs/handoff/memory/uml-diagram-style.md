---
name: uml-diagram-style
description: "User wants UML diagrams (use case etc.) in classic uml-diagrams.org style: straight direct lines, monochrome, not orthogonal bus routing"
metadata:
  node_type: memory
  type: feedback
  originSessionId: <session>
  modified: 2026-10-05T06:11:56.813Z
---

Use case diagrams: draw like the uml-diagrams.org "Bank ATM" example. Actors outside the system box, each association is ONE straight line from the actor to the ellipse (diagonal is fine), black and white, bold labels. "Không xiên vẹo" means no messy crossings or zigzags, NOT "only horizontal/vertical".

**Why:** 2026-10-05 I first drew 05-use-case-diagram.drawio with orthogonal buses and colour groups; the user rejected it and sent the ATM image as the target.

Class + sequence (2026-10-05): same monochrome uml-diagrams.org style. They are GENERATED, not hand-edited: `Zoldify_Backend/scripts/drawio-class.mjs` (08-class-diagram, 3 pages, refuses to write on crossing/diagonal lines) and `scripts/drawio-sequence.mjs` + `scripts/drawio-specs/sequence/NN-*.json` (Sequence-Diagrams.drawio, 14 pages). Labels use numeric entities (&#38;) because check-drawio flags &amp;amp; as double escaping. draw.io CLI export can hang: run each page via Start-Process with WaitForExit(60000).

**How to apply:** Generate drawio XML on a grid with a script that checks no line crosses another or clips a non-endpoint ellipse; export/verify with draw.io desktop CLI at `D:\Drawio\draw.io\draw.io.exe -x -f png -s 1.5 -b 20 -o out.png file.drawio`. Diagrams live in Zoldify_Backend/docs/system-design/drawio/.

**Tình trạng sơ đồ 2026-10-12 (staging 18f55ec):** 05 use case = tổng quan vẽ tay + 6 trang UC01 đến UC06 (include/extend) sinh từ `scripts/drawio-usecase.mjs` + `scripts/drawio-specs/usecase/*.json`. User BỎ ERD (10) và Deployment (11): đã gỡ khỏi `make-drawio.mjs` (check-drawio của Cường đòi đủ file khai trong FILES). Mẫu báo cáo Word vẫn có mục ERD + Deployment; bản vẽ lại còn ở b6d5773 / f648b68. Slide 6 activity: `activity_zoldify.drawio` (15 trang nhóm vẽ tay) đã lên staging 05cec34.
**Dọn 2026-10-12 (staging 266c7c1):** chỉ còn 4 file drawio (05, activity_zoldify, 08, Sequence-Diagrams). Đã bỏ 06*, 09-sequence cũ, r1 đến r8, make-drawio.mjs + lệnh drawio:make. check-drawio đọc tên file cần có từ scripts/drawio-*.mjs + VE_TAY (activity_zoldify).
