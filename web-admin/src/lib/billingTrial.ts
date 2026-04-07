export type BillingRule = {
  key: string;
  channel: string;
  game: string;
  discountType: "无" | "0.1折" | "0.05折";
  channelFee: number;
  taxRate: number;
  rdShare: number;
  privateRate: number;
  enabled: boolean;
};

export type TrialResult = {
  matched: boolean;
  ruleName: string;
  discountRate?: number;
  discountedGross?: number;
  channelFeeAmount?: number;
  taxAmount?: number;
  rdShareAmount?: number;
  privateAmount?: number;
  settlementAmount?: number;
  profit?: number;
};

function toRate(discountType: BillingRule["discountType"]): number {
  if (discountType === "0.1折") return 0.1;
  if (discountType === "0.05折") return 0.05;
  return 1;
}

export function matchRuleForBill(
  rules: BillingRule[],
  billType: "channel" | "rd",
  targetName: string
): BillingRule | undefined {
  const enabledRules = rules.filter((r) => r.enabled);
  if (billType === "channel") {
    return enabledRules.find((r) => r.channel === targetName);
  }
  return enabledRules.find((r) => r.game === targetName);
}

export function calcTrialResult(
  baseGross: number,
  rule?: BillingRule
): TrialResult {
  if (!rule) {
    return { matched: false, ruleName: "未配置规则" };
  }
  const discountRate = toRate(rule.discountType);
  const discountedGross = baseGross * discountRate;
  const channelFeeAmount = discountedGross * Number(rule.channelFee || 0);
  const taxAmount = discountedGross * Number(rule.taxRate || 0);
  const rdShareAmount = discountedGross * Number(rule.rdShare || 0);
  const privateAmount = discountedGross * Number(rule.privateRate || 0);
  const settlementAmount =
    discountedGross -
    channelFeeAmount -
    taxAmount -
    rdShareAmount -
    privateAmount;
  const profit = settlementAmount;
  return {
    matched: true,
    ruleName: `${rule.channel} / ${rule.game}`,
    discountRate,
    discountedGross,
    channelFeeAmount,
    taxAmount,
    rdShareAmount,
    privateAmount,
    settlementAmount,
    profit,
  };
}
