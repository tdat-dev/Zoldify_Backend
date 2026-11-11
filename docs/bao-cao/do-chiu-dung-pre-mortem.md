# Pre-mortem — bài đo SỨC CHỊU ĐỰNG (soak / endurance) của backend

> Vai B · nhánh `perf/do-chiu-dung` tách từ `staging`.
> Mục tiêu: chạy tải VỪA trong 15–30 phút và trả lời đúng một câu —
> **backend có rò (bộ nhớ / kết nối) hay trôi (độ trễ, event loop lag) theo
> thời gian không**, hay giữ nguyên trạng thái ổn định.

Khác `loadtest` (đo TRẦN tức thời: RPS/p95 trong 5 giây mỗi mức) và khác
`check:race` (đo ĐÚNG ĐẮN dưới tranh chấp). Soak đo thứ cả hai bỏ sót: cái
hỏng **chỉ lộ ra sau thời gian** — rò 2 MB mỗi phút thì 5 giây không thấy gì,
30 phút thì +60 MB.

## Rủi ro liệt kê TRƯỚC khi gõ dòng mã đầu

| # | Bẫy | Vì sao nó cắn | Cách chặn trong thiết kế |
|---|-----|---------------|--------------------------|
| K1 | Phép đo tự làm nghẽn thứ đang đo | Bộ bắn tải chạy chung tiến trình với server thì chính nó giữ CPU, `event loop lag` đo ra là lag DO PHÉP ĐO GÂY RA | Tách tiến trình: `fork` chính mình, con dựng app và **tự đo lag của chính nó**, cha chỉ bắn tải + hỏi con qua IPC (đúng khuôn `loadtest`) |
| K2 | **Xanh giả** — soak chạy 30 phút, báo "khoẻ", nhưng thật ra không đủ nhạy để bắt rò | Ngưỡng quá lỏng hoặc cửa sổ phân tích sai thì bài kiểm **không thể chuyển từ xanh sang đỏ** — vô dụng để nghiệm thu | Bộ phân tích tách riêng, **thuần logic**, có `check:chiu-dung`: nạp chuỗi RSS leo dốc → PHẢI đỏ; chuỗi phẳng → xanh. Thêm `SOAK_LEAK=1` rò cố ý để chạy end-to-end cũng ra đỏ thật |
| K3 | Chẩn rò nhầm vì RSS **tăng trong lúc khởi động là bình thường** | Vài phút đầu: cache ấm dần, pool mở đủ 15 kết nối, V8 JIT biên dịch — RSS leo rồi phẳng. So hai đầu là kết tội oan | **Bỏ cửa sổ warmup** (mặc định 3 phút đầu), chỉ xét độ dốc trên phần SAU warmup |
| K4 | GC cưa răng → lấy mẫu rơi đúng đỉnh/đáy → sai dấu độ dốc | `rss`/`heapUsed` lên xuống theo chu kỳ GC; so hai điểm tức thời có thể ra dốc âm hoặc dốc dương giả | Hồi quy tuyến tính trên NHIỀU mẫu (không so hai điểm); xét `heapUsed` và cả đáy (trough) giữa các lần GC; chạy con với `--expose-gc` để ép GC trước mỗi lần lấy mẫu heap khi có |
| K5 | Rò **kết nối** (pool 15) ẩn dưới độ trễ chứ không thành lỗi ngay | Mỗi request quên nhả kết nối → pool cạn dần → request mới xếp hàng chờ, p95 bò lên nhưng chưa 500 → nhìn "vẫn xanh" | Theo dõi p95 **nửa đầu vs nửa sau** + đếm lỗi theo thời gian; đọc pool mysql2 (best-effort, bọc try/catch vì là nội bộ) để báo kèm |
| K6 | DB `zoldify_sqlaudit` chưa seed / thiếu user → soak chạy trên bảng rỗng, số vô nghĩa | Bảng rỗng thì mọi route trả nhanh và phẳng → "khoẻ" giả; login hỏng thì route cần token thành 401 hàng loạt | Kiểm TRƯỚC khi chạy: đếm `products`/`users`, xác nhận có `buyer@`/`admin@`. Rỗng → từ chối chạy, in cách seed |
| K7 | Chạy thật cần Docker + MySQL 3307 + 15–30 phút; môi trường agent **không có Docker** | Không dựng được app thì không có gì để đo — và không được báo cáo theo ý định | Tách phần **nghiệm thu được không cần DB** (bộ phân tích, qua `check:chiu-dung`); runner bàn giao kèm lệnh, người có Docker chạy rồi dán `chiu-dung.md` (có SHA HEAD) |
| K8 | Trỏ nhầm DB thật rồi bắn 30 phút tải | Soak ghi/đọc nhiều; nhắm nhầm DB vận hành là tai nạn | Chặn cứng: tên `DB_DATABASE` phải chứa `audit` (giống `loadtest`), sai thì thoát 1 |
| K9 | Dương tính giả vì **máy đo đang bận việc khác** (CI, agent, Docker build) | `event loop lag` và p95 nhiễm tải nền → "trôi" không phải do app | Ngưỡng xét XU HƯỚNG (nửa sau so nửa đầu, độ dốc) chứ không phải giá trị tuyệt đối; ghi rõ "chạy trên máy rảnh"; in cảnh báo nếu lag nền cao ngay từ warmup |

## Tiêu chí đỏ/xanh (bộ phân tích phải CHỨNG MINH đỏ được)

Sau warmup, trên cửa sổ còn lại:

1. **Rò RSS** — độ dốc hồi quy của `rss` > `NGUONG_DOC_RSS` MB/phút (mặc định
   ~1,5), kéo dài đủ để ngoại suy ra > ~30 MB trong một giờ. Đỏ.
2. **Rò heap** — độ dốc `heapUsed` dương bền (xét cả đáy sau GC). Đỏ.
3. **Trôi độ trễ** — p95 nửa sau > p95 nửa đầu × `HE_SO_TROI` (mặc định 1,5). Đỏ.
4. **Trôi lag** — `event loop lag` p99 nửa sau > nửa đầu × `HE_SO_TROI`. Đỏ.
5. **Lỗi dồn** — tỉ lệ lỗi nửa sau > nửa đầu, hoặc > 1%. Đỏ.

Không chạm ngưỡng nào → **ĐẠT**: backend giữ ổn định suốt bài đo.

## Những gì cố ý KHÔNG làm vòng này

- Không đo phần tiền (`src/money`) dưới tải — vai A của Đạt.
- Không tự khởi động Docker hộ người chạy; runner chỉ kiểm tra và từ chối sạch
  nếu DB chưa sẵn sàng.
