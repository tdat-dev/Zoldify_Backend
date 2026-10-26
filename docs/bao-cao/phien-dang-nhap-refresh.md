# Refresh token: dùng một lần, ân hạn, và giới hạn một phiên mỗi người

*Ghi 26/10/2026, cùng các bản vá ở `AuthService.refreshToken`.*

## Hành vi hiện tại

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

## Giới hạn đã biết: một phiên mỗi người

Cột `users.refresh_token` chỉ giữ **một** token. Hệ quả:

- Đăng nhập trên máy thứ hai ghi đè token của máy thứ nhất.
- Máy thứ nhất làm mới sau đó (quá 30 giây) bị coi là dùng lại token cũ: **cả
  hai máy bị đăng xuất**.
- Đăng xuất ở một máy tăng `token_version`, cũng đá mọi máy khác (đã như vậy từ
  trước).

Hôm nay chưa client nào gọi `/auth/refresh` (kiểm 25/10: app và web đăng xuất
khi access token hết hạn), nên giới hạn này chưa chạm người dùng. Khi client bắt
đầu dùng refresh:

1. Gom mọi lần làm mới đồng thời thành **một** (single-flight). Gặp 409 thì chờ
   request đang chạy và dùng token nó trả về, đừng gọi lại.
2. Muốn nhiều thiết bị cùng đăng nhập thì cần bảng phiên riêng (mỗi thiết bị
   một dòng, có hash token, id thiết bị, hạn), thay cho cột đơn hiện tại.
