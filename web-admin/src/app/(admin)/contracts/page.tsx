"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileExcelOutlined, PlusOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";
import {
  EFFECTIVE_STATUS_FILTER_OPTIONS,
  EFFECTIVE_STATUS_LABEL,
  type ContractEffectiveStatus,
  type ContractStoredStatus,
} from "./types";

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
  status: ContractEffectiveStatus;
  days_to_end?: number | null;
  expiry_reminder?: string;
  stored_status?: ContractStoredStatus;
  remark?: string;
  created_at?: string;
  updated_at?: string;
};

export default function ContractsListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ContractHeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [channelQ, setChannelQ] = useState("");
  const [statusQ, setStatusQ] = useState<ContractEffectiveStatus | undefined>(undefined);
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

  const contractListContextSuffix = useMemo(() => {
    const qs = new URLSearchParams();
    const ch = channelQ.trim();
    if (ch) qs.set("list_channel", ch);
    if (statusQ) qs.set("list_status", statusQ);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [channelQ, statusQ]);

  const doLifecycle = useCallback(
    async (cid: number, action: string) => {
      try {
        await apiRequest(`/contracts/${cid}/lifecycle`, "POST", { action });
        message.success("状态已更新");
        void load();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [load]
  );

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
        render: (s: ContractEffectiveStatus) => {
          const x = EFFECTIVE_STATUS_LABEL[s as ContractEffectiveStatus] || { text: s, color: "default" };
          return <Tag color={x.color}>{x.text}</Tag>;
        },
      },
      {
        title: "到期提醒",
        width: 140,
        ellipsis: true,
        render: (_, r) => r.expiry_reminder || "—",
      },
      {
        title: "剩余天数",
        width: 96,
        render: (_, r) => {
          const d = r.days_to_end;
          if (d == null) return "—";
          if (d < 0) return `已超 ${-d} 天`;
          if (d === 0) return "今天";
          return `${d} 天`;
        },
      },
      {
        title: "操作",
        width: 420,
        render: (_, r) => (
          <Space wrap size={0}>
            <Button type="link" size="small" onClick={() => router.push(`/contracts/${r.id}${contractListContextSuffix}`)}>
              查看
            </Button>
            <Button type="link" size="small" href={`/contracts/${r.id}${contractListContextSuffix}`} target="_blank" rel="noopener noreferrer">
              查看（新标签）
            </Button>
            {canMutate ? (
              <>
                <Button type="link" size="small" onClick={() => router.push(`/contracts/${r.id}/edit${contractListContextSuffix}`)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  href={`/contracts/${r.id}/edit${contractListContextSuffix}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  编辑（新标签）
                </Button>
              </>
            ) : null}
            {canMutate && r.stored_status === "draft" ? (
              <Button type="link" size="small" onClick={() => void doLifecycle(r.id, "activate")}>
                生效
              </Button>
            ) : null}
            {canMutate && r.stored_status === "active" ? (
              <Button type="link" size="small" danger onClick={() => void doLifecycle(r.id, "terminate")}>
                终止
              </Button>
            ) : null}
            {canMutate && r.stored_status === "terminated" ? (
              <Button type="link" size="small" onClick={() => void doLifecycle(r.id, "archive")}>
                归档
              </Button>
            ) : null}
            {canMutate && (r.stored_status === "terminated" || r.stored_status === "archived") ? (
              <Button type="link" size="small" onClick={() => void doLifecycle(r.id, "restore_active")}>
                恢复生效
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [canMutate, router, doLifecycle, contractListContextSuffix]
  );

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card
        title="合同管理"
        extra={
          canMutate ? (
            <Space>
              <Button icon={<FileExcelOutlined />} onClick={() => router.push("/contracts/import-excel")}>
                Excel导入合同
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/contracts/new")}>
                新建合同
              </Button>
            </Space>
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
            placeholder="展示状态筛选"
            style={{ width: 140 }}
            options={EFFECTIVE_STATUS_FILTER_OPTIONS}
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
