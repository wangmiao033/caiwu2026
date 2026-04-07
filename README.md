# caiwu2026

公司内部对账系统单仓库，包含：

- `backend/`：FastAPI 后端（Vercel Project #1）
- `web-admin/`：Next.js + Ant Design 正式后台（Vercel Project #2）
- `streamlit-ui/`：临时工具页（非正式生产入口）
- `docs/`：使用说明、导入说明、部署说明

## 目录结构

```text
caiwu2026/
  backend/
  web-admin/
  streamlit-ui/
  docs/
  README.md
```

## 本地启动

### 1) 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### 2) 启动前端

```bash
cd web-admin
npm install
npm run dev
```

访问：

- 后端文档：`http://127.0.0.1:8000/docs`
- 前端后台：`http://localhost:3000`

## 环境变量

请复制以下示例文件后再运行：

- 根目录：`.env.example`
- 前端：`web-admin/.env.example`
- 后端：`backend/.env.example`

关键变量：

- `BACKEND_BASE_URL`：前端 Next API 代理转发到后端的地址
- `DATABASE_URL`：后端数据库连接

## Vercel 部署（双 Project）

同一个 GitHub 仓库创建两个 Vercel Project：

1. `web-admin` 项目：Root Directory = `web-admin`
2. `backend` 项目：Root Directory = `backend`

详细步骤见：

- `docs/deploy-vercel.md`
- `docs/usage.md`
- `docs/import-template.md`
