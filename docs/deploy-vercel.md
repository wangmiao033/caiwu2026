# Vercel 部署说明

同一个 GitHub 仓库建立两个 Vercel Project。

## 0) 前置准备（必须）

- 准备一个外部数据库（推荐 PostgreSQL），拿到连接串作为 `DATABASE_URL`
- 确认 backend 已部署成功后，再部署 web-admin 并填 `BACKEND_BASE_URL`

## A. 部署 backend（点击级清单）

1. 在 Vercel 导入仓库 `wangmiao033/caiwu2026`
2. Project Name 输入：`caiwu2026-backend`（可自定义）
3. Root Directory 选择：`backend`
4. Environment Variables 中新增：
   - `APP_ENV=production`
   - `DATABASE_URL=<你的外部数据库连接串>`
5. 点击 Deploy
6. 部署完成后访问：`https://<backend-domain>/docs`，确认可打开

重要：

- Vercel 线上不要使用 SQLite 文件作为正式数据库
- 未配置 `DATABASE_URL` 时，backend 在非本地环境会启动失败（防止误用本地库）

## B. 部署 web-admin（点击级清单）

1. 在 Vercel 再创建一个 Project，仍选择同一仓库
2. Project Name 输入：`caiwu2026-web-admin`（可自定义）
3. Root Directory 选择：`web-admin`
4. Environment Variables 中新增：
   - `BACKEND_BASE_URL=https://<backend-domain>`
5. 点击 Deploy
6. 打开前端页面，登录后检查导入/账单等接口是否正常

## 前后端联调

- 前端所有请求走 Next API 代理：`/api/proxy/...`
- 代理目标取 `BACKEND_BASE_URL`
- 上线后 `BACKEND_BASE_URL` 必须设置为 backend 项目的线上 URL

## 常见问题排查

- 前端 500 / 接口失败：检查 `BACKEND_BASE_URL` 是否正确
- backend 部署后 500：检查 `DATABASE_URL` 是否已在 Vercel 配置
- backend 启动异常 `DATABASE_URL is required`：说明线上环境未配置外部数据库
- 后端导入失败：检查上传文件字段是否包含 `channel_name/game_name/gross_amount`
- Vercel 后端超时：单次导入文件过大，建议分批导入
