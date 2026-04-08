"use client";

import { Button, Input, InputNumber, Space, Switch, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type { LocalContractItem } from "./types";
import { createEmptyContractItem } from "./types";

type Props = {
  value: LocalContractItem[];
  onChange: (rows: LocalContractItem[]) => void;
};

export default function ContractItemsEditor({ value, onChange }: Props) {
  const patchRow = (localKey: string, patch: Partial<LocalContractItem>) => {
    onChange(value.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r)));
  };

  const removeRow = (localKey: string) => {
    onChange(value.filter((r) => r.localKey !== localKey));
  };

  const addRow = () => {
    onChange([...value, createEmptyContractItem()]);
  };

  const columns: ColumnsType<LocalContractItem> = [
    {
      title: "游戏名称",
      dataIndex: "game_name",
      width: 140,
      render: (_: unknown, row) => (
        <Input
          size="small"
          placeholder="必填"
          value={row.game_name}
          onChange={(e) => patchRow(row.localKey, { game_name: e.target.value })}
        />
      ),
    },
    {
      title: "折扣说明",
      width: 100,
      render: (_: unknown, row) => (
        <Input
          size="small"
          placeholder="如无/0.1折"
          value={row.discount_label}
          onChange={(e) => patchRow(row.localKey, { discount_label: e.target.value })}
        />
      ),
    },
    {
      title: "折扣率",
      width: 88,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          min={0}
          step={0.0001}
          style={{ width: "100%" }}
          value={row.discount_rate}
          onChange={(v) => patchRow(row.localKey, { discount_rate: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "渠道分成%",
      width: 92,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          min={0}
          max={100}
          style={{ width: "100%" }}
          value={row.channel_share_percent}
          onChange={(v) => patchRow(row.localKey, { channel_share_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "通道费%",
      width: 84,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          min={0}
          max={100}
          style={{ width: "100%" }}
          value={row.channel_fee_percent}
          onChange={(v) => patchRow(row.localKey, { channel_fee_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "税点%",
      width: 72,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          min={0}
          max={100}
          style={{ width: "100%" }}
          value={row.tax_percent}
          onChange={(v) => patchRow(row.localKey, { tax_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "私点%",
      width: 72,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          min={0}
          max={100}
          style={{ width: "100%" }}
          value={row.private_percent}
          onChange={(v) => patchRow(row.localKey, { private_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "研发分成说明",
      width: 160,
      render: (_: unknown, row) => (
        <Input
          size="small"
          value={row.rd_share_note}
          onChange={(e) => patchRow(row.localKey, { rd_share_note: e.target.value })}
        />
      ),
    },
    {
      title: "启用",
      width: 72,
      render: (_: unknown, row) => (
        <Switch size="small" checked={row.is_active} onChange={(v) => patchRow(row.localKey, { is_active: v })} />
      ),
    },
    {
      title: "操作",
      width: 72,
      fixed: "right",
      render: (_: unknown, row) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeRow(row.localKey)} />
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        在页面内直接维护各行；保存合同时将一并提交（新建合同需先有主档再写入明细接口）。
      </Typography.Text>
      <Table
        rowKey="localKey"
        size="small"
        pagination={false}
        scroll={{ x: 1200 }}
        columns={columns}
        dataSource={value}
        locale={{ emptyText: "暂无明细，可点击「添加一行」" }}
      />
      <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} block>
        添加一行明细
      </Button>
    </Space>
  );
}
