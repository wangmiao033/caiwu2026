# web-admin

Next.js + Ant Design 的正式财务后台前端。

## 本地运行

```bash
npm install
npm run dev
```

访问：`http://localhost:3000`

## 构建检查

```bash
npm run build
```

## 环境变量

复制 `.env.example` 为 `.env.local`：

```bash
BACKEND_BASE_URL=http://127.0.0.1:8000
# 浏览器直连后端（合同 PDF 识别上传，绕过 Serverless 请求体限制；需与 BACKEND_BASE_URL 指向同一 API）
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
```

说明：

- 前端通过 `src/app/api/proxy/[...path]/route.ts` 转发接口到后端。
- `BACKEND_BASE_URL` 用于控制代理转发目标（本地/线上）。
- `NEXT_PUBLIC_BACKEND_URL`：仅「合同 PDF → `/contracts/import-draft/parse`」走浏览器直传，须能被用户浏览器访问；部署时请填后端公网 HTTPS 地址。本地可省略（开发环境默认 `http://127.0.0.1:8000`）。后端需放开对应来源的 CORS（见后端 `CORS_ALLOW_ORIGINS`）。

## Vercel 部署

- Root Directory：`web-admin`
- Framework Preset：Next.js
- Build Command：`npm run build`（默认）
- Install Command：`npm install`（默认）
- 需要设置环境变量：`BACKEND_BASE_URL`（值为后端线上地址）
- 需要设置环境变量：`NEXT_PUBLIC_BACKEND_URL`（与上相同、可公网访问的后端根地址，供合同 PDF 直传解析）
