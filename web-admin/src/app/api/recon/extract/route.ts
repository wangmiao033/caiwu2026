import { NextRequest, NextResponse } from "next/server";

const backendBase = process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

type ExtractPayload = {
  period?: string;
  rows?: { game_name: string; channel_name: string; gross_amount: number; __rowNum__?: number; error?: string }[];
};

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as ExtractPayload;
  const period = (payload.period || "").trim();
  const rows = (payload.rows || []).filter((x) => !x.error);
  if (!period) {
    return NextResponse.json({ detail: "period 不能为空" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ detail: "无可导入数据" }, { status: 400 });
  }
  const csv = ["channel_name,game_name,gross_amount", ...rows.map((r) => `${r.channel_name},${r.game_name},${r.gross_amount}`)].join("\n");
  const formData = new FormData();
  formData.append("file", new Blob([csv], { type: "text/csv" }), "extract_import.csv");

  const role = request.headers.get("x-role") || "finance";
  const user = request.headers.get("x-user") || "finance_user";
  const authorization = request.headers.get("authorization");
  const resp = await fetch(`${backendBase}/recon/import?period=${encodeURIComponent(period)}&import_type=extract`, {
    method: "POST",
    headers: { "x-role": role, "x-user": user, ...(authorization ? { authorization } : {}) },
    body: formData,
  });
  return new NextResponse(await resp.arrayBuffer(), {
    status: resp.status,
    headers: { "content-type": resp.headers.get("content-type") || "application/json" },
  });
}
