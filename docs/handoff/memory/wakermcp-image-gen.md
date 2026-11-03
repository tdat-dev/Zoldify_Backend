---
name: wakermcp-image-gen
description: "wakermcp = MCP sinh ảnh/video (gpt-image-2 qua cliproxy.zoldify.com), cách fix crash + pipeline tạo ảnh sản phẩm"
metadata: 
  node_type: memory
  type: reference
  originSessionId: <session>
  modified: 2026-08-27T06:34:41.005Z
---

**wakermcp** (`D:/ByteWaker/WakerMCP/dist/index.js`, khai trong `~/.claude.json`) là MCP **sinh
ảnh/video** — KHÁC `wakercontext` (code-graph). Tools: `generate_image`, `generate_video`,
`remove_background`, `upscale`, `list_providers`. Providers: fal / gemini / openai.

**Cấu hình sẵn** ở `~/.wakermcp/config.json`: defaultProvider `cliproxyapi` = OpenAI-compatible
endpoint **`https://cliproxy.zoldify.com/v1`**, model **`gpt-image-2`**, có apiKey (proxy của
Zoldify). outDir `assets/ai`.

**Fix khi chết** (2026-08-27): entry point ném `ERR_MODULE_NOT_FOUND @modelcontextprotocol/sdk`
→ thiếu node_modules → `cd D:/ByteWaker/WakerMCP && npm install` → `/mcp` Reconnect (không cần
restart phiên). Xem [[pitfall_mcp_server_32000_missing_node_modules]].

**Dùng trực tiếp KHÔNG cần MCP reconnect** (gọi endpoint thẳng — nhanh hơn chờ reconnect):
`POST {baseUrl}/images/generations` header `Authorization: Bearer {apiKey}`, body
`{model, prompt, size:"1024x1024", n:1}` → trả `data[0].b64_json` (base64 PNG). Key/base lấy từ
`~/.wakermcp/config.json` (customProviders[0]).

**Pipeline tạo ảnh sản phẩm Zoldify** (đã dùng 2026-08-27 thay 15 ảnh seed xấu → catalog nền
trắng đẹp): generate (b64) → decode PNG → upload `POST /files/upload` field `fileUpload` header
`folder_type: products` (token seller@zoldify.com/<pass> id 1 sở hữu mọi seed) → trả `{url}` trên
`img.zoldify.com` → `PATCH /products/:id {image:url}`. Prompt tốt: "Professional e-commerce catalog
product photograph of {name}. Single product isolated on clean seamless pure white studio
background, centered, soft studio lighting, photorealistic, no text, no people, square." Chất
lượng cao (render đúng cả logo Apple/Adidas/Panasonic). Ảnh cũ = stock Unsplash 4:3 crop lệch.
