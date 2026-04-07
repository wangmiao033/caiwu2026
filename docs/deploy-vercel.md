# Vercel 部署说明

同一个 GitHub 仓库建立两个 Vercel Project。

## A. 部署 web-admin

1. 在 Vercel 导入仓库 `wangmiao033/caiwu2026`
2. Root Directory 选择：`web-admin`
3. Framework 自动识别：Next.js
4. 设置环境变量：
   - `BACKEND_BASE_URL=https://<你的-backend-域名>`
5. 点击 Deploy

## B. 部署 backend

1. 再创建一个 Vercel Project，仍选择同一个仓库
2. Root Directory 选择：`backend`
3. Python Runtime 由 `vercel.json` + `api/index.py` 适配
4. 设置环境变量：
   - `DATABASE_URL`（可先用 sqlite，建议后续改外部数据库）
5. 点击 Deploy

## 前后端联调

- 前端所有请求走 Next API 代理：`/api/proxy/...`
- 代理目标取 `BACKEND_BASE_URL`
- 上线后 `BACKEND_BASE_URL` 必须设置为 backend 项目的线上 URL

## 常见问题排查

- 前端 500 / 接口失败：检查 `BACKEND_BASE_URL` 是否正确
- 后端导入失败：检查上传文件字段是否包含 `channel_name/game_name/gross_amount`
- Vercel 后端超时：单次导入文件过大，建议分批导入
