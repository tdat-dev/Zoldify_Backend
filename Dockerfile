# syntax=docker/dockerfile:1.7
#
# Ảnh chạy Zoldify Backend.
#
# Chia bốn tầng để tầng cuối KHÔNG mang theo trình biên dịch, mã nguồn TypeScript
# và devDependencies — ba thứ chiếm phần lớn dung lượng và cũng là ba thứ không
# nên có mặt trên máy chủ thật.
#
#   npm run docker:build          dựng ảnh
#   docker compose up -d          dựng rồi chạy cả cụm

# ---------------------------------------------------------------------------
# bookworm-slim chứ không phải alpine.
#
# `bcrypt` là native module. Alpine dùng musl thay vì glibc, không khớp bản
# dựng sẵn nào của bcrypt, nên npm phải tự biên dịch — và lúc đó lỗi hiện ra
# là một bức tường log node-gyp. Debian slim nhận đúng bản dựng sẵn.
# ---------------------------------------------------------------------------
#
# Node 24, KHÔNG phải 22 LTS.
#
# `package-lock.json` do npm 11 (đi kèm Node 24) sinh ra. npm 10 trong ảnh
# Node 22 giải cây phụ thuộc khác đi và `npm ci` dừng với "Missing: chokidar@3.6.0
# from lock file" — lockfile không hỏng, chỉ là hai npm không đọc giống nhau.
# Chọn đúng phiên bản mà người viết code đang chạy thì lockfile mới có nghĩa;
# hạ container xuống 22 là tự tạo ra một môi trường thứ ba không ai kiểm.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# 1. Bộ công cụ biên dịch — chỉ để cài phụ thuộc, không đi vào ảnh cuối
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Chặn puppeteer tải Chrome về trong lúc cài.
#
# puppeteer không nằm trong dependencies — nó theo `@mermaid-js/mermaid-cli`
# vào, một devDependency chỉ dùng để xuất sơ đồ. Postinstall của nó tải một bản
# Chrome ~170MB, và trong container không có mạng ra ngoài đầy đủ thì `npm ci`
# chết ở đó với một stack trace của downloadBrowser — nghe như lỗi npm, thật ra
# là một trình duyệt.
#
# Không tải cũng KHÔNG mất gì: máy chủ không vẽ sơ đồ. Sơ đồ dựng trên máy cá
# nhân bằng `npm run drawio:shoot`, và script đó dùng Chrome của hệ thống.
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Chỉ chép hai file kê khai trước: đổi mã nguồn thì tầng npm ci vẫn dùng lại
# được cache, còn đổi package.json thì mới cài lại.
COPY package.json package-lock.json ./

# ---------------------------------------------------------------------------
# 2. Biên dịch TypeScript
# ---------------------------------------------------------------------------
FROM toolchain AS build
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# 3. Phụ thuộc chạy thật — không có devDependencies
# ---------------------------------------------------------------------------
FROM toolchain AS prod-deps
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 4. Ảnh chạy
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/dist         ./dist
COPY package.json ./

# `public` phải nằm cùng thư mục làm việc: main.ts phục vụ tệp tĩnh bằng
# `express.static('public')` — đường dẫn TƯƠNG ĐỐI so với cwd. Chạy `node` từ
# thư mục khác là mọi ảnh trả về 404 mà không có lỗi nào.
COPY public ./public

# Người dùng `node` (uid 1000) có sẵn trong ảnh chính thức. Chạy bằng root thì
# một lỗ hổng trong tầng ứng dụng thành quyền root trong container.
# Thư mục ảnh phải thuộc về nó, vì đây là thư mục DUY NHẤT tiến trình ghi vào.
RUN mkdir -p public/images && chown -R node:node public
USER node

EXPOSE 3000

# Healthcheck gọi `GET /health` — nằm ngoài prefix `/api/v1`, xem
# core/routing.config.ts.
#
# Trước đây nó gọi `GET /`, và chú thích ở đây tự thừa nhận khuyết tật: route đó
# chỉ nói tiến trình Node còn sống, không chạm database, nên cụm vẫn báo healthy
# khi MySQL đã chết — đúng cái tình huống cần phát hiện thì lại không phát hiện.
#
# `/health` ping thật vào database và trả 503 khi không chạm được. Redis chết
# thì VẪN 200 (chỉ ghi `redis: "down"`): cache và throttler đều đã fail-open nên
# API vẫn phục vụ, và để Redis giết container là tự làm hỏng thứ còn chạy được.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
