"use client";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function getAuthHeaders(isFormData: boolean): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") || "" : "";
  const role = typeof window !== "undefined" ? localStorage.getItem("x_role") || "finance_manager" : "finance_manager";
  const user = typeof window !== "undefined" ? localStorage.getItem("x_user") || "finance_user" : "finance_user";
  const headers: Record<string, string> = {
    "x-role": role,
    "x-user": user,
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (!isFormData) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

function handleUnauthorized(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("access_token");
    localStorage.removeItem("fake_token");
    localStorage.removeItem("x_role");
    localStorage.removeItem("x_user");
    window.location.href = "/login";
  }
}

export async function apiRequest<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  isFormData = false
): Promise<T> {
  const headers = getAuthHeaders(isFormData);
  const resp = await fetch(`/api/proxy${path}`, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (!resp.ok) {
    handleUnauthorized(resp.status);
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
  const headers = getAuthHeaders(isFormData);
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (!resp.ok) {
    handleUnauthorized(resp.status);
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
