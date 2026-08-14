# Cài đặt và triển khai — Zoldify Backend

Tài liệu cho **chương VI của báo cáo (Installation Instructions)**.

Mọi lệnh dưới đây đã được chạy thật trên máy Windows + Docker Desktop ngày
14/08/2026, không phải viết theo trí nhớ.

---

## Cần sẵn

| | |
|---|---|
| Docker Engine | 24 trở lên (`docker compose` là lệnh con, không phải `docker-compose`) |
| Cổng trống | một cổng cho API, mặc định 3000 |
| Dung lượng | ~1.5GB cho ảnh và dữ liệu MySQL |

Không cần cài Node, không cần cài MySQL. Cả hai nằm trong container.

---

## Chạy lần đầu

```bash
git clone <repo> && cd Zoldify_Backend
cp .env.sample .env
```

Mở `.env` và điền **ít nhất ba thứ**, phần còn lại để trống vẫn chạy được:

| Biến | Vì sao bắt buộc |
|---|---|
| `DB_PASSWORD` | trở thành mật khẩu root của MySQL trong cụm. Để trống thì compose **dừng** kèm thông báo, thay vì dựng một database mật khẩu rỗng |
| `JWT_ACCESS_SECRET` | thiếu thì mọi token ký bằng chuỗi rỗng |
| `JWT_REFRESH_TOKEN_SECRET` | như trên |

Sinh khoá:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rồi:

```bash
npm run docker:up      # docker compose up -d --build
npm run docker:logs    # xem log của api
```

Kiểm tra:

```bash
curl http://localhost:3000/
# {"statusCode":200,"message":"","data":"Hello World!"}
```

Tài liệu API: <http://localhost:3000/api/docs>

Cổng khác 3000 thì đặt `API_PORT=3010` trong `.env`. Bên trong container ứng
dụng luôn nghe cổng 3000; chỉ ánh xạ ra máy chủ là đổi.

---

## Ba dịch vụ, chạy đúng thứ tự này

```
mysql  →  migrate (chạy một lần rồi thoát)  →  api
```

`api` chỉ khởi động khi `migrate` đã thoát bằng mã 0
(`condition: service_completed_successfully`), và `migrate` chỉ chạy khi MySQL
đã trả lời `mysqladmin ping`.

**Vì sao migration là bước riêng, không nhét vào lúc api khởi động.** Nhét vào
thì hai chuyện xấu xảy ra cùng lúc: dựng hai bản api là hai tiến trình cùng đổi
lược đồ, và migration hỏng khiến api rơi vào vòng khởi động lại vô tận, mỗi vòng
lại thử migrate một lần. Tách ra thì hỏng là dừng hẳn, và log nằm nguyên một chỗ:

```bash
docker compose logs migrate
```

---

## Dữ liệu nằm ở đâu

Hai volume có tên. **Có tên** chứ không phải bind mount là chủ ý: lần tạo đầu
Docker chép nội dung sẵn có trong ảnh vào volume, nên 26 ảnh danh mục đang được
git theo dõi vẫn còn nguyên.

| Volume | Chứa gì | Mất thì sao |
|---|---|---|
| `zoldify_mysql-data` | toàn bộ database | mất sạch dữ liệu |
| `zoldify_product-images` | ảnh người bán tải lên | mất sạch ảnh hàng |

Ảnh nằm trên **đĩa**, không phải trên object storage — `multer.config.ts` dùng
`diskStorage` ghi vào `public/images/{folder_type}`, và không có client R2 hay S3
nào trong `src/`. Đó là lý do dòng volume kia không được bỏ: thiếu nó, ảnh nằm
trong lớp ghi của container, và `docker compose up` với ảnh mới tạo container
mới — toàn bộ ảnh hàng của mọi người bán biến mất.

Đã đo, không phải suy luận: ghi một file vào `/app/public/images`, chạy
`docker compose down` rồi `up`, file vẫn còn.

```bash
docker compose down        # dừng, GIỮ dữ liệu
docker compose down -v     # dừng và XOÁ cả hai volume
```

---

## Cập nhật phiên bản mới

```bash
git pull
npm run docker:up          # dựng lại ảnh, chạy migration, khởi động lại api
```

Chưa có CI nên chưa có ảnh dựng sẵn trên registry — máy chủ tự dựng lấy. Xem
`r8-cicd-pipeline` để biết phần nào của quy trình đã có, phần nào chưa.

---

## Database dựng từ số không

`src/migrations/1690000000000-InitialSchema.ts` tạo toàn bộ 25 bảng. Sau nó là
năm migration cũ, tất cả đều chịu được chạy lại.

**Chuyện đã xảy ra và vì sao có file đó.** Trước ngày 14/08, năm migration đang
có đều là `ALTER` — thêm index, thêm cột, xoá cột — và không cái nào tạo `users`,
`products`, `orders`. Các bảng ấy sinh ra từ `synchronize: true` trên máy người
viết code rồi không ai chép lại vào migration. Chạy `migration:run` trên một
database rỗng cho ra **đúng 4 bảng**.

Tệ hơn: nó không báo lỗi. `AddPerformanceIndexes` bọc mọi câu lệnh trong
`.catch(() => {})`, nên nó nuốt `Table 'products' doesn't exist` rồi tự ghi vào
bảng `migrations` là đã chạy xong. Một database rỗng mang nhãn *"đã cập nhật tới
bản mới nhất"*, và lần `migration:run` sau trả lời "không có gì để chạy".

Phát hiện đúng lúc chạy `docker compose up` lần đầu — đó là giá trị của việc
viết file triển khai thay vì tả nó.

Máy nào đã có sẵn lược đồ từ `synchronize` thì `InitialSchema` tự bỏ qua: nó
kiểm `hasTable('users')` trước, thấy có thì ghi nhận là đã chạy rồi thoát. Không
ai phải xoá database đang làm việc.

---

## Chưa có, và biết là chưa có

| Thứ | Trạng thái |
|---|---|
| CI/CD | không có `.github/workflows` trong bất kỳ repo nào |
| HTTPS / reverse proxy | `r2-container` vẽ Caddy; chưa dựng |
| Redis | **không có dòng code nào dùng** — bộ nhớ đệm nằm trong tiến trình Node (`CacheModule.register()`), nên compose cũng không khởi động Redis |
| Nhân bản API | chặn bởi chỗ để ảnh: volume nằm trên một máy, hai bản API không dùng chung được |
| Healthcheck thật | `GET /` chỉ nói tiến trình còn sống, **không** chạm database. Cụm vẫn báo healthy khi MySQL đã chết |
| Sao lưu | chưa có lịch dump `mysql-data` |

---

## Khi hỏng

**`compose up` dừng ngay với `DB_PASSWORD đang trống`** — đúng như thiết kế. Điền
`DB_PASSWORD` vào `.env`.

**`api` khởi động rồi tắt.** Xem `docker compose logs api`. Thường là biến môi
trường thiếu; `npm run env:check` liệt kê biến nào chưa có.

**`migrate` thoát khác 0.** `api` sẽ không khởi động — đó là chủ ý. Đọc
`docker compose logs migrate`, sửa, rồi `npm run docker:up` lại.

**`ports are not available: ... 3000`.** Cổng đang bị chiếm, thường là bởi
`npm run start:dev` chạy song song. Đặt `API_PORT=3010`.

**Muốn xoá sạch làm lại từ đầu:**

```bash
docker compose down -v && npm run docker:up
```
