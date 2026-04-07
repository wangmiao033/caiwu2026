import { NextRequest, NextResponse } from "next/server";
import { normalizeByMapping, previewRawRows, readSheets } from "@/lib/server/recon";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ detail: "请上传文件" }, { status: 400 });
  }
  const action = String(form.get("action") || "sheets");
  const buffer = await file.arrayBuffer();
  try {
    if (action === "sheets") {
      return NextResponse.json({ sheets: readSheets(buffer) });
    }
    if (action === "tablePreview") {
      const sheetName = String(form.get("sheetName") || "");
      const titleRow = Number(form.get("titleRow") || 1);
      const data = previewRawRows(buffer, sheetName, titleRow, 20);
      return NextResponse.json(data);
    }
    if (action === "normalizePreview") {
      const sheetName = String(form.get("sheetName") || "");
      const titleRow = Number(form.get("titleRow") || 1);
      const gameCol = String(form.get("gameCol") || "");
      const channelCol = String(form.get("channelCol") || "");
      const amountCol = String(form.get("amountCol") || "");
      const data = normalizeByMapping(buffer, sheetName, titleRow, { gameCol, channelCol, amountCol });
      return NextResponse.json(data);
    }
    return NextResponse.json({ detail: "未知 action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ detail: (e as Error).message }, { status: 400 });
  }
}
