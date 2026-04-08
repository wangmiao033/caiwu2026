"use client";

import { useState } from "react";
import { Button, Input, Modal, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import type { Channel, Game, MapRow } from "./channel-game-map-shared";

type BulkInputItem = { channel_name: string; game_name: string };
type BulkPreviewRow = { key: string; channel_name: string; game_name: string; status: string; reason: string };

type Props = {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  games: Game[];
  rows: MapRow[];
  onCompleted: () => void | Promise<void>;
};

export default function ChannelGameMapBulkImport({ open, onClose, channels, games, rows, onCompleted }: Props) {
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const parseBulk = () => {
    const channelSet = new Set(channels.map((x) => x.name));
    const gameSet = new Set(games.map((x) => x.name));
    const existsSet = new Set(rows.map((x) => `${x.channel}::${x.game}`));
    const seen = new Set<string>();
    const preview: BulkPreviewRow[] = [];
    const lines = bulkText.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const cols = line.split(/[\t,\uff0c]+/).map((x) => x.trim()).filter(Boolean);
      if (cols.length < 2) {
        preview.push({ key: `line-${i}`, channel_name: cols[0] || "", game_name: cols[1] || "", status: "格式错误", reason: "格式错误" });
        continue;
      }
      const channel_name = cols[0];
      const game_name = cols[1];
      const key = `${channel_name}::${game_name}`;
      if (seen.has(key)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "重复输入", reason: "重复输入" });
        continue;
      }
      seen.add(key);
      if (!channelSet.has(channel_name)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "渠道不存在", reason: "渠道不存在" });
        continue;
      }
      if (!gameSet.has(game_name)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "游戏不存在", reason: "游戏不存在" });
        continue;
      }
      if (existsSet.has(key)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "映射已存在", reason: "映射已存在" });
        continue;
      }
      preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "可新增", reason: "" });
    }
    setBulkPreview(preview);
  };

  const submitBulk = async () => {
    const items: BulkInputItem[] = bulkPreview.filter((x) => x.status === "可新增").map((x) => ({ channel_name: x.channel_name, game_name: x.game_name }));
    if (items.length === 0) {
      message.warning("没有可新增映射");
      return;
    }
    setBulkLoading(true);
    message.loading({ content: "正在批量创建映射...", key: "bulk_map" });
    try {
      const resp = await apiRequest<{ success_count: number; failed_count: number; failed_items: Array<{ channel_name: string; game_name: string; reason: string }> }>(
        "/channel-game-map/bulk-create",
        "POST",
        { items }
      );
      message.success({ content: `成功 ${resp.success_count} 条，跳过 ${resp.failed_count} 条`, key: "bulk_map" });
      setBulkText("");
      setBulkPreview([]);
      onClose();
      await onCompleted();
    } catch (e) {
      message.error({ content: (e as Error).message, key: "bulk_map" });
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="批量添加渠道游戏映射"
      onCancel={() => {
        onClose();
      }}
      onOk={submitBulk}
      okText="确认导入"
      confirmLoading={bulkLoading}
      width={860}
      afterOpenChange={(v) => {
        if (!v) {
          setBulkText("");
          setBulkPreview([]);
        }
      }}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input.TextArea
          rows={8}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"支持格式（每行一组）：\n4399,雷鸣三国\n百度,浮光幻想\n也支持从 Excel 两列复制（Tab 分隔）"}
        />
        <Button onClick={parseBulk}>解析</Button>
        <Table
          rowKey="key"
          size="small"
          pagination={{ pageSize: 8 }}
          dataSource={bulkPreview}
          columns={[
            { title: "渠道", dataIndex: "channel_name" },
            { title: "游戏", dataIndex: "game_name" },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: string) => <Tag color={v === "可新增" ? "green" : "red"}>{v}</Tag>,
            },
            { title: "原因", dataIndex: "reason", render: (v: string) => v || "-" },
          ]}
        />
      </Space>
    </Modal>
  );
}
