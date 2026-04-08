"use client";

import { useEffect } from "react";
import { Form, Input, InputNumber, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";

export type SimpleItem = { id: number; name: string };
export type GameItem = { id: number; name: string; rd_share_percent?: number };
export type MapRow = { id: number; channel: string; game: string; revenue_share_ratio: number; rd_settlement_ratio: number };
export type RuleRow = {
  key: string;
  row_no?: number;
  channel: string;
  game: string;
  discountType: "无" | "0.1折" | "0.05折";
  channelFee: number;
  taxRate: number;
  rdShare: number;
  privateRate: number;
  ipLicense: number;
  chaofanChannel: number;
  chaofanRd: number;
  enabled: boolean;
  remark?: string;
  error_message?: string;
  error_fields?: string[];
};

export const ratioToPercent = (ratio: number) => ratio * 100;
export const percentToRatio = (percent: number) => percent / 100;
export const formatRatioAsPercent = (ratio: number) => `${Number(ratioToPercent(ratio).toFixed(4)).toString()}%`;

export const defaultRule = (): Omit<RuleRow, "key" | "channel" | "game"> => ({
  discountType: "无",
  channelFee: 0,
  taxRate: 0,
  rdShare: 0.5,
  privateRate: 0,
  ipLicense: 0,
  chaofanChannel: 0,
  chaofanRd: 0,
  enabled: true,
  remark: "",
});

export function buildRulesFromMaps(mapRes: MapRow[], gmRes: GameItem[]): RuleRow[] {
  const gameByName = new Map(gmRes.map((g) => [g.name, g]));
  const rdFromMaster = (gameName: string) => {
    const g = gameByName.get(gameName);
    return percentToRatio(Number(g?.rd_share_percent ?? 0));
  };
  return mapRes.map((x) => ({
    key: `${x.channel}-${x.game}`,
    channel: x.channel,
    game: x.game,
    ...defaultRule(),
    rdShare: rdFromMaster(x.game),
  }));
}

export function getRulesFromStorageOrMaps(maps: MapRow[], games: GameItem[]): RuleRow[] {
  const cache = localStorage.getItem("billing_rules_local");
  if (cache) {
    try {
      return JSON.parse(cache) as RuleRow[];
    } catch {
      /* fall through */
    }
  }
  return buildRulesFromMaps(maps, games);
}

export function saveRulesToStorage(next: RuleRow[]) {
  localStorage.setItem("billing_rules_local", JSON.stringify(next));
}

export function rdPercentForGameName(games: GameItem[], gameName: string) {
  const g = games.find((x) => x.name === gameName);
  return Number(g?.rd_share_percent ?? 0);
}

export function rdRatioForGameName(games: GameItem[], gameName: string) {
  return percentToRatio(rdPercentForGameName(games, gameName));
}

export type BillingRuleFormShape = {
  channel: string;
  game: string;
  discountType: RuleRow["discountType"];
  channelFee: number;
  taxRate: number;
  rdShare: number;
  privateRate: number;
  ipLicense: number;
  chaofanChannel: number;
  chaofanRd: number;
  enabled: boolean;
  remark?: string;
};

export function mergeRuleIntoRules(
  values: BillingRuleFormShape,
  games: GameItem[],
  editingKey: string | null,
  rules: RuleRow[]
): RuleRow[] {
  const channel = values.channel;
  const game = values.game;
  const key = `${channel}-${game}`;
  const rdShareRatio = rdRatioForGameName(games, game);
  const item: RuleRow = {
    key,
    channel,
    game,
    discountType: values.discountType,
    channelFee: percentToRatio(Number(values.channelFee || 0)),
    taxRate: percentToRatio(Number(values.taxRate || 0)),
    rdShare: rdShareRatio,
    privateRate: percentToRatio(Number(values.privateRate || 0)),
    ipLicense: Number(values.ipLicense || 0),
    chaofanChannel: Number(values.chaofanChannel || 0),
    chaofanRd: Number(values.chaofanRd || 0),
    enabled: values.enabled,
    remark: values.remark || "",
  };
  if (editingKey) {
    return rules.map((x) => (x.key === editingKey ? item : x));
  }
  return [item, ...rules.filter((x) => x.key !== key)];
}

export function BillingRuleFormFields({
  form,
  channels,
  games,
}: {
  form: FormInstance;
  channels: SimpleItem[];
  games: GameItem[];
}) {
  const watchedGame = Form.useWatch("game", form);

  useEffect(() => {
    if (!watchedGame) return;
    form.setFieldValue("rdShare", rdPercentForGameName(games, watchedGame));
  }, [watchedGame, games, form]);

  return (
    <Form form={form} layout="vertical">
      <Form.Item label="渠道" name="channel" rules={[{ required: true }]}>
        <Select options={channels.map((x) => ({ label: x.name, value: x.name }))} />
      </Form.Item>
      <Form.Item label="游戏" name="game" rules={[{ required: true }]}>
        <Select options={games.map((x) => ({ label: x.name, value: x.name }))} />
      </Form.Item>
      <Form.Item label="折扣类型" name="discountType">
        <Select options={[{ label: "无", value: "无" }, { label: "0.1折", value: "0.1折" }, { label: "0.05折", value: "0.05折" }]} />
      </Form.Item>
      <Form.Item label="通道费(%)" name="channelFee">
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="税点(%)" name="taxRate">
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="研发分成(%)" name="rdShare" tooltip="来自游戏主数据，不能在此修改">
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} disabled readOnly />
      </Form.Item>
      <Form.Item label="私点(%)" name="privateRate">
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="IP授权（预留）" name="ipLicense">
        <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="超凡与渠道（预留）" name="chaofanChannel">
        <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="超凡与研发（预留）" name="chaofanRd">
        <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="启用状态" name="enabled" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="备注" name="remark">
        <Input />
      </Form.Item>
    </Form>
  );
}
