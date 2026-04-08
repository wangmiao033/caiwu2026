/** 数据库存储状态（编辑主档时使用） */
export type ContractStoredStatus = "draft" | "active" | "terminated" | "archived";

/** 列表/详情展示状态（后端根据日期 + 存储状态计算） */
export type ContractEffectiveStatus =
          | "draft"
          | "active"
          | "expiring_soon"
          | "expired"
          | "pending_start"
          | "terminated"
          | "archived";

export const EFFECTIVE_STATUS_LABEL: Record<
  ContractEffectiveStatus,
            { text: string; color: string }
> = {
  draft: { text: "草稿", color: "default" },
  active: { text: "生效", color: "green" },
  expiring_soon: { text: "即将到期", color: "orange" },
  expired: { text: "已过期", color: "volcano" },
  pending_start: { text: "待生效", color: "blue" },
  terminated: { text: "已终止", color: "red" },
  archived: { text: "已归档", color: "purple" },
};

export const EFFECTIVE_STATUS_FILTER_OPTIONS = (
  Object.keys(EFFECTIVE_STATUS_LABEL) as ContractEffectiveStatus[]
).map((v) => ({
  label: EFFECTIVE_STATUS_LABEL[v].text,
  value: v,
}));

export const STORED_STATUS_OPTIONS: { label: string; value: ContractStoredStatus }[] = [
  { label: "草稿", value: "draft" },
  { label: "生效", value: "active" },
  { label: "已终止", value: "terminated" },
  { label: "已归档", value: "archived" },
];

/** @deprecated 使用 ContractStoredStatus / ContractEffectiveStatus */
export type ContractStatus = ContractStoredStatus;

export const STATUS_LABEL = {
  draft: EFFECTIVE_STATUS_LABEL.draft,
  active: EFFECTIVE_STATUS_LABEL.active,
  terminated: EFFECTIVE_STATUS_LABEL.terminated,
  archived: EFFECTIVE_STATUS_LABEL.archived,
  expired: EFFECTIVE_STATUS_LABEL.expired,
  void: EFFECTIVE_STATUS_LABEL.archived,
} as const;

export const STATUS_OPTIONS = STORED_STATUS_OPTIONS;

export const STATUS_LABEL_FOR_EFFECTIVE = EFFECTIVE_STATUS_LABEL;

/** 页面内编辑用的合同明细行（含本地 key；id 为空表示待创建） */
export type LocalContractItem = {
  localKey: string;
  id?: number;
  game_name: string;
  channel_name: string;
  discount_label: string;
  discount_rate: number;
  channel_share_percent: number;
  channel_fee_percent: number;
  tax_percent: number;
  private_percent: number;
  item_remark: string;
  rd_share_note: string;
  is_active: boolean;
};

export function createEmptyContractItem(): LocalContractItem {
  const key =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    localKey: key,
    game_name: "",
    channel_name: "",
    discount_label: "",
    discount_rate: 0,
    channel_share_percent: 0,
    channel_fee_percent: 0,
    tax_percent: 0,
    private_percent: 0,
    item_remark: "",
    rd_share_note: "",
    is_active: true,
  };
}

export function toApiItemPayload(row: LocalContractItem) {
  return {
    game_name: String(row.game_name || "").trim(),
    channel_name: String(row.channel_name || "").trim(),
    discount_label: String(row.discount_label || "").trim(),
    discount_rate: Number(row.discount_rate ?? 0),
    channel_share_percent: Number(row.channel_share_percent ?? 0),
    channel_fee_percent: Number(row.channel_fee_percent ?? 0),
    tax_percent: Number(row.tax_percent ?? 0),
    private_percent: Number(row.private_percent ?? 0),
    item_remark: String(row.item_remark || "").trim(),
    rd_share_note: String(row.rd_share_note || "").trim(),
    is_active: Boolean(row.is_active),
  };
}

export function validateContractItemsForSave(rows: LocalContractItem[]): string[] {
  const err: string[] = [];
  rows.forEach((r, idx) => {
    const n = idx + 1;
    const hasAny =
      !!r.game_name?.trim() ||
      !!r.channel_name?.trim() ||
      (r.id != null && r.id > 0);
    if (!hasAny) return;
    if (!r.game_name?.trim()) err.push(`第 ${n} 行：游戏名称不能为空`);
    if (!r.channel_name?.trim()) err.push(`第 ${n} 行：渠道名称不能为空`);
    const pct = (v: number, label: string) => {
      const x = Number(v);
      if (!Number.isFinite(x) || x < 0 || x > 100) err.push(`第 ${n} 行：${label}须为 0~100 的有效百分比`);
    };
    pct(r.channel_share_percent, "渠道分成");
    pct(r.channel_fee_percent, "通道费");
    pct(r.tax_percent, "税点");
    pct(r.private_percent, "私点");
    const dr = Number(r.discount_rate);
    if (!Number.isFinite(dr) || dr < 0 || dr > 100) err.push(`第 ${n} 行：折扣率须为 0~100`);
  });
  return err;
}

export function contractItemsCompletenessHints(items: LocalContractItem[]): string[] {
  const active = items.filter((i) => i.is_active);
  if (active.length === 0) return ["暂无启用中的明细，保存前请确认是否需补充。"];
  const hints: string[] = [];
  if (active.some((i) => !i.game_name?.trim())) hints.push("部分启用行未选择/填写游戏。");
  if (active.some((i) => !i.channel_name?.trim())) hints.push("部分启用行未选择/填写渠道。");
  if (active.some((i) => Number(i.channel_share_percent) === 0))
    hints.push("部分启用行渠道分成仍为 0，请核对是否已按合同录入。");
  if (active.some((i) => Number(i.channel_fee_percent) === 0 && Number(i.tax_percent) === 0))
    hints.push("部分启用行通道费与税点均为 0，请核对。");
  return hints;
}
