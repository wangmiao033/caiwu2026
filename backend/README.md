# backend

FastAPI 对账系统后端，保持现有核心业务逻辑不变。

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## 环境变量

- `DATABASE_URL`：数据库连接字符串
  - 本地默认：`sqlite:///./reconciliation.db`
  - 生产可改为 PostgreSQL 连接

## Vercel 部署

- Root Directory：`backend`
- Vercel Runtime：Python（由 `vercel.json` 和 `api/index.py` 适配）
- API 入口：`api/index.py`（导出 `app`）

说明：

- 已将所有路径路由到同一个 FastAPI 应用。
- 若导入文件较大，Vercel Function 会受执行时长与体积限制，应控制单次导入规模。
