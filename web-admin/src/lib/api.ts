"use client";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function apiRequest<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  isFormData = false
): Promise<T> {
  const role = localStorage.getItem("x_role") || "finance";
  const user = localStorage.getItem("x_user") || "finance_user";
  const headers: Record<string, string> = {
    "x-role": role,
    "x-user": user,
  };
  if (!isFormData) {
    headers["content-type"] = "application/json";
  }
  const resp = await fetch(`/api/proxy${path}`, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail || parsed.message || text;
    } catch {}
    throw new Error(detail || `请求失败: ${resp.status}`);
  }
  const contentType = resp.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }
  return {} as T;
}

export async function apiRequestDirect<T>(
  url: string,
  method: HttpMethod = "GET",
  body?: unknown,
  isFormData = false
): Promise<T> {
  const role = localStorage.getItem("x_role") || "finance";
  const user = localStorage.getItem("x_user") || "finance_user";
  const headers: Record<string, string> = {
    "x-role": role,
    "x-user": user,
  };
  if (!isFormData) {
    headers["content-type"] = "application/json";
  }
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail || parsed.message || text;
    } catch {}
    throw new Error(detail || `请求失败: ${resp.status}`);
  }
  const contentType = resp.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }
  return {} as T;
}
