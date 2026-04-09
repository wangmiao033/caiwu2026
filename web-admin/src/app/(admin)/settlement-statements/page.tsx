"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

type ChannelOption = { id: number; name: string };

type StmtRow = {
  id: number;
  statement_no: string;
  settlement_month: string;
  channel_id: number;
  channel_name: string;
  statement_title: string;
  total_settlement_amount: number | string;
  total_settlement_amount_cn: string;
  statement_status: string;
  created_at: string;
};

function normalizePeriodYm(raw: string): string | null {
  const t = raw.trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const monthNum = parseInt(m[2], 10);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${m[1]}-${String(monthNum).padStart(2, "0")}`;
}

function amt(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

async function downloadMonthlyExport(id: number, channelName: string, month: string) {
  const token = localStorage.getItem("access_token") || "";
  const xRole = localStorage.getItem("x_role") || "";
  const xUser = localStorage.getItem("x_user") || "";
  const resp = await fetch(`/api/proxy/monthly-settlement-statements/${id}/export-excel`, {
    method: "GET",
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "x-role": xRole,
      "x-user": xUser,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    try {
      const j = JSON.parse(text) as { detail?: string };
      throw new Error(j.detail || "导出失败");
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(text || "导出失败");
    }
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `渠道月度结算对账单_${channelName}_${month}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MonthlySettlementStatementsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [month, setMonth] = useState("");
  const [channelId, setChannelId] = useState<number | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StmtRow[]>([]);
  const [total, setTotal] = useState(0);
  const [genLoading, setGenLoading] = useState(false);

  const canWrite = hasRole(["admin", "finance_manager", "ops_manager"]);

  const channelOpts = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);

  const loadChannels = async () => {
    try {
      setChannels(await apiRequest<ChannelOption[]>("/channels"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (month.trim()) {
        const m = normalizePeriodYm(month.trim());
        if (m) q.set("settlement_month", m);
      }
      if (channelId) q.set("channel_id", String(channelId));
      if (status) q.set("statement_status", status);
      q.set("page_size", "50");
      const data = await apiRequest<{ items: StmtRow[]; total: number }>(`/monthly-settlement-statements?${q.toString()}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doGenerate = (overwrite: boolean) => {
    if (!canWrite) return;
    const m = normalizePeriodYm(month.trim());
    if (!m) {
      message.warning("请先填写合法账期 YYYY-MM");
      return;
    }
    if (!channelId) {
      message.warning("请选择渠道");
      return;
    }
    setGenLoading(true);
    apiRequest<{ id: number; statement_no: string }>("/monthly-settlement-statements/generate", "POST", {
      settlement_month: m,
      channel_id: channelId,
      overwrite,
    })
      .then((r) => {
        message.success(`已生成账单 ${r.statement_no}`);
        void loadList();
        router.push(`/settlement-statements/${r.id}`);
      })
      .catch((e) => message.error((e as Error).message))
      .finally(() => setGenLoading(false));
  };

  const confirmOverwrite = () => {
    Modal.confirm({
      title: "覆盖重生成",
      content: "将删除原账单及明细绑定并重算，是否继续？",
      okText: "覆盖",
      onOk: () => doGenerate(true),
    });
  };

  const patchStatus = async (id: number, statement_status: string) => {
    try {
      await apiRequest(`/monthly-settlement-statements/${id}/status`, "PATCH", { statement_status });
      message.success("状态已更新");
      void loadList();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<StmtRow> = [
    { title: "编号", dataIndex: "statement_no", width: 140, ellipsis: true },
    { title: "账期", dataIndex: "settlement_month", width: 90 },
    { title: "渠道", dataIndex: "channel_name", width: 120, ellipsis: true },
    { title: "结算金额", render: (_, r) => amt(r.total_settlement_amount) },
    {
      title: "状态",
      width: 160,
      render: (_, r) =>
        canWrite ? (
          <Select
            size="small"
            style={{ width: 140 }}
            value={r.statement_status}
            options={[
              { value: "draft", label: "draft" },
              { value: "pending_confirm", label: "pending_confirm" },
              { value: "confirmed", label: "confirmed" },
              { value: "exported", label: "exported" },
              { value: "paid", label: "paid" },
            ]}
            onChange={(v) => void patchStatus(r.id, v)}
          />
        ) : (
          <Tag>{r.statement_status}</Tag>
        ),
    },
    {
      title: "操作",
      width: 220,
      fixed: "right",
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" onClick={() => router.push(`/settlement-statements/${r.id}`)}>
            详情
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() =>
              void downloadMonthlyExport(r.id, r.channel_name || String(r.channel_id), r.settlement_month).catch((e) =>
                message.error((e as Error).message)
              )
            }
          >
            导出
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        渠道月度结算对账单
      </Typography.Title>
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input placeholder="账期 YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 130 }} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="渠道"
            style={{ width: 200 }}
            value={channelId}
            onChange={(v) => setChannelId(v)}
            options={channelOpts}
          />
          <Select
            allowClear
            placeholder="账单状态"
            style={{ width: 160 }}
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { value: "draft", label: "draft" },
              { value: "pending_confirm", label: "pending_confirm" },
              { value: "confirmed", label: "confirmed" },
              { value: "exported", label: "exported" },
              { value: "paid", label: "paid" },
            ]}
          />
          <Button onClick={() => void loadList()} loading={loading}>
            查询
          </Button>
          {canWrite && (
            <>
              <Button type="primary" loading={genLoading} onClick={() => doGenerate(false)}>
                一键生成
              </Button>
              <Button loading={genLoading} onClick={confirmOverwrite}>
                覆盖重生成
              </Button>
            </>
          )}
        </Space>
        <Table<StmtRow>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          scroll={{ x: 960 }}
          pagination={{ pageSize: 20, total, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
    </Space>
  );
}
