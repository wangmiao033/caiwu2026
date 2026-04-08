"use client";

import { apiRequest } from "@/lib/api";

export type ExceptionType =
  | "share"
  | "channel"
  | "game"
  | "import"
  | "overdue"
  | "unmatched_channel"
  | "unmatched_game"
  | "unmapped_pair"
  | "variant_unmatched"
  | "import_failed";
export type ExceptionStatus = "pending" | "ignored" | "resolved";
export type ExceptionStatusText = "待处理" | "已忽略" | "已解决";
export type ExceptionRange = "7d" | "30d" | "90d";

export type ExceptionOverviewResponse = {
  summary: Record<string, number>;
  items: Record<string, Array<Record<string, unknown>>>;
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
