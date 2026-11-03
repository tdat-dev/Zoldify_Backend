---
name: no-artifacts-zoldify
description: "Dự án Zoldify CẤM tạo Artifact — giao kết quả bằng file trong repo, không publish lên claude.ai"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: <session>
  modified: 2026-08-14T06:03:21.189Z
---

Dự án Zoldify **cấm dùng công cụ Artifact**. Người dùng nói rõ ngày 2026-08-14 sau
khi tôi publish một trang nghiệm thu sơ đồ lên claude.ai.

**Vì sao:** Artifact publish nội dung lên hạ tầng ngoài repo. Đây là đồ án tốt nghiệp
VTC Academy — mọi thứ giao nộp phải nằm trong repo và mở được offline, không phụ thuộc
một đường link ngoài có thể mất.

**Cách làm thay thế:** khi cần cho người dùng xem trực quan (ảnh render, bảng so sánh,
trang tổng hợp), ghi thẳng file vào repo rồi báo đường dẫn để họ tự mở:
- ảnh → `docs/.../renders/*.png`
- trang tổng hợp → một file `.html` cạnh ảnh, tham chiếu ảnh bằng đường dẫn tương đối
  (không nhúng data URI — file nhỏ hơn nhiều và diff được)
- kèm một `npm run` script để dựng lại, đừng để nó thành đồ dùng một lần

Liên quan: [[zoldify-diagram-render-check]]
