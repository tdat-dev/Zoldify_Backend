---
name: admin-dev-setup
description: "Cách chạy Zoldify_Admin dev + backend local, tài khoản admin, và bug script seed backend"
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-08-16T05:27:39.992Z
---

Chạy admin local để test:
- **Zoldify_Admin** (Next.js): `npm run dev` → port **3002**. `src/lib/config.ts` mặc định `NEXT_PUBLIC_API_ORIGIN=http://localhost:3000` nếu không có `.env.local` (hook chặn tạo/đọc mọi file `.env*`, kể cả qua Bash — dùng default là đủ).
- **Zoldify_Backend** (NestJS): `npm run start:dev` → port **3000**, prefix REST `/api/v1`. `.env` đã tồn tại sẵn (trỏ MySQL local, root bị đổi mật khẩu nên đừng đoán root/empty). Login: `POST /api/v1/auth/login`.
- Tài khoản admin local có sẵn: **admin@zoldify.com / <pass>** (role admin). seller@ và buyer@ cũng /<pass>. Trên VPS/api.zoldify.com KHÔNG có admin này (trả 401).
- Nếu đăng nhập admin fail: nghĩ tới **backend local đang tắt** trước, đừng vội nghĩ sai tài khoản — form `AdminGate.tsx` điền sẵn cứng admin@zoldify.com/<pass> nên account đúng, chỉ thiếu backend.

**Bug lặp lại — `npm run seed` của backend hỏng:** script là `ts-node src/seed.ts`, THIẾU `-r tsconfig-paths/register` nên fail `Cannot find module '@money/...'`. Chạy tay bằng:
`node -r ts-node/register -r tsconfig-paths/register src/seed.ts`. (Các script seed khác trong package.json đều có register, chỉ `seed` bị sót.)

Xem thêm [[deploy-vps-backend]].
