"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Descriptions, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ArrowLeftOutlined, EditOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";
import { STATUS_LABEL, type ContractStatus } from "../types";

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

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
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

  const itemColumns: ColumnsType<ContractItemRow> = [
    { title: "游戏名称", dataIndex: "game_name", ellipsis: true },
    { title: "折扣说明", dataIndex: "discount_label", ellipsis: true, render: (v: string) => v || "—" },
    { title: "折扣率", dataIndex: "discount_rate", width: 90, render: (v: number) => v ?? 0 },
    { title: "渠道分成(%)", dataIndex: "channel_share_percent", width: 110 },
    { title: "通道费(%)", dataIndex: "channel_fee_percent", width: 100 },
    { title: "税点(%)", dataIndex: "tax_percent", width: 80 },
    { title: "私点(%)", dataIndex: "private_percent", width: 80 },
    {
      title: "研发分成说明",
      dataIndex: "rd_share_note",
      ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "启用",
      dataIndex: "is_active",
      width: 80,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "是" : "否"}</Tag>,
    },
  ];

  const st = detail ? STATUS_LABEL[detail.status] : null;

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card loading={loading}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/contracts")}>
              返回列表
            </Button>
            {detail && canMutate ? (
              <Button type="primary" icon={<EditOutlined />} onClick={() => router.push(`/contracts/${detail.id}/edit`)}>
                编辑合同
              </Button>
            ) : null}
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            合同数据作为渠道签约依据归档；与线上「规则配置」「渠道-游戏映射」相互独立。修改主档或明细请使用「编辑合同」进入独立录入页。
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
                <Descriptions.Item label="备注 / 来源" span={2}>
                  {detail.remark || "—"}
                </Descriptions.Item>
              </Descriptions>

              <Card size="small" title="合同明细（只读）">
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
      </Card>
    </RoleGuard>
  );
}
