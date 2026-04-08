"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Form, Input, InputNumber, Modal, Space, Table, message } from "antd";
import { apiRequest } from "@/lib/api";
import { getCachedJson, invalidateCachedJson, SHORT_LIST_TTL_MS } from "@/lib/shortLivedApiCache";

const GamesBulkImportModal = dynamic(() => import("./GamesBulkImportModal"), { ssr: false, loading: () => null });

type Row = { id: number; name: string; rd_company: string; rd_share_percent?: number };

const CACHE_GAMES = "api:GET:/games";

export default function GamesPage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async (forceRefresh = false) => {
    try {
      setRows(await getCachedJson(CACHE_GAMES, SHORT_LIST_TTL_MS, () => apiRequest<Row[]>("/games"), forceRefresh));
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  const submit = useCallback(async () => {
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
      invalidateCachedJson(CACHE_GAMES);
      await load(false);
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [editing, form, load]);

  const remove = useCallback(
    (id: number) =>
      Modal.confirm({
        title: "确认删除游戏",
        onOk: async () => {
          try {
            await apiRequest(`/games/${id}`, "DELETE");
            invalidateCachedJson(CACHE_GAMES);
            await load(false);
          } catch (e) {
            message.error((e as Error).message);
          }
        },
      }),
    [load]
  );

  const filtered = useMemo(() => rows.filter((x) => `${x.name}${x.rd_company}`.includes(keyword)), [rows, keyword]);

  const exportCurrent = useCallback(() => {
    void (async () => {
      const { buildExportFilename, exportRowsToXlsx } = await import("@/lib/export");
      exportRowsToXlsx(
        filtered.map((x) => ({ 游戏ID: x.id, 游戏名称: x.name, 研发主体: x.rd_company, 研发分成: x.rd_share_percent ?? 0 })),
        buildExportFilename("games", "xlsx")
      );
      message.success("导出成功");
    })();
  }, [filtered]);

  const openCreate = useCallback(() => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (r: Row) => {
      setEditing(r);
      form.setFieldsValue(r);
      setOpen(true);
    },
    [form]
  );

  const tableColumns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", width: 100 },
      { title: "游戏名称", dataIndex: "name" },
      { title: "研发主体", dataIndex: "rd_company" },
      { title: "研发分成(%)", dataIndex: "rd_share_percent", width: 120, render: (v: number | undefined) => (typeof v === "number" ? v : 0) },
      {
        title: "操作",
        render: (_: unknown, r: Row) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>
              编辑
            </Button>
            <Button size="small" danger onClick={() => remove(r.id)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [openEdit, remove]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const g = (searchParams.get("game") || "").trim();
    if (g) setKeyword(g);
  }, [searchParams]);

  const onBulkCompleted = useCallback(async () => {
    invalidateCachedJson(CACHE_GAMES);
    await load(false);
  }, [load]);

  return (
    <Card
      title="游戏管理"
      extra={
        <Space>
          <Input placeholder="搜索游戏" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={() => void load(true)}>刷新</Button>
          <Button onClick={exportCurrent}>导出当前筛选</Button>
          <Button onClick={() => setOpenBulk(true)}>批量导入</Button>
          <Button type="primary" onClick={openCreate}>
            新增游戏
          </Button>
        </Space>
      }
    >
      <Table rowKey="id" dataSource={filtered} pagination={{ pageSize: 10 }} columns={tableColumns} />
      <Modal open={open} title={editing ? "编辑游戏" : "新增游戏"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="游戏名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="研发主体" name="rd_company" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="研发分成(%)" name="rd_share_percent" rules={[{ required: true, message: "请填写研发分成" }]} initialValue={0}>
            <InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <GamesBulkImportModal open={openBulk} onClose={() => setOpenBulk(false)} rows={rows} onCompleted={onBulkCompleted} />
    </Card>
  );
}
