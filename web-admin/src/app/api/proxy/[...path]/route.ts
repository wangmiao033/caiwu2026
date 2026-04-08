import { NextRequest, NextResponse } from "next/server";

const backendBase = process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";
const runningOnVercel = Boolean(process.env.VERCEL);

async function forward(request: NextRequest, path: string[]) {
  if (runningOnVercel && !process.env.BACKEND_BASE_URL) {
    return NextResponse.json(
      { detail: "环境变量缺失：web-admin 未配置 BACKEND_BASE_URL，无法转发登录请求" },
      { status: 500 }
    );
  }
  const url = `${backendBase}/${path.join("/")}${request.nextUrl.search}`;
  const method = request.method;
  const headers = new Headers();
  const role = request.headers.get("x-role") || "finance_manager";
  const user = request.headers.get("x-user") || "finance_user";
  const authorization = request.headers.get("authorization");
  headers.set("x-role", role);
  headers.set("x-user", user);
  if (authorization) {
    headers.set("authorization", authorization);
  }

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      // 原样透传 multipart：避免 formData() 在函数内完整解析/再封装导致体积与内存暴涨，触发 payload 上限。
      const ct = request.headers.get("content-type");
      if (ct) {
        headers.set("content-type", ct);
      }
      const contentLength = request.headers.get("content-length");
      if (contentLength) {
        headers.set("content-length", contentLength);
      }
      body = request.body ?? undefined;
    } else {
      body = await request.text();
      if (contentType) {
        headers.set("content-type", contentType);
      }
    }
  }

  try {
    const fetchInit: RequestInit & { duplex?: "half" } = { method, headers, body };
    if (body instanceof ReadableStream) {
      fetchInit.duplex = "half";
    }
    const resp = await fetch(url, fetchInit);
    const outHeaders = new Headers();
    const respType = resp.headers.get("content-type");
    if (respType) {
      outHeaders.set("content-type", respType);
    }
    return new NextResponse(await resp.arrayBuffer(), {
      status: resp.status,
      headers: outHeaders,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      { detail: `代理转发失败：无法访问后端 ${backendBase}，请检查 BACKEND_BASE_URL 与后端服务状态。(${reason})` },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}
