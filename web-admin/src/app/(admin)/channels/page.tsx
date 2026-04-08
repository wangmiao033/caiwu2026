"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Form, Input, Modal, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";

type Row = { id: number; name: string };
type BulkPreviewRow = { key: string; name: string; status: "可新增" | "已存在" | "重复输入" };

export default function ChannelsPage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setRows(await apiRequest<Row[]>("/channels"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await apiRequest(`/channels/${editing.id}`, "PUT", values);
      } else {
        await apiRequest("/channels", "POST", values);
      }
      setOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = (id: number) =>
    Modal.confirm({
      title: "确认删除渠道",
      onOk: async () => {
        try {
          await apiRequest(`/channels/${id}`, "DELETE");
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const filtered = useMemo(() => rows.filter((x) => x.name.includes(keyword)), [rows, keyword]);
  const exportCurrent = () => {
    exportRowsToXlsx(
      filtered.map((x) => ({ 渠道ID: x.id, 渠道名称: x.name })),
      buildExportFilename("channels", "xlsx")
    );
    message.success("导出成功");
  };
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
      message.warning("没有可新增渠道");
      return;
    }
    setBulkLoading(true);
    message.loading({ content: "正在批量创建渠道...", key: "bulk_channel" });
    try {
      const resp = await apiRequest<{ success_count: number; failed_count: number; failed_names: string[] }>("/channels/bulk-create", "POST", { names });
      message.success({ content: `成功 ${resp.success_count} 条，跳过 ${resp.failed_count} 条`, key: "bulk_channel" });
      setOpenBulk(false);
      setBulkText("");
      setBulkPreview([]);
      await load();
    } catch (e) {
      message.error({ content: (e as Error).message, key: "bulk_channel" });
    } finally {
      setBulkLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const ch = (searchParams.get("channel") || searchParams.get("keyword") || "").trim();
    if (ch) setKeyword(ch);
  }, [searchParams]);

  return (
    <Card
      title="渠道管理"
      extra={
        <Space>
          <Input placeholder="搜索渠道" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={load}>刷新</Button>
          <Button onClick={exportCurrent}>导出当前筛选</Button>
          <Button onClick={() => setOpenBulk(true)}>批量导入</Button>
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增渠道
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 100 },
          { title: "渠道名称", dataIndex: "name" },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue(r);
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Button size="small" danger onClick={() => remove(r.id)}>
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title={editing ? "编辑渠道" : "新增渠道"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="渠道名称" name="name" rules={[{ required: true, message: "请输入渠道名称" }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={openBulk}
        title="批量添加渠道"
        onCancel={() => setOpenBulk(false)}
        onOk={submitBulk}
        okText="确认导入"
        confirmLoading={bulkLoading}
        width={760}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            rows={6}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"支持格式：\n4399,360,百度\n或\n4399\n360\n百度\n或\n4399 360 百度"}
          />
          <Button onClick={parseBulk}>解析</Button>
          <Table
            rowKey="key"
            size="small"
            pagination={{ pageSize: 8 }}
            dataSource={bulkPreview}
            columns={[
              { title: "渠道名称", dataIndex: "name" },
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
    </Card>
  );
}
