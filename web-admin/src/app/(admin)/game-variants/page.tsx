"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type Project = { id: number; name: string; status: string };
type GameVariant = {
  id: number;
  project_id: number;
  variant_name: string;
  raw_game_name: string;
  discount_type: string;
  version_type: string;
  server_type: string;
  status: string;
  remark: string;
  rd_company?: string | null;
  publish_company?: string | null;
  rd_share_percent?: number | null;
  publish_share_percent?: number | null;
  settlement_remark?: string | null;
  created_at: string;
};

const DISCOUNT_OPTIONS = [
  { label: "无", value: "none" },
  { label: "0.1 折", value: "0.1" },
  { label: "0.05 折", value: "0.05" },
];

const VERSION_OPTIONS = [
  { label: "常规版", value: "常规版" },
  { label: "联运版", value: "联运版" },
  { label: "自运营版", value: "自运营版" },
  { label: "折扣版", value: "折扣版" },
];

const SERVER_OPTIONS = [
  { label: "混服", value: "混服" },
  { label: "专服", value: "专服" },
];

const defaultFormValues = {
  project_id: undefined as number | undefined,
  variant_name: "",
  raw_game_name: "",
  discount_type: "none",
  version_type: "常规版",
  server_type: "混服",
  status: true,
  remark: "",
  rd_company: "",
  publish_company: "广州熊动科技有限公司",
  rd_share_percent: undefined as number | undefined,
  publish_share_percent: undefined as number | undefined,
  settlement_remark: "",
};

function GameVariantsPageContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<GameVariant[]>([]);
  const [filterProjectId, setFilterProjectId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GameVariant | null>(null);
  const [form] = Form.useForm();

  const projectNameById = useMemo(() => {
    const m = new Map<number, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects]);

  const loadProjects = async () => {
    try {
      const list = await apiRequest<Project[]>("/projects");
      setProjects(list);
    } catch {
      setProjects([]);
    }
  };

  const loadVariants = async () => {
    try {
      const q = filterProjectId != null ? `?project_id=${filterProjectId}` : "";
      setRows(await apiRequest<GameVariant[]>(`/game-variants${q}`));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadAll = async () => {
    await loadProjects();
    await loadVariants();
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const k = (searchParams.get("keyword") || "").trim();
    setKeyword(k);
  }, [searchParams]);

  useEffect(() => {
    loadVariants();
  }, [filterProjectId]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (filterProjectId != null) {
      list = list.filter((r) => r.project_id === filterProjectId);
    }
    const q = keyword.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => r.raw_game_name.toLowerCase().includes(q) || r.variant_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, filterProjectId, keyword]);

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      project_id: values.project_id as number,
      variant_name: (values.variant_name as string).trim(),
      raw_game_name: (values.raw_game_name as string).trim(),
      discount_type: values.discount_type as string,
      version_type: values.version_type as string,
      server_type: values.server_type as string,
      status: values.status ? "active" : "paused",
      remark: ((values.remark as string) || "").trim(),
      rd_company: ((values.rd_company as string) || "").trim() || null,
      publish_company: ((values.publish_company as string) || "").trim() || "广州熊动科技有限公司",
      rd_share_percent: typeof values.rd_share_percent === "number" ? values.rd_share_percent : null,
      publish_share_percent: typeof values.publish_share_percent === "number" ? values.publish_share_percent : null,
      settlement_remark: ((values.settlement_remark as string) || "").trim() || null,
    };
    try {
      if (editing) {
        await apiRequest(`/game-variants/${editing.id}`, "PUT", payload);
      } else {
        await apiRequest("/game-variants", "POST", payload);
      }
      setOpen(false);
      setEditing(null);
      form.resetFields();
      message.success(editing ? "已保存" : "已创建");
      loadVariants();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const toggleStatus = async (r: GameVariant, checked: boolean) => {
    try {
      await apiRequest(`/game-variants/${r.id}/status`, "PATCH", { status: checked ? "active" : "paused" });
      loadVariants();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ ...defaultFormValues });
    setOpen(true);
  };

  const openEdit = (r: GameVariant) => {
    setEditing(r);
    form.setFieldsValue({
      project_id: r.project_id,
      variant_name: r.variant_name,
      raw_game_name: r.raw_game_name,
      discount_type: r.discount_type,
      version_type: r.version_type,
      server_type: r.server_type,
      status: r.status === "active",
      remark: r.remark,
      rd_company: r.rd_company || "",
      publish_company: r.publish_company || "广州熊动科技有限公司",
      rd_share_percent: r.rd_share_percent ?? undefined,
      publish_share_percent: r.publish_share_percent ?? undefined,
      settlement_remark: r.settlement_remark || "",
    });
    setOpen(true);
  };

  return (
    <Card
      title="游戏版本管理"
      extra={
        <Space wrap>
          <Input
            allowClear
            placeholder="搜索原始游戏名 / 版本名"
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="按项目筛选"
            style={{ width: 200 }}
            options={projects.map((p) => ({ label: p.name, value: p.id }))}
            value={filterProjectId}
            onChange={(v) => setFilterProjectId(v)}
          />
          <Button onClick={loadAll}>刷新</Button>
          <Button type="primary" onClick={openCreate}>
            新增版本
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={filteredRows}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1100 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 72 },
          {
            title: "所属项目",
            width: 140,
            render: (_, r) => projectNameById.get(r.project_id) || `#${r.project_id}`,
          },
          { title: "版本名称", dataIndex: "variant_name", width: 140 },
          { title: "原始游戏名(raw)", dataIndex: "raw_game_name", ellipsis: true },
          {
            title: "折扣类型",
            dataIndex: "discount_type",
            width: 100,
            render: (v: string) => DISCOUNT_OPTIONS.find((o) => o.value === v)?.label || v,
          },
          { title: "版本类型", dataIndex: "version_type", width: 100 },
          { title: "服类型", dataIndex: "server_type", width: 80 },
          { title: "研发主体", dataIndex: "rd_company", width: 160, ellipsis: true, render: (v: string) => v || "-" },
          { title: "发行主体", dataIndex: "publish_company", width: 180, ellipsis: true, render: (v: string) => v || "-" },
          {
            title: "研发分成",
            dataIndex: "rd_share_percent",
            width: 100,
            render: (v: number | null) => (typeof v === "number" ? `${v}%` : "-"),
          },
          {
            title: "发行分成",
            dataIndex: "publish_share_percent",
            width: 100,
            render: (v: number | null) => (typeof v === "number" ? `${v}%` : "-"),
          },
          { title: "备注", dataIndex: "remark", ellipsis: true, width: 120 },
          {
            title: "状态",
            dataIndex: "status",
            width: 88,
            render: (v: string) => <Tag color={v === "active" ? "green" : "default"}>{v === "active" ? "启用" : "暂停"}</Tag>,
          },
          {
            title: "启用",
            width: 88,
            render: (_, r) => <Switch checked={r.status === "active"} onChange={(c) => toggleStatus(r, c)} />,
          },
          {
            title: "操作",
            width: 88,
            render: (_, r) => (
              <Button size="small" onClick={() => openEdit(r)}>
                编辑
              </Button>
            ),
          },
        ]}
      />
      <Modal
        open={open}
        title={editing ? "编辑版本" : "新增版本"}
        onCancel={() => setOpen(false)}
        onOk={submit}
        width={560}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changedValues) => {
            if (Object.prototype.hasOwnProperty.call(changedValues, "rd_share_percent")) {
              const rd = changedValues.rd_share_percent as number | null | undefined;
              if (typeof rd === "number") {
                form.setFieldValue("publish_share_percent", Number((100 - rd).toFixed(2)));
              } else {
                form.setFieldValue("publish_share_percent", undefined);
              }
            }
          }}
        >
          <Form.Item name="project_id" label="所属项目" rules={[{ required: true, message: "请选择项目" }]}>
            <Select
              placeholder="选择项目"
              options={projects.map((p) => ({
                label: `${p.name}${p.status !== "active" ? "（暂停）" : ""}`,
                value: p.id,
              }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="variant_name" label="版本名称" rules={[{ required: true, message: "例如：005折混服" }]}>
            <Input placeholder="如：005折混服" />
          </Form.Item>
          <Form.Item
            name="raw_game_name"
            label="原始游戏名"
            rules={[{ required: true, message: "与导入/对账中的 game_name 一致，如：一起来修仙005折混服" }]}
          >
            <Input placeholder="与流水中的游戏名称一致" />
          </Form.Item>
          <Form.Item name="discount_type" label="折扣类型" rules={[{ required: true }]}>
            <Select options={DISCOUNT_OPTIONS} />
          </Form.Item>
          <Form.Item name="version_type" label="版本类型" rules={[{ required: true }]}>
            <Select options={VERSION_OPTIONS} />
          </Form.Item>
          <Form.Item name="server_type" label="服类型" rules={[{ required: true }]}>
            <Select options={SERVER_OPTIONS} />
          </Form.Item>
          <Form.Item name="status" label="启用" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
          <Form.Item name="rd_company" label="研发主体">
            <Input placeholder="可为空" />
          </Form.Item>
          <Form.Item name="publish_company" label="发行主体" initialValue="广州熊动科技有限公司">
            <Input placeholder="默认：广州熊动科技有限公司" />
          </Form.Item>
          <Form.Item
            name="rd_share_percent"
            label="研发分成(%)"
            rules={[
              {
                validator: (_, value: number | undefined) => {
                  if (value == null) return Promise.resolve();
                  if (value >= 0 && value <= 100) return Promise.resolve();
                  return Promise.reject(new Error("研发分成需在 0~100 之间"));
                },
              },
            ]}
          >
            <InputNumber min={0} max={100} step={0.01} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="publish_share_percent" label="发行分成(%)">
            <InputNumber min={0} max={100} step={0.01} precision={2} style={{ width: "100%" }} disabled />
          </Form.Item>
          <Form.Item name="settlement_remark" label="结算备注">
            <Input.TextArea rows={2} placeholder="可为空" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function GameVariantsPage() {
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <GameVariantsPageContent />
    </Suspense>
  );
}
