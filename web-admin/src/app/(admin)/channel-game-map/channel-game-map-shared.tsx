"use client";

import { useEffect } from "react";
import { Form, InputNumber, Select } from "antd";
import type { FormInstance } from "antd/es/form";

export type Channel = { id: number; name: string };
export type Game = { id: number; name: string; rd_share_percent?: number };
export type MapRow = {
  id: number;
  channel: string;
  game: string;
  revenue_share_ratio: number;
  rd_settlement_ratio: number;
};

export const toPercent = (ratio: number) => Number((ratio * 100).toFixed(2));
export const toRatio = (percent: number) => Number((percent / 100).toFixed(4));
export const calcPublishRatio = (channelRatio: number, rdRatio: number) => Number((1 - channelRatio - rdRatio).toFixed(4));
export const isTotalValid = (channelRatio: number, rdRatio: number, publishRatio: number) =>
  Math.abs(channelRatio + rdRatio + publishRatio - 1) < 0.0001;

const filterOptionContains = (input: string, option?: { label?: unknown; value?: unknown }) => {
  const label = String(option?.label ?? "");
  return label.toLowerCase().includes((input || "").toLowerCase());
};

export function ChannelGameMapFormFields({
  form,
  channels,
  games,
}: {
  form: FormInstance;
  channels: Channel[];
  games: Game[];
}) {
  const channelSharePercent = Form.useWatch("revenue_share_ratio", form) as number | undefined;
  const rdSharePercent = Form.useWatch("rd_settlement_ratio", form) as number | undefined;
  const gameId = Form.useWatch("game_id", form) as number | undefined;

  useEffect(() => {
    if (!gameId) return;
    const g = games.find((x) => x.id === gameId);
    if (!g || typeof g.rd_share_percent !== "number") return;
    const current = Number(form.getFieldValue("rd_settlement_ratio"));
    if (Number.isFinite(current) && Math.abs(current - g.rd_share_percent) < 0.0001) return;
    form.setFieldValue("rd_settlement_ratio", g.rd_share_percent);
  }, [gameId, games, form]);

  const publishSharePercent =
    typeof channelSharePercent === "number" && typeof rdSharePercent === "number"
      ? Number((100 - channelSharePercent - rdSharePercent).toFixed(2))
      : undefined;
  const totalPercent =
    typeof channelSharePercent === "number" && typeof rdSharePercent === "number" && typeof publishSharePercent === "number"
      ? Number((channelSharePercent + rdSharePercent + publishSharePercent).toFixed(2))
      : undefined;

  return (
    <Form form={form} layout="vertical">
      <Form.Item name="channel_id" label="渠道" rules={[{ required: true }]}>
        <Select
          allowClear
          showSearch
          placeholder="请选择渠道（支持搜索/粘贴关键字）"
          options={channels.map((x) => ({ label: x.name, value: x.id }))}
          optionFilterProp="label"
          filterOption={filterOptionContains}
        />
      </Form.Item>
      <Form.Item name="game_id" label="游戏" rules={[{ required: true }]}>
        <Select
          allowClear
          showSearch
          placeholder="请选择游戏（支持搜索/粘贴关键字）"
          options={games.map((x) => ({ label: x.name, value: x.id }))}
          optionFilterProp="label"
          filterOption={filterOptionContains}
        />
      </Form.Item>
      <Form.Item name="revenue_share_ratio" label="渠道分成(%)" rules={[{ required: true }]}>
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        name="rd_settlement_ratio"
        label="研发分成(%)（来自游戏固定值）"
        rules={[{ required: true }]}
        tooltip="研发分成来自游戏主数据，映射中不再单独维护"
      >
        <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} disabled />
      </Form.Item>
      <Form.Item label="发行分成(%)">
        <InputNumber value={publishSharePercent} disabled style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="合计(%)">
        <InputNumber value={totalPercent} disabled style={{ width: "100%" }} />
      </Form.Item>
    </Form>
  );
}

export type ChannelGameMapFormValues = {
  channel_id: number;
  game_id: number;
  revenue_share_ratio: number;
  rd_settlement_ratio: number;
};

export function buildChannelGameMapApiPayload(values: ChannelGameMapFormValues) {
  const channelPercent = Number(values.revenue_share_ratio || 0);
  const rdPercent = Number(values.rd_settlement_ratio || 0);
  return {
    channel_id: values.channel_id,
    game_id: values.game_id,
    revenue_share_ratio: toRatio(channelPercent),
    rd_settlement_ratio: toRatio(rdPercent),
  };
}
