# Zoldify — Kế hoạch bàn giao Capstone

**Ngày lập:** 06/08/2026
**Mốc hoàn thành:** 15/09/2026 (~5,5 tuần) · **Đóng băng tính năng:** 08/09/2026
**Thay thế:** chương 9 của [`2026-08-06-zoldify-scale-mobile-design.md`](./2026-08-06-zoldify-scale-mobile-design.md)

> Tài liệu kiến trúc trả lời *xây cái gì và vì sao*. Tài liệu này trả lời *ai làm gì, tuần nào, và chấm điểm ra sao*. Kiến trúc không đổi; chỉ lịch và phạm vi đổi theo yêu cầu capstone.

---

## 1. Ràng buộc từ thông báo capstone

| Hạng mục | Yêu cầu | Trạng thái Zoldify |
|---|---|---|
| Nhóm | 3-5 người | Giả định **5** |
| Website | Node.js, có hosting + **tên miền trỏ vào** | NestJS ✅ · domain `zoldify.com` ✅ · **chưa deploy** ❌ |
| App | React Native / Flutter, **cả Android và iOS** | Expo ✅ · iOS cần xử lý ❌ |
| Khi bảo vệ | App gọi API tới **hosting thật**, không phải local | Chưa deploy ❌ |
| Báo cáo | **≥50 trang, toàn tiếng Anh**, đúng mẫu, in một mặt | Tài liệu đang tiếng Việt ⚠️ |
| Slide | Đúng mẫu 14 slide, tiếng Anh, **sơ đồ export ảnh** (cấm chụp màn hình) | Mermaid export SVG ✅ |
| Quản lý dự án | **Trello** + Git có dấu vết phối hợp | Board `trello.com/b/e1draMoG/zoldify` ✅ · Git mới 1 commit của 1 người ⚠️ |
| Báo cáo tiến độ | **Mỗi thứ Bảy** vào nhóm Zalo có thầy | Nhóm Zalo có thầy ✅ · bắt đầu báo cáo từ 08/08 |
| Hoàn thiện | Trước ~5 buổi cuối | Mốc 15/09 |

**Phần hành chính — đã xong phần lớn** (cập nhật 07/08):

| | Trạng thái |
|---|---|
| Tên miền `zoldify.com` | ✅ đã có — chỉ còn trỏ DNS về VPS khi deploy ở tuần 3 |
| Nhóm Zalo có thầy | ✅ đã có — bắt đầu báo cáo từ thứ Bảy 08/08 |
| Board Trello | ✅ đã có — còn mời nốt thầy và các thành viên còn lại |
| Dấu vết Git của từng người | ⚠️ **chưa có** — repo backend mới 1 commit của 1 người |

Việc còn lại duy nhất mang tính hành chính là **dấu vết Git**. Thầy chấm điểm tham gia theo từng người, nên bốn thành viên còn lại phải bắt đầu có commit ngay tuần đầu.

---

## 2. Đối chiếu rubric Level 3 (81-100 điểm)

| Tiêu chí rubric | Trạng thái | Ai làm | Ngày công |
|---|---|---|---|
| Node.js (Express/NestJS) | ✅ có sẵn | — | 0 |
| Deploy cloud + domain + full SSL | 🔨 kế hoạch | B | 2 |
| Rate limiting | ✅ có sẵn | — | 0 |
| **OAuth** | ❌ **thiếu** | E | 1 |
| WebSocket real-time (ví dụ: cập nhật tồn kho) | 🟡 chỉ có chat | B | 1 |
| App chạy cả Android + iOS | 🔨 kế hoạch | C | 1 |
| State management (Redux/MobX/Riverpod…) | 🔨 Zustand + TanStack Query | C+D | trong app |
| Offline mode | 🔨 kế hoạch (chỉ đọc) | C | trong app |
| Push notifications | 🔨 kế hoạch | D | trong app |
| Payment gateway thật | ✅ PayOS có sẵn | — | 0 |
| **Recommendation system** | ❌ **thiếu** | B | 1 |
| Admin dashboard | ✅ có sẵn | E | trong web |
| **Multi-language** | ❌ **thiếu** | E + C/D | 1,5 |
| Caching, lazy loading | 🔨 Redis | B | trong platform |
| Unit + integration test | 🔨 kế hoạch | A + E | 3 |
| **AI chat support** *(điểm sáng tạo)* | ❌ **thiếu** | D | 1,5 |

Tổng phần thêm mới: **6 ngày công**.

### Về state management, chuẩn bị trả lời phản biện

Rubric viết *"state management tốt **như** Redux/MobX"* — "như" là ví dụ, không phải danh sách đóng. Zustand + TanStack Query là lựa chọn hiện đại hơn Redux cho bài toán này, nhưng thầy có thể hỏi. Câu trả lời chuẩn bị sẵn:

> *"Chúng em tách hai loại trạng thái. Dữ liệu từ server do TanStack Query quản lý — nó lo cache, retry, đồng bộ lại và trạng thái cũ, những việc mà dùng Redux phải tự viết thủ công. Trạng thái phía client chỉ còn phiên đăng nhập và vài cờ giao diện, dùng Zustand là đủ. Redux Toolkit làm được cả hai nhưng phải viết nhiều mã lặp hơn cho cùng kết quả."*

Đây đúng tinh thần mục 18 của thông báo: sơ đồ và lựa chọn kỹ thuật sẽ bị hỏi kỹ, phải trả lời khéo chứ không cãi.

---

## 3. Phép tính ngân sách — nói thẳng

| Hạng mục | Ngày công |
|---|---|
| T0 mở khoá (move, versioning, OpenAPI, mock) | 3 |
| Lõi tiền: ledger, escrow, thanh toán, rút tiền | 12 |
| Nền tảng: Redis, R2, worker, health | 6 |
| 4 tính năng Level 3 mới | 6 |
| App — luồng người mua | 12 |
| App — luồng người bán | 12 |
| Web v1 + admin + i18n | 5 |
| Hỗ trợ và kiểm thử iOS | 2 |
| QA, e2e, test case | 5 |
| **Báo cáo 50 trang + 14 slide** | **8** |
| Deploy, CI/CD, domain, backup | 4 |
| **Tổng** | **≈75** |

Đối chiếu năng lực: 5 người × 5,5 tuần × 5 ngày = 137 ngày trên giấy. Nhưng sinh viên còn học môn khác — thực tế khoảng **45-50%**, tức **≈62-68 ngày công dùng được**.

> **Thiếu khoảng 10-15%.** Kế hoạch vừa khít nếu mọi thứ trôi chảy, và sẽ vỡ nếu có một tuần nào đó cả nhóm bận thi.

Vì vậy §7 có sẵn danh sách cắt theo thứ tự. Đừng đợi đến lúc cháy mới quyết định cắt gì — quyết trước, cắt sau, theo đúng thứ tự đã định.

### Điều tôi đề nghị hạ ưu tiên ngay từ đầu

Việc **chứng minh scale ngang bằng 3 bản sao API và đo tải bằng k6** không xuất hiện trong rubric. Nó chiếm khoảng 2 ngày công mà không đổi được điểm nào.

Nhưng phần **stateless hoá** (Redis, R2, tách worker) thì **vẫn giữ** — vì nó chỉ tốn khoảng 2 ngày, và nó chính là dòng *"performance optimization (caching)"* trong rubric, đồng thời sửa lỗi ảnh mất khi redeploy.

Nói cách khác: giữ phần *làm cho hệ thống scale được*, bỏ phần *biểu diễn việc scale*. Nếu còn thời gian ở tuần 5 thì làm k6 như phần thưởng, và nó thành một slide đẹp.

---

## 4. Ánh xạ tài liệu → mẫu báo cáo

Mẫu bắt buộc, không được bỏ mục nào. Cột bên phải cho biết nội dung lấy từ đâu — phần lớn **đã viết rồi**, chỉ cần dịch và sắp lại.

| Chương trong mẫu | Nội dung cần | Nguồn |
|---|---|---|
| **I. Project Introduction** | Hệ thống hiện tại · Hệ thống đề xuất · Phạm vi · Tên hệ thống · Môi trường triển khai · Công cụ phát triển · Yêu cầu khách hàng | Design doc §1, §2 · Diagrams #1 |
| **II. Analyze System Requirements** | **Bảng đặc tả từng use case** (ID, actor, trigger, pre/post-condition, main course, alternate, exception) · **Activity Diagram** | Diagrams #14 làm gốc · **đặc tả và activity phải viết mới** |
| **III. Design Details** | UI Design · **Class Diagram** · Sequence Diagram · ERD · **Bảng chi tiết từng cột** | Diagrams #5,6,8,9,10,11 · **class diagram và bảng cột phải viết mới** |
| **IV. Test** | Bảng test case: số, tên, mô tả, tiền đề, đầu vào, đầu ra mong đợi, các bước | `TestCaseTemplate.xlsx` · Design doc §8 |
| **V. Task Assignment** | Bảng: STT, tên task, mô tả, ngày bắt đầu, ngày kết thúc, thành viên, tự đánh giá | §6 của tài liệu này |
| **VI. Installation Instructions** | **Deployment Diagram** · Cài database · Cài server · Cài application | Diagrams #4 · Design doc §7 |
| **Appendix** | Thuật ngữ · Tài liệu tham khảo · Kết quả, hạn chế, kinh nghiệm | Design doc §10, §11 |

**Định dạng bắt buộc:** A4 · Arial hoặc Helvetica Neue 12pt · lề trên/dưới 20-25mm, trái 30-35mm, phải 15-20mm · header trái logo VTC, phải tên project · footer trái `Class_Name–Project_Name`, phải số trang · bìa in màu xanh · **tối thiểu 50 trang** · in một mặt.

### Vì sao 50 trang không phải là viết dài cho đủ

Bảng đặc tả use case đầy đủ chiếm khoảng **1 trang mỗi use case**. Zoldify có ~17 use case (xem Diagrams #14) → riêng chương II đã khoảng 20 trang. Cộng bảng chi tiết cột cho ~15 bảng dữ liệu, cộng sơ đồ, cộng test case — 50 trang đến một cách tự nhiên **nếu làm đúng mẫu**. Nhóm nào phải "viết cho đủ trang" là nhóm đã bỏ qua các bảng này.

---

## 5. Ánh xạ 14 slide

| # | Slide | Nguồn |
|---|---|---|
| 1 | Title | Tên nhóm, thành viên |
| 2 | Objectives | Mục lục, giữ nguyên mẫu |
| 3 | Introduction to Project | Design doc §0 · công nghệ, ngôn ngữ, CSDL |
| 4 | Customer Requirements | Design doc §2 |
| 5 | Use Case | Diagrams #14 |
| 6 | **Activity Diagram** | ⚠️ phải vẽ mới |
| 7 | UI Design | Ảnh chụp màn hình web + app |
| 8 | **Class Diagram** | ⚠️ phải vẽ mới |
| 9 | Sequence Diagram | Diagrams #8 (đặt hàng) hoặc #9 (webhook) |
| 10 | ERD | Diagrams #5, #6 |
| 11 | Task Assignment theo tuần | §6 của tài liệu này |
| 12 | Experience Learned | Điều làm tốt và chưa tốt |
| 13 | *(trống)* | Đề xuất: **Diagrams #7 — sơ đồ dòng tiền** |
| 14 | Q & A | Kết bằng lời cảm ơn (mục 17 thông báo) |

**Slide 13 đang trống trong mẫu — đó là chỗ đặt sơ đồ dòng tiền.** Hầu như không đồ án nào ở mức này mô hình hoá dòng tiền tử tế. Đặt nó ngay trước Q&A là để lại ấn tượng cuối cùng, đúng chiến thuật mục 16 của thông báo: khéo léo lồng thứ hay nhất vào.

---

## 6. Kiểm kê sơ đồ

| # | Sơ đồ | Có | Cần bản EN | Ghi chú |
|---|---|:---:|:---:|---|
| 1-3 | C4 mức 1/2/3 | ✅ | ✅ | |
| 4 | Deployment | ✅ | ✅ | Vẽ lại theo ký pháp UML cho chương VI |
| 5-6 | ERD | ✅ | ✅ | Bổ sung bảng chi tiết cột |
| 7 | Dòng tiền | ✅ | ✅ | → slide 13 |
| 8-11 | Sequence ×4 | ✅ | ✅ | |
| 12-13 | State ×2 | ✅ | ✅ | |
| 14 | Use case | ✅ | ✅ | Bổ sung bảng đặc tả |
| 15 | Điều hướng app | ✅ | ✅ | |
| 16 | CI/CD | ✅ | ✅ | |
| **17** | **Activity Diagram** | ❌ | — | **Vẽ mới** — tối thiểu 3: đăng ký, đặt hàng-thanh toán, giải ngân escrow |
| **18** | **Class Diagram** | ❌ | — | **Vẽ mới** — entity + service chính, có quan hệ và phương thức |

**Class Diagram khác ERD ở chỗ nào** — thầy có thể hỏi đúng câu này. ERD mô tả *bảng trong cơ sở dữ liệu*: khoá chính, khoá ngoại, kiểu cột. Class Diagram mô tả *lớp trong mã nguồn*: thuộc tính, phương thức, kế thừa, quan hệ phụ thuộc. Zoldify có `LedgerService`, `EscrowsService`, `OrdersService` — chúng là lớp có hành vi, không phải bảng, nên chỉ xuất hiện ở Class Diagram.

---

## 7. Kế hoạch 5,5 tuần

### Năm vai trò

| Mã | Vai trò | Phụ trách |
|---|---|---|
| **A** | Lead / Money | Ledger, escrow, thanh toán, rút tiền, đối soát · chương báo cáo về nghiệp vụ tiền |
| **B** | Platform / DevOps | Move thư mục, versioning, OpenAPI, Redis, R2, worker · gợi ý sản phẩm, tồn kho real-time · Docker, CI/CD, domain, backup |
| **C** | Mobile — Buyer | Nền app, luồng người mua, offline, **kiểm thử iOS** |
| **D** | Mobile — Seller | Luồng người bán, chat, push, **AI chat** |
| **E** | Web / QA / Docs | Web v1, admin, **OAuth**, **i18n**, QA, test case, **chủ trì báo cáo + slide + Trello** |

### Tuần 0 — 06/08 đến 09/08 · mở khoá

Chặn toàn bộ phần còn lại. Trong lúc này C/D/E cài môi trường và đọc tài liệu.

| Ai | Việc |
|---|---|
| A+B | Move 25 module thành 6 context + alias tsconfig (~2h) · bật eslint-boundaries |
| B | `setGlobalPrefix('api')` + versioning · bật Swagger · xuất `openapi.json` · script `gen:api` · Prism mock |
| B | **Mua domain, trỏ DNS** — làm ngày đầu vì chờ lan truyền |
| E | **Lập Trello, nhóm Zalo có thầy, tạo repo `Zoldify_Mobile`** · viết lại README |
| Cả nhóm | Thống nhất quy ước Git: mỗi người một nhánh, PR có review, **mọi người đều phải có commit** |

**Cổng ra:** `openapi.json` tồn tại, mock server chạy, domain đã trỏ.

### Tuần 1 — 10/08 đến 16/08 · nền móng

| Ai | Việc |
|---|---|
| A | 3 bảng ledger + `LedgerService.post()` + 4 test bắt buộc |
| B | Redis (cache, throttler, socket) · hạ `connectionLimit` 50→15 · Docker Compose |
| C+D | Nền app chung: Expo Router, NativeWind, TanStack Query, TokenStore, refresh single-flight · đăng nhập/đăng ký |
| C | **Chạy thử trên iPhone bằng Expo Go ngay tuần này** — xem §8 |
| E | Web sang `/api/v1` · **Google OAuth** · dựng khung báo cáo theo mẫu |

### Tuần 2 — 17/08 đến 23/08 · tiền vào, app hình thành

| Ai | Việc |
|---|---|
| A | Nạp ví + thanh toán qua ledger · webhook PayOS vào **cùng transaction** với cộng tiền |
| B | Upload ảnh sang R2 · tách worker · **gợi ý sản phẩm** (SQL trên bảng `interactions`) |
| C | Trang chủ, tìm kiếm + lọc, chi tiết sản phẩm, trang shop |
| D | Đăng bán: chụp ảnh, **nén trước khi upload**, sửa/xoá tin |
| E | Admin đối soát ledger · **i18n web VI/EN** · viết chương I + II báo cáo |

### Tuần 3 — 24/08 đến 30/08 · escrow, thanh toán, deploy thật

| Ai | Việc |
|---|---|
| A | Escrow giải ngân/hoàn tiền qua ledger + phí nền tảng · **xoá `users.balance`** · **chặn `PATCH /orders/:id/status` theo vai trò** |
| B | **Deploy production + SSL + CI/CD** · backup hằng ngày · **tồn kho real-time qua WebSocket** |
| C | Giỏ hàng, thanh toán, WebView PayOS, deep link |
| D | Đơn bán, xử lý đơn, vận đơn GHN · i18n cho app |
| E | E2E luồng chính · **viết bảng đặc tả use case** (chương nặng nhất) |

**Cổng ra:** website chạy trên domain thật có SSL, app gọi được API production.

### Tuần 4 — 31/08 đến 06/09 · ví, rút tiền, AI

| Ai | Việc |
|---|---|
| A | Rút tiền qua ledger 2 bước · job đối soát mỗi giờ · viết chương nghiệp vụ tiền |
| B | Rà soát bảo mật (CORS websocket) · đóng băng `openapi.json` v1 |
| C | Chi tiết đơn, theo dõi GHN, thông báo, hồ sơ, địa chỉ · offline cache |
| D | Ví người bán, rút tiền, lịch sử giao dịch · chat · push · **AI chat support** |
| E | **Vẽ Activity Diagram và Class Diagram** · bảng test case · chương III + IV |

### Tuần 5 — 07/09 đến 13/09 · đóng băng và hoàn thiện

| Ai | Việc |
|---|---|
| **Cả nhóm** | **Đóng băng tính năng từ 08/09.** Chỉ sửa lỗi. |
| A+B | Sửa lỗi · nếu còn thời gian thì chạy k6 lấy số liệu cho slide |
| C+D | Trạng thái rỗng/lỗi/loading · EAS Build ra APK · **kiểm lại trên iPhone** |
| E | **Ghép báo cáo đủ 50 trang, dịch toàn bộ sang tiếng Anh** · dựng 14 slide · export sơ đồ ra ảnh |
| Cả nhóm | Tổng duyệt thử buổi bảo vệ |

### 14/09 đến 15/09 — đệm

Không xếp việc. Luôn có phát sinh, và mục 7 của thông báo yêu cầu hoàn thiện sớm để còn kịp sửa.

---

## 8. Chiến lược iOS

Nhóm có iPhone, không có Mac.

| Phương án | Chi phí | Được | Mất |
|---|---|---|---|
| **Expo Go trên iPhone** *(chọn)* | 0đ | Cài trong 5 phút, đủ demo toàn bộ giao diện và API | Push notification bị giới hạn |
| EAS Build + Apple Developer | 99 USD/năm | Bản build thật, đầy đủ tính năng | Tốn tiền, chờ duyệt tài khoản |

**Việc phải làm ngay tuần 1, không được để đến cuối:** cài Expo Go lên iPhone, chạy thử app, và **kiểm chứng push notification trên iOS có hoạt động không**. Giới hạn của Expo Go thay đổi theo từng phiên bản SDK — phải thử bằng máy thật chứ không tin tài liệu.

- Nếu push chạy trên iOS → xong, không tốn đồng nào.
- Nếu không → còn 4 tuần để quyết: hoặc chi 99 USD, hoặc demo push trên Android và giải thích trung thực khi bảo vệ.

Phát hiện điều này ở tuần 1 thì có đường lùi. Phát hiện ở tuần 5 thì không.

---

## 9. Yêu cầu về quy trình

Thầy chấm điểm **mức độ tham gia của từng người**, không chỉ sản phẩm cuối.

**Git — mục 9.2 nói thẳng rằng lập trình viên Việt Nam kém phối hợp:**

- Mỗi người làm trên nhánh riêng: `feature/<tên>-<việc>`
- Mọi thay đổi vào `develop` qua Pull Request, **có ít nhất một người khác review**
- Commit theo Conventional Commits (`feat:`, `fix:`, `docs:`…)
- **Mỗi thành viên phải có commit đều đặn hằng tuần.** Backend hiện có đúng 1 commit của 1 người — nếu giữ nguyên kiểu này thì 4 người còn lại không có bằng chứng tham gia.

**Trello** — phản chiếu 7 card đang có, mỗi thẻ ghi rõ người phụ trách và hạn.

**Báo cáo thứ Bảy hằng tuần** vào nhóm Zalo, theo mẫu ngắn:

```
Tuần N (dd/mm - dd/mm)
✅ Đã xong: <việc, kèm link commit hoặc PR>
🔄 Đang làm: <việc>
🚧 Vướng: <vấn đề, cần ai hỗ trợ>
📅 Tuần tới: <dự kiến>
Từng người: A: … · B: … · C: … · D: … · E: …
```

---

## 10. Thứ tự cắt khi chậm tiến độ

Cắt từ trên xuống. **Đã quyết trước, không bàn lại lúc cháy.**

| Ưu tiên | Cắt gì | Mất gì |
|---|---|---|
| 1 | k6 và biểu đồ so tải | Không nằm trong rubric |
| 2 | Chạy 3 bản sao API *(vẫn giữ Redis + R2)* | Không nằm trong rubric |
| 3 | AI chat support | Mất điểm sáng tạo, không mất điểm cốt lõi |
| 4 | Tồn kho real-time | Chat đã chứng minh có WebSocket rồi |
| 5 | Gộp `seller/transactions` vào `seller/wallet` | Bớt 1 màn |
| 6 | Offline cache | Rubric có nêu, cắt sau cùng trong nhóm app |

**Tuyệt đối không cắt:** ledger và transaction · sửa lỗ hổng phân quyền chuyển trạng thái đơn · deploy có domain và SSL · app chạy trên iOS · **báo cáo 50 trang**.

Bốn cái đầu vì thiếu là không demo được vòng đời đơn hàng. Cái cuối vì mục 8 thông báo ghi rõ: project không đạt chất lượng thì **không được bảo vệ và phải học lại**.

---

## 11. Danh mục kiểm tra ngày bảo vệ

Rút từ mục 10-20 của thông báo.

**Trước một tuần**
- [ ] Website chạy trên domain thật, có SSL, **không phải localhost**
- [ ] App cài sẵn trên **cả** máy Android và iPhone, gọi API production
- [ ] Báo cáo in một mặt, đóng bìa xanh, gọn gàng
- [ ] Slide đúng mẫu, **sơ đồ export ảnh** — không chụp màn hình
- [ ] Đi xem một nhóm bảo vệ trước để học cách trả lời *(mục 18)*

**Ngày bảo vệ**
- [ ] Đến sớm **30 phút**, trang phục lịch sự
- [ ] Máy tính đã kiểm tra kỹ, có sạc
- [ ] **Thiết bị phát 3G/4G dự phòng**
- [ ] Có link trên desktop tới sản phẩm chạy live
- [ ] Chuẩn bị sẵn câu trả lời cho từng sơ đồ
- [ ] Kết thúc bằng lời cảm ơn thầy cô

**Câu hỏi nhiều khả năng bị hỏi**
- Class Diagram khác ERD chỗ nào? → §6 tài liệu này
- Vì sao chọn Zustand mà không phải Redux? → §2 tài liệu này
- Unit test kiểm cái gì, chạy thế nào? → 4 test ledger, chạy trực tiếp trên máy
- Xử lý người dùng bấm thanh toán hai lần ra sao? → khoá idempotency, Diagrams #9
- Escrow là gì, tiền nằm ở đâu khi đang giữ hộ? → Diagrams #7
