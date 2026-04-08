"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";

type Row = { id: number; name: string; rd_company: string; rd_share_percent?: number };
type BulkPreviewRow = { key: string; name: string; status: "可新增" | "已存在" | "重复输入" };

export default function GamesPage() {
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
      setRows(await apiRequest<Row[]>("/games"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await apiRequest(`/games/${editing.id}`, "PUT", values);
      } else {
        await apiRequest("/games", "POST", values);
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
      title: "确认删除游戏",
      onOk: async () => {
        try {
          await apiRequest(`/games/${id}`, "DELETE");
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const filtered = useMemo(() => rows.filter((x) => `${x.name}${x.rd_company}`.includes(keyword)), [rows, keyword]);
  const exportCurrent = () => {
    exportRowsToXlsx(
      filtered.map((x) => ({ 游戏ID: x.id, 游戏名称: x.name, 研发主体: x.rd_company, 研发分成: x.rd_share_percent ?? 0 })),
      buildExportFilename("games", "xlsx")
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
      message.warning("没有可新增游戏");
      return;
    }
    setBulkLoading(true);
    message.loading({ content: "正在批量创建游戏...", key: "bulk_game" });
    try {
      const resp = await apiRequest<{ success_count: number; failed_count: number; failed_names: string[] }>("/games/bulk-create", "POST", { names });
      message.success({ content: `成功 ${resp.success_count} 条，跳过 ${resp.failed_count} 条`, key: "bulk_game" });
      setOpenBulk(false);
      setBulkText("");
      setBulkPreview([]);
      await load();
    } catch (e) {
      message.error({ content: (e as Error).message, key: "bulk_game" });
    } finally {
      setBulkLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="游戏管理"
      extra={
        <Space>
          <Input placeholder="搜索游戏" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
            新增游戏
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
          { title: "游戏名称", dataIndex: "name" },
          { title: "研发主体", dataIndex: "rd_company" },
          { title: "研发分成(%)", dataIndex: "rd_share_percent", width: 120, render: (v: number | undefined) => (typeof v === "number" ? v : 0) },
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
      <Modal open={open} title={editing ? "编辑游戏" : "新增游戏"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="游戏名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="研发主体" name="rd_company" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="研发分成(%)"
            name="rd_share_percent"
            rules={[{ required: true, message: "请填写研发分成" }]}
            initialValue={0}
          >
            <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={openBulk}
        title="批量添加游戏"
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
    </Card>
  );
}
