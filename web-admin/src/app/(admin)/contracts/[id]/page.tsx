"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";

type ContractStatus = "draft" | "active" | "expired" | "void";

type ContractItemRow = {
  id: number;
  contract_id: number;
  game_name: string;
  discount_label: string;
  discount_rate: number;
  channel_share_percent: number;
  channel_fee_percent: number;
  tax_percent: number;
  private_percent: number;
  rd_share_note: string;
  is_active: boolean;
};

type ContractDetail = {
  id: number;
  contract_no: string;
  contract_name: string;
  channel_name: string;
  platform_party_name: string;
  platform_party_address: string;
  developer_party_name: string;
  developer_party_address: string;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  remark: string;
  items: ContractItemRow[];
};

const STATUS_LABEL: Record<ContractStatus, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  active: { text: "生效", color: "green" },
  expired: { text: "已到期", color: "orange" },
  void: { text: "作废", color: "red" },
};

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContractItemRow | null>(null);
  const [itemForm] = Form.useForm();
  const canMutate = hasRole(["admin", "finance_manager", "tech"]);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return;
    setLoading(true);
    try {
      const data = await apiRequest<ContractDetail>(`/contracts/${id}`);
      setDetail(data);
    } catch (e) {
      message.error((e as Error).message);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAddItem = () => {
    if (!detail) return;
    setEditingItem(null);
    itemForm.resetFields();
    itemForm.setFieldsValue({
      game_name: "",
      discount_label: "",
      discount_rate: 0,
      channel_share_percent: 0,
      channel_fee_percent: 0,
      tax_percent: 0,
      private_percent: 0,
      rd_share_note: "",
      is_active: true,
    });
    setItemOpen(true);
  };

  const openEditItem = (row: ContractItemRow) => {
    setEditingItem(row);
    itemForm.setFieldsValue({
      game_name: row.game_name,
      discount_label: row.discount_label,
      discount_rate: row.discount_rate,
      channel_share_percent: row.channel_share_percent,
      channel_fee_percent: row.channel_fee_percent,
      tax_percent: row.tax_percent,
      private_percent: row.private_percent,
      rd_share_note: row.rd_share_note,
      is_active: row.is_active,
    });
    setItemOpen(true);
  };

  const submitItem = async () => {
    if (!detail) return;
    let values: Record<string, unknown>;
    try {
      values = await itemForm.validateFields();
    } catch {
      return;
    }
    const payload = {
      game_name: String(values.game_name || "").trim(),
      discount_label: String(values.discount_label || "").trim(),
      discount_rate: Number(values.discount_rate ?? 0),
      channel_share_percent: Number(values.channel_share_percent ?? 0),
      channel_fee_percent: Number(values.channel_fee_percent ?? 0),
      tax_percent: Number(values.tax_percent ?? 0),
      private_percent: Number(values.private_percent ?? 0),
      rd_share_note: String(values.rd_share_note || "").trim(),
      is_active: Boolean(values.is_active),
    };
    try {
      if (editingItem) {
        await apiRequest(`/contract-items/${editingItem.id}`, "PUT", payload);
        message.success("明细已更新");
      } else {
        await apiRequest(`/contracts/${detail.id}/items`, "POST", payload);
        message.success("明细已添加");
      }
      setItemOpen(false);
      setEditingItem(null);
      itemForm.resetFields();
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const removeItem = (row: ContractItemRow) => {
    Modal.confirm({
      title: "删除该合同明细？",
      onOk: async () => {
        try {
          await apiRequest(`/contract-items/${row.id}`, "DELETE");
          message.success("已删除");
          void load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const itemColumns: ColumnsType<ContractItemRow> = [
    { title: "游戏名称", dataIndex: "game_name", ellipsis: true },
    { title: "折扣说明", dataIndex: "discount_label", ellipsis: true, render: (v: string) => v || "—" },
    { title: "折扣率", dataIndex: "discount_rate", width: 90, render: (v: number) => v ?? 0 },
    { title: "渠道分成(%)", dataIndex: "channel_share_percent", width: 110 },
    { title: "通道费(%)", dataIndex: "channel_fee_percent", width: 100 },
    { title: "税点(%)", dataIndex: "tax_percent", width: 80 },
    { title: "私点(%)", dataIndex: "private_percent", width: 80 },
    {
      title: "启用",
      dataIndex: "is_active",
      width: 80,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "是" : "否"}</Tag>,
    },
    {
      title: "操作",
      width: 160,
      render: (_, row) =>
        canMutate ? (
          <Space>
            <Button type="link" size="small" onClick={() => openEditItem(row)}>
              编辑
            </Button>
            <Button type="link" size="small" danger onClick={() => removeItem(row)}>
              删除
            </Button>
          </Space>
        ) : (
          "—"
        ),
    },
  ];

  const st = detail ? STATUS_LABEL[detail.status] : null;

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card loading={loading}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/contracts")}>
              返回列表
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            合同数据作为渠道签约依据归档；与线上「规则配置」「渠道-游戏映射」相互独立，后续版本可再做自动校验或同步。
          </Typography.Paragraph>
          {detail ? (
            <>
              <Descriptions title="合同基础信息" bordered column={2} size="small">
                <Descriptions.Item label="合同编号">{detail.contract_no}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  {st ? <Tag color={st.color}>{st.text}</Tag> : detail.status}
                </Descriptions.Item>
                <Descriptions.Item label="合同名称" span={2}>
                  {detail.contract_name}
                </Descriptions.Item>
                <Descriptions.Item label="渠道名称">{detail.channel_name}</Descriptions.Item>
                <Descriptions.Item label="有效期">
                  {detail.start_date ? dayjs(detail.start_date).format("YYYY-MM-DD") : "—"} ~{" "}
                  {detail.end_date ? dayjs(detail.end_date).format("YYYY-MM-DD") : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="平台/发行主体（甲方）" span={2}>
                  {detail.platform_party_name || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="甲方地址" span={2}>
                  {detail.platform_party_address || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="研发/乙方" span={2}>
                  {detail.developer_party_name || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="乙方地址" span={2}>
                  {detail.developer_party_address || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="备注" span={2}>
                  {detail.remark || "—"}
                </Descriptions.Item>
              </Descriptions>

              <Card
                size="small"
                title="合同明细（按游戏维度摘录条款）"
                extra={
                  canMutate ? (
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddItem}>
                      新增明细
                    </Button>
                  ) : null
                }
              >
                <Table
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 8 }}
                  columns={itemColumns}
                  dataSource={detail.items || []}
                />
              </Card>
            </>
          ) : !loading ? (
            <Typography.Text type="secondary">未找到合同</Typography.Text>
          ) : null}
        </Space>
        <Modal
          title={editingItem ? "编辑明细" : "新增明细"}
          open={itemOpen}
          onCancel={() => {
            setItemOpen(false);
            setEditingItem(null);
            itemForm.resetFields();
          }}
          onOk={() => void submitItem()}
          width={560}
          destroyOnClose
        >
          <Form form={itemForm} layout="vertical">
            <Form.Item name="game_name" label="游戏名称" rules={[{ required: true }]}>
              <Input placeholder="与主数据/导入 game_name 一致便于对照" />
            </Form.Item>
            <Form.Item name="discount_label" label="折扣标签">
              <Input placeholder="如无/0.1折 等" />
            </Form.Item>
            <Form.Item name="discount_rate" label="折扣率(小数或比例，按需填写)">
              <InputNumber style={{ width: "100%" }} min={0} step={0.0001} />
            </Form.Item>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="channel_share_percent" label="渠道分成(%)">
                <InputNumber min={0} max={100} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="channel_fee_percent" label="通道费(%)">
                <InputNumber min={0} max={100} style={{ width: 160 }} />
              </Form.Item>
            </Space>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="tax_percent" label="税点(%)">
                <InputNumber min={0} max={100} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="private_percent" label="私点(%)">
                <InputNumber min={0} max={100} style={{ width: 160 }} />
              </Form.Item>
            </Space>
            <Form.Item name="rd_share_note" label="研发分成说明">
              <Input.TextArea rows={2} placeholder="如与研发分成相关的特别约定（不等同游戏主数据 rd_share）" />
            </Form.Item>
            <Form.Item name="is_active" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </RoleGuard>
  );
}
