import * as XLSX from "xlsx";

export type RawExtractRow = {
  __rowNum__: number;
  game_name: string;
  channel_name: string;
  gross_amount_raw: string;
  gross_amount?: number;
  error?: string;
};

function normalizeText(v: unknown): string {
  return String(v ?? "").replace(/\u3000/g, " ").trim();
}

function parseAmount(v: unknown): { value?: number; error?: string } {
  const raw = normalizeText(v).replace(/,/g, "").replace(/\s/g, "");
  if (!raw || raw === "#N/A") {
    return { error: "空白或非法金额" };
  }
  const amount = Number(raw);
  if (Number.isNaN(amount)) {
    return { error: "金额非数字" };
  }
  return { value: amount };
}

function isSummaryRow(text: string): boolean {
  return /(合计|汇总|总计|小计)/.test(text);
}

export function readSheets(fileBuffer: ArrayBuffer) {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  return wb.SheetNames;
}

export function previewRawRows(fileBuffer: ArrayBuffer, sheetName: string, titleRow: number, limit = 20) {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error("sheet 不存在");
  }
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });
  const header = rows[Math.max(0, titleRow - 1)] || [];
  const body = rows.slice(titleRow, titleRow + limit);
  return { header, body };
}

export function normalizeByMapping(
  fileBuffer: ArrayBuffer,
  sheetName: string,
  titleRow: number,
  mapping: { gameCol: string; channelCol: string; amountCol: string }
) {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error("sheet 不存在");
  }
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
  });
  const header = (rows[Math.max(0, titleRow - 1)] || []).map((h) => normalizeText(h));
  const gameIdx = header.findIndex((x) => x === mapping.gameCol);
  const channelIdx = header.findIndex((x) => x === mapping.channelCol);
  const amountIdx = header.findIndex((x) => x === mapping.amountCol);
  if (gameIdx < 0 || channelIdx < 0 || amountIdx < 0) {
    throw new Error("字段映射不正确，请确认列名");
  }

  const normalized: RawExtractRow[] = [];
  const body = rows.slice(titleRow);
  body.forEach((r, i) => {
    const game = normalizeText(r[gameIdx]);
    const channel = normalizeText(r[channelIdx]);
    const amountRaw = normalizeText(r[amountIdx]);
    const rowNum = titleRow + i + 1;
    if (!game && !channel && !amountRaw) {
      return;
    }
    if (isSummaryRow(game) || isSummaryRow(channel)) {
      return;
    }
    const amountParsed = parseAmount(amountRaw);
    const item: RawExtractRow = {
      __rowNum__: rowNum,
      game_name: game,
      channel_name: channel,
      gross_amount_raw: amountRaw,
    };
    if (!game || !channel) {
      item.error = "游戏或渠道为空";
    } else if (amountParsed.error) {
      item.error = amountParsed.error;
    } else {
      item.gross_amount = amountParsed.value;
    }
    normalized.push(item);
  });

  const total = normalized.length;
  const errorCount = normalized.filter((x) => x.error).length;
  const amountSum = normalized
    .filter((x) => !x.error && typeof x.gross_amount === "number")
    .reduce((s, x) => s + (x.gross_amount || 0), 0);
  return { rows: normalized, summary: { total, errorCount, amountSum } };
}
