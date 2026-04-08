"use client";

import { useEffect, useMemo, useState } from "react";
import { AutoComplete, Button, Input, InputNumber, Space, Switch, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import type { LocalContractItem } from "./types";
import { createEmptyContractItem, validateContractItemsForSave } from "./types";

type GameRow = { id: number; name: string };
type ChannelRow = { id: number; name: string };

type Props = {
  value: LocalContractItem[];
  onChange: (rows: LocalContractItem[]) => void;
  /** 新建行时默认带出的合同主档渠道（可改） */
  headerChannelName?: string;
};

const pctField = {
  min: 0,
  max: 100,
  step: 0.01,
  precision: 2,
  style: { width: "100%" as const },
};

export default function ContractItemsEditor({ value, onChange, headerChannelName = "" }: Props) {
  const [gameOpts, setGameOpts] = useState<{ value: string; label: string }[]>([]);
  const [channelOpts, setChannelOpts] = useState<{ value: string; label: string }[]>([]);
  const [optLoading, setOptLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      setOptLoading(true);
      try {
        const [gs, cs] = await Promise.all([
          apiRequest<GameRow[]>("/games", "GET"),
          apiRequest<ChannelRow[]>("/channels", "GET"),
        ]);
        const gList = Array.isArray(gs) ? gs : [];
        const cList = Array.isArray(cs) ? cs : [];
        setGameOpts(gList.map((g) => ({ value: g.name, label: g.name })));
        setChannelOpts(cList.map((c) => ({ value: c.name, label: c.name })));
      } catch {
        setGameOpts([]);
        setChannelOpts([]);
      } finally {
        setOptLoading(false);
      }
    })();
  }, []);

  const rowIssues = useMemo(() => {
    const errs = validateContractItemsForSave(value);
    const map = new Map<string, string[]>();
    errs.forEach((e) => {
      const m = /^第 (\d+) 行：/.exec(e);
      if (m) {
        const idx = Number(m[1]) - 1;
        const row = value[idx];
        if (row) {
          const k = row.localKey;
          const arr = map.get(k) ?? [];
          arr.push(e.replace(/^第 \d+ 行：/, ""));
          map.set(k, arr);
        }
      }
    });
    return map;
  }, [value]);

  const patchRow = (localKey: string, patch: Partial<LocalContractItem>) => {
    onChange(value.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r)));
  };

  const removeRow = (localKey: string) => {
    onChange(value.filter((r) => r.localKey !== localKey));
  };

  const addRow = () => {
    const row = createEmptyContractItem();
    const ch = headerChannelName.trim();
    if (ch) row.channel_name = ch;
    onChange([...value, row]);
  };

  const columns: ColumnsType<LocalContractItem> = [
    {
      title: "游戏名称",
      width: 160,
      render: (_: unknown, row) => {
        const issues = rowIssues.get(row.localKey);
        return (
          <div>
            <AutoComplete
              size="small"
              style={{ width: "100%" }}
              options={gameOpts}
              placeholder="选择或输入"
              value={row.game_name}
              onChange={(v) => patchRow(row.localKey, { game_name: v })}
              filterOption={(input, option) =>
                (option?.label ?? "").toLowerCase().includes((input || "").toLowerCase())
              }
              disabled={optLoading}
            />
            {issues?.length ? (
              <Typography.Text type="danger" style={{ fontSize: 11, display: "block" }}>
                {issues.join("；")}
              </Typography.Text>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "渠道名称",
      width: 150,
      render: (_: unknown, row) => (
        <AutoComplete
          size="small"
          style={{ width: "100%" }}
          options={channelOpts}
          placeholder="选择或输入"
          value={row.channel_name}
          onChange={(v) => patchRow(row.localKey, { channel_name: v })}
          filterOption={(input, option) =>
            (option?.label ?? "").toLowerCase().includes((input || "").toLowerCase())
          }
          disabled={optLoading}
        />
      ),
    },
    {
      title: "折扣类型",
      width: 100,
      render: (_: unknown, row) => (
        <Input
          size="small"
          placeholder="如无/折标"
          value={row.discount_label}
          onChange={(e) => patchRow(row.localKey, { discount_label: e.target.value })}
        />
      ),
    },
    {
      title: "折扣率%",
      width: 92,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          {...pctField}
          value={row.discount_rate}
          onChange={(v) => patchRow(row.localKey, { discount_rate: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "渠道分成%",
      width: 100,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          {...pctField}
          value={row.channel_share_percent}
          onChange={(v) => patchRow(row.localKey, { channel_share_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "通道费%",
      width: 92,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          {...pctField}
          value={row.channel_fee_percent}
          onChange={(v) => patchRow(row.localKey, { channel_fee_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "税点%",
      width: 84,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          {...pctField}
          value={row.tax_percent}
          onChange={(v) => patchRow(row.localKey, { tax_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "私点%",
      width: 84,
      render: (_: unknown, row) => (
        <InputNumber
          size="small"
          {...pctField}
          value={row.private_percent}
          onChange={(v) => patchRow(row.localKey, { private_percent: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: "备注",
      width: 140,
      render: (_: unknown, row) => (
        <Input
          size="small"
          placeholder="行备注"
          value={row.item_remark}
          onChange={(e) => patchRow(row.localKey, { item_remark: e.target.value })}
        />
      ),
    },
    {
      title: "研发/结算说明",
      width: 130,
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
        从主数据中选择游戏/渠道，或直接输入名称；数值均为百分比（0~100）。本版不与规则配置、渠道-游戏映射自动联动。
      </Typography.Text>
      <Table
        rowKey="localKey"
        size="small"
        pagination={false}
        scroll={{ x: 1680 }}
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
