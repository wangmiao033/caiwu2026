"use client";

import { apiRequest } from "@/lib/api";

export type ExceptionType = "share" | "channel" | "game" | "import" | "overdue";
export type ExceptionStatus = "pending" | "ignored" | "resolved";
export type ExceptionStatusText = "待处理" | "已忽略" | "已解决";
export type ExceptionRange = "7d" | "30d" | "90d";

export type ExceptionOverviewResponse = {
  summary: {
    total: number;
    share: number;
    channel: number;
    game: number;
    import: number;
    overdue: number;
  };
  items: {
    share: Array<Record<string, unknown>>;
    channel: Array<Record<string, unknown>>;
    game: Array<Record<string, unknown>>;
    import: Array<Record<string, unknown>>;
    overdue: Array<Record<string, unknown>>;
  };
};

export async function getExceptionsOverview(params: {
  range: ExceptionRange;
  status: "all" | ExceptionStatus;
  type: "all" | ExceptionType;
}): Promise<ExceptionOverviewResponse> {
  const query = new URLSearchParams({
    range: params.range,
    status: params.status,
    type: params.type,
  });
  return apiRequest<ExceptionOverviewResponse>(`/exceptions/overview?${query.toString()}`);
}

export async function updateExceptionStatus(payload: {
  type: ExceptionType;
  id: string;
  status: ExceptionStatus;
  remark?: string;
}) {
  return apiRequest<{ ok: boolean }>("/exceptions/status", "POST", payload);
}
