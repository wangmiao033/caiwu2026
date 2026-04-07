import { NextRequest, NextResponse } from "next/server";

const backendBase = process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

type ManualRow = {
  channel_name?: string;
  game_name?: string;
  gross_amount?: number;
};

type ManualPayload = {
  period?: string;
  rows?: ManualRow[];
};

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as ManualPayload;
  const period = (payload.period || "").trim();
  const rows = payload.rows || [];
  if (!period) {
    return NextResponse.json({ detail: "period 不能为空" }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ detail: "rows 不能为空" }, { status: 400 });
  }

  const invalid = rows.find(
    (r) =>
      !r.channel_name ||
      !r.game_name ||
      typeof r.gross_amount !== "number" ||
      Number.isNaN(r.gross_amount)
  );
  if (invalid) {
    return NextResponse.json({ detail: "存在无效行：渠道/游戏不能为空且流水必须为数字" }, { status: 400 });
  }

  const csvHeader = "channel_name,game_name,gross_amount";
  const csvBody = rows
    .map((r) => `${r.channel_name},${r.game_name},${r.gross_amount}`)
    .join("\n");
  const csvText = `${csvHeader}\n${csvBody}`;

  const formData = new FormData();
  formData.append("file", new Blob([csvText], { type: "text/csv" }), "manual_import.csv");

  const role = request.headers.get("x-role") || "finance";
  const user = request.headers.get("x-user") || "finance_user";
  const resp = await fetch(`${backendBase}/recon/import?period=${encodeURIComponent(period)}`, {
    method: "POST",
    headers: {
      "x-role": role,
      "x-user": user,
    },
    body: formData,
  });

  const contentType = resp.headers.get("content-type") || "application/json";
  return new NextResponse(await resp.arrayBuffer(), {
    status: resp.status,
    headers: { "content-type": contentType },
  });
}
