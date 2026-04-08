"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";
import { STATUS_LABEL, type ContractStatus } from "./types";

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
              <Button type="link" size="small" onClick={() => router.push(`/contracts/${r.id}/edit`)}>
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/contracts/new")}>
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
      </Card>
    </RoleGuard>
  );
}
