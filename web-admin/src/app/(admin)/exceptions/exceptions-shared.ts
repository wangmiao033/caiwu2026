import {
  type ExceptionOverviewResponse,
  type ExceptionRange,
  type ExceptionStatus,
  type ExceptionType,
} from "@/lib/api/exceptions";

export type ExceptionStatusText = "待处理" | "已忽略" | "已解决";
export type DayRange = 7 | 30 | 90;
export type StatusFilter = "all" | ExceptionStatusText;
export type TypeFilter = "all" | ExceptionType;
export type SourceFilter = "all" | "import_issue" | "channel_game_map" | "import_history" | "billing" | "import";

export type UnifiedExceptionRow = {
  key: string;
  id: string;
  type: ExceptionType;
  typeLabel: string;
  source: string;
  sourceLabel: string;
  status: ExceptionStatusText;
  detectedAt: string;
  taskId?: number;
  importHistoryId?: number;
  period?: string;
  batchName?: string;
  detail: string;
  raw: Record<string, unknown>;
};

export const TYPE_LABEL: Record<ExceptionType, string> = {
  share: "分成异常",
  channel: "未匹配渠道(旧)",
  game: "未匹配游戏(旧)",
  import: "导入失败(旧)",
  overdue: "超期未结算",
  unmatched_channel: "未匹配渠道",
  unmatched_game: "未匹配游戏",
  unmapped_pair: "未映射组合",
  variant_unmatched: "版本未匹配",
  import_failed: "导入失败",
};

export const STATUS_COLOR: Record<ExceptionStatusText, string> = {
  待处理: "red",
  已忽略: "default",
  已解决: "green",
};

const TYPE_WHITE_LIST: TypeFilter[] = [
  "all",
  "share",
  "unmatched_channel",
  "unmatched_game",
  "unmapped_pair",
  "variant_unmatched",
  "import_failed",
  "overdue",
];

export const parseTypeFilter = (value: string | null): TypeFilter =>
  value && TYPE_WHITE_LIST.includes(value as TypeFilter) ? (value as TypeFilter) : "all";

export const parseStatusFilter = (value: string | null): StatusFilter => {
  if (value === "pending") return "待处理";
  if (value === "ignored") return "已忽略";
  if (value === "resolved") return "已解决";
  return "all";
};

export const parseRangeFilter = (value: string | null): DayRange => {
  if (value === "7d") return 7;
  if (value === "90d") return 90;
  return 30;
};

export const rangeToQuery = (value: DayRange): ExceptionRange => (value === 7 ? "7d" : value === 90 ? "90d" : "30d");

export const toStatusText = (status: string): ExceptionStatusText => {
  if (status === "ignored") return "已忽略";
  if (status === "resolved") return "已解决";
  return "待处理";
};

export const toStatusValue = (status: ExceptionStatusText): ExceptionStatus => {
  if (status === "已忽略") return "ignored";
  if (status === "已解决") return "resolved";
  return "pending";
};

export const statusFilterToQuery = (value: StatusFilter): "all" | ExceptionStatus => (value === "all" ? "all" : toStatusValue(value));

export const sourceLabel = (source: string) => {
  if (source === "import_issue") return "导入批次异常";
  if (source === "channel_game_map") return "分成规则";
  if (source === "import_history") return "导入历史";
  if (source === "billing") return "账单";
  if (source === "import") return "导入数据";
  return source || "未知来源";
};

export const normalizeType = (rawType: string): ExceptionType => {
  const known = rawType as ExceptionType;
  if (
    [
      "share",
      "channel",
      "game",
      "import",
      "overdue",
      "unmatched_channel",
      "unmatched_game",
      "unmapped_pair",
      "variant_unmatched",
      "import_failed",
    ].includes(known)
  ) {
    return known;
  }
  return "import_failed";
};

export const parsePairFromDetail = (detail: string): { channel: string; game: string } => {
  const text = detail || "";
  const part = text.split(":").slice(1).join(":").trim();
  const seg = part || text;
  const [channel, game] = seg.split("/").map((s) => s.trim());
  return { channel: channel || "", game: game || "" };
};

export const formatRatioPercent = (ratio: unknown) => {
  const n = Number(ratio);
  if (Number.isNaN(n)) return "-";
  return `${Number((n * 100).toFixed(4)).toString()}%`;
};

export const shareExceptionReasonText = (raw: Record<string, unknown>) => {
  const total = Number(raw.total_ratio);
  if (!Number.isNaN(total)) {
    return `渠道-游戏映射中分成比例合计为 ${formatRatioPercent(total)}，与 100% 不一致，需调整该渠道与游戏对应规则或映射。`;
  }
  return "渠道-游戏映射中渠道分成与研发分成（等）合计偏离 100%，请核对并修正。";
};

/** 后端 key：${type}:${id} */
export const parseExceptionRouteKey = (raw: string): { type: ExceptionType; id: string } | null => {
  const key = (raw || "").trim();
  const idx = key.indexOf(":");
  if (idx <= 0 || idx >= key.length - 1) return null;
  const typePart = key.slice(0, idx);
  const idPart = key.slice(idx + 1);
  const type = normalizeType(typePart);
  return { type, id: idPart };
};

export type ExceptionListContext = {
  typeFilter: TypeFilter;
  statusQuery: "all" | ExceptionStatus;
  range: DayRange;
};

export const listContextFromFilters = (typeFilter: TypeFilter, statusFilter: StatusFilter, range: DayRange): ExceptionListContext => ({
  typeFilter,
  statusQuery: statusFilterToQuery(statusFilter),
  range,
});

const parseExStatusQuery = (value: string | null): "all" | ExceptionStatus => {
  if (value === "pending" || value === "ignored" || value === "resolved" || value === "all") return value;
  return "all";
};

export const listContextFromSearchParams = (sp: { get: (k: string) => string | null }): ExceptionListContext => ({
  typeFilter: parseTypeFilter(sp.get("ex_type")),
  statusQuery: parseExStatusQuery(sp.get("ex_status")),
  range: parseRangeFilter(sp.get("ex_range")),
});

export const exceptionHandleQuery = (ctx: ExceptionListContext) => {
  const q = new URLSearchParams();
  q.set("ex_type", String(ctx.typeFilter));
  q.set("ex_status", String(ctx.statusQuery));
  q.set("ex_range", rangeToQuery(ctx.range));
  return q.toString();
};

const appendExceptionListContext = (qs: URLSearchParams, ctx: ExceptionListContext) => {
  qs.set("ex_type", String(ctx.typeFilter));
  qs.set("ex_status", String(ctx.statusQuery));
  qs.set("ex_range", rangeToQuery(ctx.range));
};

export const flattenOverviewToRows = (overview: ExceptionOverviewResponse | null): UnifiedExceptionRow[] => {
  if (!overview) return [];
  const out: UnifiedExceptionRow[] = [];
  const items = overview.items || {};
  Object.entries(items).forEach(([bucket, arr]) => {
    (arr || []).forEach((rawRow) => {
      const row = rawRow as Record<string, unknown>;
      const type = normalizeType(String(row.type || bucket || "import_failed"));
      const id = String(row.id || "");
      const source = String(row.source_module || bucket || "");
      const status = toStatusText(String(row.status || "pending"));
      const detailText = String(row.detail || row.fail_reason || row.match_status || "");
      out.push({
        key: `${type}:${id}`,
        id,
        type,
        typeLabel: TYPE_LABEL[type] || type,
        source,
        sourceLabel: sourceLabel(source),
        status,
        detectedAt: String(row.detected_at || ""),
        taskId: Number(row.task_id || 0) || undefined,
        importHistoryId: Number(row.import_history_id || 0) || undefined,
        period: String(row.period || ""),
        batchName: String(row.batch_name || ""),
        detail: detailText || "请通过快捷入口处理该异常",
        raw: row,
      });
    });
  });
  return out.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
};

export const buildQuickNavigationUrl = (row: UnifiedExceptionRow, ctx: ExceptionListContext): string => {
  if (row.type === "unmatched_channel" || row.type === "channel") {
    const ch = String(row.raw.raw_channel_name || "");
    return `/channels${ch ? `?keyword=${encodeURIComponent(ch)}` : ""}`;
  }
  if (row.type === "unmatched_game" || row.type === "game") {
    const gm = String(row.raw.raw_game_name || "");
    return `/games${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`;
  }
  if (row.type === "unmapped_pair") {
    const { channel, game } = parsePairFromDetail(row.detail);
    const qs = new URLSearchParams();
    if (channel) qs.set("channel", channel);
    if (game) qs.set("game", game);
    appendExceptionListContext(qs, ctx);
    return `/channel-game-map?${qs.toString()}`;
  }
  if (row.type === "variant_unmatched") {
    const gm = row.detail.split(":").slice(1).join(":").trim();
    return `/game-variants${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`;
  }
  if (row.type === "share") {
    const ch = String(row.raw.channel_name || "").trim();
    const gm = String(row.raw.game_name || "").trim();
    const qs = new URLSearchParams();
    if (ch) qs.set("channel", ch);
    if (gm) qs.set("game", gm);
    appendExceptionListContext(qs, ctx);
    return `/billing-rules?${qs.toString()}`;
  }
  if (row.type === "overdue") {
    return "/billing";
  }
  return "/import?tab=history";
};

export const buildGamesManagementUrl = (row: UnifiedExceptionRow): string => {
  if (row.type === "unmatched_game" || row.type === "game") {
    const gm = String(row.raw.raw_game_name || "");
    return `/games${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`;
  }
  if (row.type === "variant_unmatched") {
    const gm = row.detail.split(":").slice(1).join(":").trim();
    return `/games${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`;
  }
  return "/games";
};

export const buildChannelGameMapHubUrl = (row: UnifiedExceptionRow, ctx: ExceptionListContext): string => {
  const qs = new URLSearchParams();
  if (row.type === "share") {
    const ch = String(row.raw.channel_name || "").trim();
    const gm = String(row.raw.game_name || "").trim();
    if (ch) qs.set("channel", ch);
    if (gm) qs.set("game", gm);
  } else if (row.type === "unmapped_pair") {
    const { channel, game } = parsePairFromDetail(row.detail);
    if (channel) qs.set("channel", channel);
    if (game) qs.set("game", game);
  }
  appendExceptionListContext(qs, ctx);
  return `/channel-game-map?${qs.toString()}`;
};

export const buildBillingRulesHubUrl = (row: UnifiedExceptionRow, ctx: ExceptionListContext): string => {
  const qs = new URLSearchParams();
  if (row.type === "share") {
    const ch = String(row.raw.channel_name || "").trim();
    const gm = String(row.raw.game_name || "").trim();
    if (ch) qs.set("channel", ch);
    if (gm) qs.set("game", gm);
  }
  appendExceptionListContext(qs, ctx);
  return `/billing-rules?${qs.toString()}`;
};

export const IMPORT_DATA_CENTER_PATH = "/import?tab=history";

export const getSuggestedHandlingText = (row: UnifiedExceptionRow): string => {
  if (row.type === "share") {
    return `建议在「规则配置」中按渠道、游戏筛选后编辑对应行，或到「渠道-游戏映射」核对 revenue_share_ratio / rd_settlement_ratio；亦可使用下方「快捷处理」直达。异常说明：${shareExceptionReasonText(row.raw)}`;
  }
  if (row.type === "unmapped_pair") {
    return "建议在「渠道-游戏映射」中补全该渠道与游戏的映射关系，并核对分成比例。";
  }
  if (row.type === "unmatched_channel" || row.type === "channel") {
    return "建议在「渠道管理」中补充或修正渠道主数据，确保与流水一致。";
  }
  if (row.type === "unmatched_game" || row.type === "game") {
    return "建议在「游戏管理」中补充或修正游戏主数据，确保与流水一致。";
  }
  if (row.type === "variant_unmatched") {
    return "建议在「游戏版本管理」中维护与流水一致的版本/原始游戏名。";
  }
  if (row.type === "overdue") {
    return "建议在「账单」模块核查账期与结算进度。";
  }
  return "建议在「导入数据中心」查看导入历史与失败原因，按提示修正数据源或映射后重新导入/重算。";
};
