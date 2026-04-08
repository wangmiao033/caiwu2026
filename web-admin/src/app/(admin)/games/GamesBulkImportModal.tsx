"use client";

import { useState } from "react";
import { Button, Input, Modal, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type Row = { id: number; name: string; rd_company: string; rd_share_percent?: number };
type BulkPreviewRow = { key: string; name: string; status: "可新增" | "已存在" | "重复输入" };

type Props = {
  open: boolean;
  onClose: () => void;
  rows: Row[];
  onCompleted: () => void | Promise<void>;
};

export default function GamesBulkImportModal({ open, onClose, rows, onCompleted }: Props) {
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const parseBulk = () => {
    const existing = new Set(rows.map((x) => x.name.trim()));
    const parts = bulkText
      .split(/[\n,\uff0c\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const preview: BulkPreviewRow[] = [];
    for (const name of parts) {
      if (seen.has(name)) {
        preview.push({ key: `${name}-${preview.length}`, name, status: "重复输入" });
        continue;
      }
      seen.add(name);
      preview.push({ key: `${name}-${preview.length}`, name, status: existing.has(name) ? "已存在" : "可新增" });
    }
    setBulkPreview(preview);
  };

  const submitBulk = async () => {
    const names = bulkPreview.filter((x) => x.status === "可新增").map((x) => x.name);
    if (names.length === 0) {
      message.warning("没有可新增游戏");
      return;
    }
    setBulkLoading(true);
    message.loading({ content: "正在批量创建游戏...", key: "bulk_game" });
    try {
      const resp = await apiRequest<{ success_count: number; failed_count: number; failed_names: string[] }>("/games/bulk-create", "POST", { names });
      message.success({ content: `成功 ${resp.success_count} 条，跳过 ${resp.failed_count} 条`, key: "bulk_game" });
      setBulkText("");
      setBulkPreview([]);
      onClose();
      await onCompleted();
    } catch (e) {
      message.error({ content: (e as Error).message, key: "bulk_game" });
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="批量添加游戏"
      onCancel={onClose}
      onOk={submitBulk}
      okText="确认导入"
      confirmLoading={bulkLoading}
      width={760}
      afterOpenChange={(v) => {
        if (!v) {
          setBulkText("");
          setBulkPreview([]);
        }
      }}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input.TextArea
          rows={6}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"支持格式：\n雷鸣三国,浮光幻想,代号三国\n或\n雷鸣三国\n浮光幻想\n代号三国\n或\n雷鸣三国 浮光幻想 代号三国"}
        />
        <Button onClick={parseBulk}>解析</Button>
        <Table
          rowKey="key"
          size="small"
          pagination={{ pageSize: 8 }}
          dataSource={bulkPreview}
          columns={[
            { title: "游戏名称", dataIndex: "name" },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: BulkPreviewRow["status"]) => (
                <Tag color={v === "可新增" ? "green" : v === "已存在" ? "orange" : "red"}>{v}</Tag>
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
