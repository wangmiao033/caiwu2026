"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type SimpleItem = { id: number; name: string };
type MapRow = { id: number; channel: string; game: string; revenue_share_ratio: number; rd_settlement_ratio: number };
type RuleRow = {
  key: string;
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
};

const defaultRule = (): Omit<RuleRow, "key" | "channel" | "game"> => ({
  discountType: "无",
  channelFee: 0,
  taxRate: 0,
  rdShare: 0.5,
  privateRate: 0,
  ipLicense: 0,
  chaofanChannel: 0,
  chaofanRd: 0,
  enabled: true,
});

export default function BillingRulesPage() {
  const [channels, setChannels] = useState<SimpleItem[]>([]);
  const [games, setGames] = useState<SimpleItem[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [qChannel, setQChannel] = useState<string>("");
  const [qGame, setQGame] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    apiRequest<SimpleItem[]>("/channels").then(setChannels).catch(() => {});
    apiRequest<SimpleItem[]>("/games").then(setGames).catch(() => {});
    apiRequest<MapRow[]>("/channel-game-map")
      .then((data) => {
        setMaps(data);
        const cache = localStorage.getItem("billing_rules_local");
        if (cache) {
          setRules(JSON.parse(cache));
        } else {
          setRules(
            data.map((x) => ({
              key: `${x.channel}-${x.game}`,
              channel: x.channel,
              game: x.game,
              ...defaultRule(),
              rdShare: Number(x.rd_settlement_ratio ?? 0.5),
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const saveLocal = (next: RuleRow[]) => {
    setRules(next);
    localStorage.setItem("billing_rules_local", JSON.stringify(next));
  };

  const filtered = useMemo(
    () => rules.filter((r) => (!qChannel || r.channel === qChannel) && (!qGame || r.game === qGame)),
    [rules, qChannel, qGame]
  );

  const onAdd = () => {
    setEditingKey(null);
    form.resetFields();
    setOpen(true);
  };

  const onEdit = (row: RuleRow) => {
    setEditingKey(row.key);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const channel = values.channel as string;
    const game = values.game as string;
    const key = `${channel}-${game}`;
    const item: RuleRow = { key, channel, game, ...values };
    const next = editingKey ? rules.map((x) => (x.key === editingKey ? item : x)) : [item, ...rules.filter((x) => x.key !== key)];
    saveLocal(next);

    try {
      await apiRequest("/billing/rules", "POST", {
        name: `${channel}-${game}-rule`,
        bill_type: "channel",
        default_ratio: Number(values.rdShare || 0.5),
      });
      message.success("规则已保存（并同步基础比例到后端）");
    } catch (e) {
      message.warning(`本地已保存，后端同步失败：${(e as Error).message}`);
    }
    setOpen(false);
  };

  return (
    <Card
      title="规则配置（游戏 + 渠道）"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="筛选渠道"
            style={{ width: 160 }}
            options={channels.map((x) => ({ label: x.name, value: x.name }))}
            value={qChannel || undefined}
            onChange={(v) => setQChannel(v || "")}
          />
          <Select
            allowClear
            placeholder="筛选游戏"
            style={{ width: 160 }}
            options={games.map((x) => ({ label: x.name, value: x.name }))}
            value={qGame || undefined}
            onChange={(v) => setQGame(v || "")}
          />
          <Button type="primary" onClick={onAdd}>
            新增规则
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="key"
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "渠道", dataIndex: "channel" },
          { title: "游戏", dataIndex: "game" },
          { title: "折扣", dataIndex: "discountType" },
          { title: "通道费", dataIndex: "channelFee" },
          { title: "税点", dataIndex: "taxRate" },
          { title: "研发分成", dataIndex: "rdShare" },
          { title: "私点", dataIndex: "privateRate" },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          { title: "操作", render: (_, r) => <Button type="link" onClick={() => onEdit(r)}>编辑</Button> },
        ]}
      />

      <Modal open={open} title={editingKey ? "编辑规则" : "新增规则"} onCancel={() => setOpen(false)} onOk={onSubmit}>
        <Form form={form} layout="vertical" initialValues={{ ...defaultRule(), channel: maps[0]?.channel, game: maps[0]?.game }}>
          <Form.Item label="渠道" name="channel" rules={[{ required: true }]}>
            <Select options={channels.map((x) => ({ label: x.name, value: x.name }))} />
          </Form.Item>
          <Form.Item label="游戏" name="game" rules={[{ required: true }]}>
            <Select options={games.map((x) => ({ label: x.name, value: x.name }))} />
          </Form.Item>
          <Form.Item label="折扣类型" name="discountType">
            <Select options={[{ label: "无", value: "无" }, { label: "0.1折", value: "0.1折" }, { label: "0.05折", value: "0.05折" }]} />
          </Form.Item>
          <Form.Item label="通道费" name="channelFee"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="税点" name="taxRate"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="研发分成" name="rdShare"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="私点" name="privateRate"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="IP授权（预留）" name="ipLicense"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="超凡与渠道（预留）" name="chaofanChannel"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="超凡与研发（预留）" name="chaofanRd"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
