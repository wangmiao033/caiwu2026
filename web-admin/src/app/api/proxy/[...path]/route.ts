import { NextRequest, NextResponse } from "next/server";

const backendBase = process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

async function forward(request: NextRequest, path: string[]) {
  const url = `${backendBase}/${path.join("/")}${request.nextUrl.search}`;
  const method = request.method;
  const headers = new Headers();
  const role = request.headers.get("x-role") || "finance";
  const user = request.headers.get("x-user") || "finance_user";
  headers.set("x-role", role);
  headers.set("x-user", user);

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      body = await request.formData();
    } else {
      body = await request.text();
      if (contentType) {
        headers.set("content-type", contentType);
      }
    }
  }

  const resp = await fetch(url, { method, headers, body });
  const outHeaders = new Headers();
  const respType = resp.headers.get("content-type");
  if (respType) {
    outHeaders.set("content-type", respType);
  }
  return new NextResponse(await resp.arrayBuffer(), {
    status: resp.status,
    headers: outHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}
