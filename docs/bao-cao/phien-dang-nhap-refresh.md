# Refresh token: dùng một lần, ân hạn, và giới hạn một phiên mỗi người

*Ghi 26/10/2026, cùng các bản vá ở `AuthService.refreshToken`. Sửa 04/11/2026
khi có bảng `user_sessions`.*

## Phiên theo thiết bị (từ 04/11)

Mỗi lần đăng nhập một dòng `user_sessions`, `sid` nằm trong cả access lẫn refresh
token. Có hai mức thu hồi:

| Hành động | Mức thu hồi |
|---|---|
| Đăng xuất bằng token có `sid` | Chỉ dòng của máy đó (`revoked_at`). Máy khác, kể cả socket chat, sống tiếp. |
| Đổi mật khẩu, đặt lại mật khẩu, khoá, đổi vai trò, xoá tài khoản, dùng lại refresh token | Mọi máy (`token_version`), như trước. |
| Refresh token của phiên đã chết (đăng xuất, hết hạn, mất dòng) | **400**, không tăng `token_version`. Tăng là đá máy đang dùng, đúng lỗi bảng này sửa. |

JwtStrategy và socket chat kiểm dòng phiên theo khoá chính, không cache. Socket
chỉ nghe sống thêm tối đa 30 giây sau khi đăng xuất, tới lượt quét kế tiếp.

Dòng hết hạn được dọn lúc chính người đó đăng nhập, không có cron. Người không
bao giờ đăng nhập lại thì các dòng cuối của họ nằm đó, nhưng cũng không sinh thêm
dòng nào, nên bảng không phình theo thời gian.

**Token không `sid`** (phát trước ngày deploy) đi hết đường cũ bên dưới, kể cả
đăng xuất đá mọi máy. Nhánh đó gỡ được khi đã qua một `JWT_ACCESS_EXPIRE` và một
`JWT_REFRESH_EXPIRE` kể từ ngày deploy, cùng lúc gỡ dòng ghi cột
`users.refresh_token` trong `login()`.

**Lùi bản:** mã cũ không biết `sid`, nên access token của máy đã đăng xuất sống
lại tới hết hạn (`token_version` không tăng). Lùi mã không cần lùi bảng; chạy
chiều lùi của migration rồi lại lên bản này thì mọi token mang `sid` còn hạn mất
phiên.

## Đường cũ, cho token không `sid`

| Tình huống | Kết quả |
|---|---|
| Đăng nhập | Cấp access + refresh token. Cột `users.refresh_token` lưu **SHA-256** của refresh token, không lưu nguyên văn. |
| `POST /auth/refresh` với token cột đang giữ | Cấp cặp token mới, token cũ chết ngay (xoay vòng). Đổi bằng một câu `UPDATE ... WHERE refresh_token IN (...)` nên hai request đồng thời chỉ một cái thắng. |
| Gửi lại token **vừa** được đổi, trong 30 giây | **409 Conflict**, không thu hồi gì. Đây là ca hai tab, hoặc app thử lại khi mạng chập chờn. Client dùng cặp token mà request kia nhận được. |
| Gửi lại token đã đổi, **sau** 30 giây | **400**, tăng `token_version` (mọi access và refresh token cũ chết) và xoá cột. Coi là token bị trộm. |
| Phiên phát trước bản vá (cột còn lưu nguyên token) | Làm mới được một lần rồi chuyển sang hash. Gỡ nhánh tương thích này khi đã qua 7 ngày (`JWT_REFRESH_EXPIRE`) kể từ ngày deploy. |

Ân hạn lưu trong cache (`refresh_an_han_<hash>`, Redis khi có `REDIS_URL`), không
cần migration. Nó chỉ được ghi khi token gửi lên đúng là token cột đang giữ, nên
kẻ gửi lại token cũ không tự cấp ân hạn cho mình được.

## Giới hạn của đường cũ: một phiên mỗi người

Cột `users.refresh_token` chỉ giữ **một** token. Từ 04/11 giới hạn này chỉ còn
với token không `sid`. Hệ quả:

- Đăng nhập trên máy thứ hai ghi đè token của máy thứ nhất.
- Máy thứ nhất làm mới sau đó (quá 30 giây) bị coi là dùng lại token cũ: **cả
  hai máy bị đăng xuất**.
- Đăng xuất bằng token không `sid` tăng `token_version`, cũng đá mọi máy khác.

Hôm nay chưa client nào gọi `/auth/refresh` (kiểm 25/10 và 04/11: app và web
đăng xuất khi access token hết hạn), nên giới hạn này chưa chạm người dùng. Khi
client bắt đầu dùng refresh, phải gom mọi lần làm mới đồng thời của một phiên
thành **một** (single-flight). Gặp 409 thì chờ request đang chạy và dùng token nó
trả về, đừng gọi lại.
