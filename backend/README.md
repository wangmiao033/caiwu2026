# backend

FastAPI 对账系统后端，保持现有核心业务逻辑不变。

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## 环境变量

- `APP_ENV`：运行环境标记
  - 本地建议：`local`
  - 线上建议：`production`
- `DATABASE_URL`：数据库连接字符串
  - 本地开发：可使用 SQLite（`sqlite:///./reconciliation.db`）
  - Vercel 线上：必须使用外部数据库连接（例如 PostgreSQL），不要使用本地 SQLite 文件
- `ADMIN_USERNAME`：管理员用户名（单管理员模式）
- `ADMIN_PASSWORD`：管理员密码（单管理员模式）
  - 未配置时默认 `admin / 123456`（仅建议本地开发使用）

数据库加载策略：

- 优先读取 `DATABASE_URL`
- 若未设置 `DATABASE_URL` 且是本地模式（`APP_ENV=local` 或非 Vercel），回退 SQLite
- 若是非本地环境（如 Vercel）且没配 `DATABASE_URL`，启动直接报错

## Vercel 部署

- Root Directory：`backend`
- Vercel Runtime：Python（由 `vercel.json` 和 `api/index.py` 适配）
- API 入口：`api/index.py`（导出 `app`）
- 必填环境变量：
  - `APP_ENV=production`
  - `DATABASE_URL=<外部数据库连接串>`

说明：

- 已将所有路径路由到同一个 FastAPI 应用。
- 若导入文件较大，Vercel Function 会受执行时长与体积限制，应控制单次导入规模。
