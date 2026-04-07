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
```

说明：

- 前端通过 `src/app/api/proxy/[...path]/route.ts` 转发接口到后端。
- `BACKEND_BASE_URL` 用于控制代理转发目标（本地/线上）。

## Vercel 部署

- Root Directory：`web-admin`
- Framework Preset：Next.js
- Build Command：`npm run build`（默认）
- Install Command：`npm install`（默认）
- 需要设置环境变量：`BACKEND_BASE_URL`（值为后端线上地址）
