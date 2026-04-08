"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";

type ContractStatus = "draft" | "active" | "expired" | "void";

type ContractHeaderRow = {
  id: number;
  contract_no: string;
  contract_name: string;
  channel_name: string;
  platform_party_name?: string;
  platform_party_address?: string;
  developer_party_name?: string;
  developer_party_address?: string;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  remark?: string;
  created_at?: string;
  updated_at?: string;
};

const STATUS_LABEL: Record<ContractStatus, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  active: { text: "生效", color: "green" },
  expired: { text: "已到期", color: "orange" },
  void: { text: "作废", color: "red" },
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ContractStatus[]).map((v) => ({
  label: STATUS_LABEL[v].text,
  value: v,
}));

export default function ContractsListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ContractHeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelQ, setChannelQ] = useState("");
  const [statusQ, setStatusQ] = useState<ContractStatus | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContractHeaderRow | null>(null);
  const [form] = Form.useForm();
  const canMutate = hasRole(["admin", "finance_manager", "tech"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (channelQ.trim()) p.set("channel", channelQ.trim());
      if (statusQ) p.set("status", statusQ);
      const data = await apiRequest<ContractHeaderRow[]>(`/contracts?${p.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      message.error((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [channelQ, statusQ]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      platform_party_name: "广州熊动科技有限公司",
      status: "draft",
      start_date: dayjs(),
      end_date: dayjs().add(1, "year"),
    });
    setOpen(true);
  };

  const openEdit = (r: ContractHeaderRow) => {
    setEditing(r);
    form.setFieldsValue({
      contract_no: r.contract_no,
      contract_name: r.contract_name,
      channel_name: r.channel_name,
      platform_party_name: r.platform_party_name || "广州熊动科技有限公司",
      platform_party_address: r.platform_party_address || "",
      developer_party_name: r.developer_party_name || "",
      developer_party_address: r.developer_party_address || "",
      start_date: r.start_date ? dayjs(r.start_date) : null,
      end_date: r.end_date ? dayjs(r.end_date) : null,
      status: r.status,
      remark: r.remark || "",
    });
    setOpen(true);
  };

  const submitHeader = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const start = values.start_date as Dayjs;
    const end = values.end_date as Dayjs;
    const payload = {
      contract_no: String(values.contract_no || "").trim(),
      contract_name: String(values.contract_name || "").trim(),
      channel_name: String(values.channel_name || "").trim(),
      platform_party_name: String(values.platform_party_name || "广州熊动科技有限公司").trim() || "广州熊动科技有限公司",
      platform_party_address: String(values.platform_party_address || "").trim(),
      developer_party_name: String(values.developer_party_name || "").trim(),
      developer_party_address: String(values.developer_party_address || "").trim(),
      start_date: start.format("YYYY-MM-DD"),
      end_date: end.format("YYYY-MM-DD"),
      status: values.status as ContractStatus,
      remark: String(values.remark || "").trim(),
    };
    try {
      if (editing) {
        await apiRequest(`/contracts/${editing.id}`, "PUT", payload);
        message.success("已保存");
      } else {
        await apiRequest("/contracts", "POST", payload);
        message.success("已创建");
      }
      setOpen(false);
      setEditing(null);
      form.resetFields();
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<ContractHeaderRow> = useMemo(
    () => [
      { title: "合同编号", dataIndex: "contract_no", width: 140, ellipsis: true },
      { title: "合同名称", dataIndex: "contract_name", ellipsis: true },
      { title: "渠道", dataIndex: "channel_name", width: 120, ellipsis: true },
      {
        title: "合同有效期",
        width: 220,
        render: (_, r) => (
          <span>
            {r.start_date || "—"} ~ {r.end_date || "—"}
          </span>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 100,
        render: (s: ContractStatus) => {
          const x = STATUS_LABEL[s] || { text: s, color: "default" };
          return <Tag color={x.color}>{x.text}</Tag>;
        },
      },
      {
        title: "操作",
        width: 200,
        render: (_, r) => (
          <Space>
            <Button type="link" size="small" onClick={() => router.push(`/contracts/${r.id}`)}>
              查看
            </Button>
            {canMutate ? (
              <Button type="link" size="small" onClick={() => openEdit(r)}>
                编辑
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [canMutate, router]
  );

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card
        title="合同管理"
        extra={
          canMutate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建合同
            </Button>
          ) : null
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          用于维护<strong>广州熊动科技有限公司</strong>与各渠道的签约依据（合同主数据与分成相关条款摘录）。当前版本不包含附件与审批流；后续可逐步与<strong>规则配置</strong>、<strong>导入预检</strong>等模块联动，不替代现有
          channel-game-map / billing-rules 的即时配置逻辑。
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            placeholder="按渠道名称搜索"
            style={{ width: 200 }}
            value={channelQ}
            onChange={(e) => setChannelQ(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Select
            allowClear
            placeholder="合同状态"
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
            value={statusQ}
            onChange={(v) => setStatusQ(v)}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
        />
        <Modal
          title={editing ? "编辑合同" : "新建合同"}
          open={open}
          onCancel={() => {
            setOpen(false);
            setEditing(null);
            form.resetFields();
          }}
          onOk={() => void submitHeader()}
          width={640}
          destroyOnClose
        >
          <Form form={form} layout="vertical">
            <Form.Item name="contract_no" label="合同编号" rules={[{ required: true, message: "请输入合同编号" }]}>
              <Input placeholder="唯一编号" />
            </Form.Item>
            <Form.Item name="contract_name" label="合同名称" rules={[{ required: true, message: "请输入合同名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="channel_name" label="渠道名称" rules={[{ required: true, message: "请输入渠道名称" }]}>
              <Input placeholder="与主数据渠道名称保持一致便于后续联动" />
            </Form.Item>
            <Form.Item name="platform_party_name" label="平台/发行主体（甲方）">
              <Input />
            </Form.Item>
            <Form.Item name="platform_party_address" label="甲方地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="developer_party_name" label="研发/乙方名称">
              <Input />
            </Form.Item>
            <Form.Item name="developer_party_address" label="乙方地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="start_date" label="开始日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="end_date" label="结束日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Space>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={3} placeholder="纸质合同存档位置、补充说明等（本版不支持附件上传）" />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </RoleGuard>
  );
}
