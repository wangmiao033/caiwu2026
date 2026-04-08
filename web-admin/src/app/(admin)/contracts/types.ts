export type ContractStatus = "draft" | "active" | "expired" | "void";

export const STATUS_LABEL: Record<ContractStatus, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  active: { text: "生效", color: "green" },
  expired: { text: "已到期", color: "orange" },
  void: { text: "作废", color: "red" },
};

export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ContractStatus[]).map((v) => ({
  label: STATUS_LABEL[v].text,
  value: v,
}));

/** 页面内编辑用的合同明细行（含本地 key；id 为空表示待创建） */
export type LocalContractItem = {
  localKey: string;
  id?: number;
  game_name: string;
  discount_label: string;
  discount_rate: number;
  channel_share_percent: number;
  channel_fee_percent: number;
  tax_percent: number;
  private_percent: number;
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
    discount_label: "",
    discount_rate: 0,
    channel_share_percent: 0,
    channel_fee_percent: 0,
    tax_percent: 0,
    private_percent: 0,
    rd_share_note: "",
    is_active: true,
  };
}

export function toApiItemPayload(row: LocalContractItem) {
  return {
    game_name: String(row.game_name || "").trim(),
    discount_label: String(row.discount_label || "").trim(),
    discount_rate: Number(row.discount_rate ?? 0),
    channel_share_percent: Number(row.channel_share_percent ?? 0),
    channel_fee_percent: Number(row.channel_fee_percent ?? 0),
    tax_percent: Number(row.tax_percent ?? 0),
    private_percent: Number(row.private_percent ?? 0),
    rd_share_note: String(row.rd_share_note || "").trim(),
    is_active: Boolean(row.is_active),
  };
}
