"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Descriptions, Drawer, Input, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

type ChannelOption = { id: number; name: string };

type StatementRow = {
  id: number;
  period: string;
  channel_id: number;
  channel_name: string;
  total_gross_amount: number;
  total_discount_amount: number;
  total_settlement_base_amount: number;
  total_channel_fee_amount: number;
  total_settlement_amount: number;
  status: string;
  updated_at: string;
  created_at: string;
};

type StatementListResp = {
  items: StatementRow[];
  total: number;
};

type StatementDetail = StatementRow & {
  note: string;
  created_by: string;
  items: Array<{
    id: number;
    game_id: number;
    game_name_snapshot: string;
    gross_amount: number;
    discount_amount: number;
    settlement_base_amount: number;
    channel_fee_rate: number;
    channel_fee_amount: number;
    settlement_amount: number;
    sort_order: number;
  }>;
};

function amount(v: number | string | null | undefined): string {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function statusTag(status: string) {
  return <Tag color="blue">{status || "generated"}</Tag>;
}

export default function SettlementStatementsPage() {
  const [period, setPeriod] = useState("");
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<StatementDetail | null>(null);

  const canOperate = hasRole(["admin", "finance_manager"]);

  const channelOptions = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);

  const loadChannels = async () => {
    try {
      const data = await apiRequest<ChannelOption[]>("/channels");
      setChannels(data || []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (period) p.set("period", period);
      if (channelId) p.set("channel_id", String(channelId));
      if (keyword.trim()) p.set("keyword", keyword.trim());
      p.set("status", "generated");
      const data = await apiRequest<StatementListResp>(`/settlement-statements?${p.toString()}`);
      setRows(data.items || []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    loadList();
  }, []);

  const generateOne = async (overwrite = false) => {
    if (!canOperate) return;
    if (!period) {
      message.error("请先输入账期，例如 2026-04");
      return;
    }
    if (!channelId) {
      message.error("请先选择渠道");
      return;
    }
    try {
      await apiRequest("/settlement-statements/generate", "POST", { period, channel_id: channelId, overwrite });
      message.success(overwrite ? "已覆盖重生成" : "生成成功");
      loadList();
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!overwrite && msg.includes("已存在")) {
        message.warning("该账期渠道对账单已存在，请点击“覆盖重生成”");
      } else {
        message.error(msg || "生成失败");
      }
    }
  };

  const openDetail = async (id: number) => {
    try {
      const data = await apiRequest<StatementDetail>(`/settlement-statements/${id}`);
      setDetail(data);
      setDrawerOpen(true);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const exportStatement = async (id: number, row: StatementRow) => {
    try {
      const token = localStorage.getItem("access_token") || "";
      const xRole = localStorage.getItem("x_role") || "";
      const xUser = localStorage.getItem("x_user") || "";
      const resp = await fetch(`/api/proxy/settlement-statements/${id}/export`, {
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
          const parsed = JSON.parse(text);
          throw new Error(parsed.detail || "导出失败");
        } catch {
          throw new Error(text || "导出失败");
        }
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `settlement_statement_${row.period}_${row.channel_name || row.channel_id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <>
      <Card
        title="渠道结算对账单管理"
        extra={
          <Space>
            <Input placeholder="账期 YYYY-MM" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 140 }} />
            <Select
              allowClear
              placeholder="选择渠道"
              style={{ width: 220 }}
              value={channelId}
              onChange={(v) => setChannelId(v)}
              options={channelOptions}
            />
            <Input placeholder="渠道名搜索" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 180 }} />
            <Button onClick={loadList}>查询</Button>
            {canOperate && (
              <>
                <Button type="primary" onClick={() => generateOne(false)}>
                  生成对账单
                </Button>
                <Button onClick={() => generateOne(true)}>覆盖重生成</Button>
              </>
            )}
          </Space>
        }
      >
        <Table<StatementRow>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={[
            { title: "账期", dataIndex: "period", width: 100 },
            { title: "渠道", dataIndex: "channel_name", width: 200 },
            { title: "系统流水", render: (_, r) => amount(r.total_gross_amount) },
            { title: "减免", render: (_, r) => amount(r.total_discount_amount) },
            { title: "结算基数", render: (_, r) => amount(r.total_settlement_base_amount) },
            { title: "通道费", render: (_, r) => amount(r.total_channel_fee_amount) },
            { title: "对账金额", render: (_, r) => amount(r.total_settlement_amount) },
            { title: "状态", render: (_, r) => statusTag(r.status) },
            {
              title: "操作",
              fixed: "right",
              width: 220,
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openDetail(r.id)}>
                    查看详情
                  </Button>
                  {canOperate && (
                    <Button size="small" onClick={() => exportStatement(r.id, r)}>
                      导出Excel
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          scroll={{ x: 1300 }}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Drawer
        title="对账单详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={980}
        destroyOnClose
      >
        {!detail ? null : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="账期">{detail.period}</Descriptions.Item>
              <Descriptions.Item label="渠道">{detail.channel_name}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="创建人">{detail.created_by || "-"}</Descriptions.Item>
              <Descriptions.Item label="系统流水">{amount(detail.total_gross_amount)}</Descriptions.Item>
              <Descriptions.Item label="减免">{amount(detail.total_discount_amount)}</Descriptions.Item>
              <Descriptions.Item label="结算基数">{amount(detail.total_settlement_base_amount)}</Descriptions.Item>
              <Descriptions.Item label="通道费">{amount(detail.total_channel_fee_amount)}</Descriptions.Item>
              <Descriptions.Item label="对账金额">{amount(detail.total_settlement_amount)}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {detail.note || "-"}
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="id"
              dataSource={detail.items || []}
              pagination={false}
              columns={[
                { title: "游戏", dataIndex: "game_name_snapshot", width: 220 },
                { title: "系统流水", render: (_, r) => amount(r.gross_amount) },
                { title: "减免", render: (_, r) => amount(r.discount_amount) },
                { title: "结算基数", render: (_, r) => amount(r.settlement_base_amount) },
                { title: "通道费率", render: (_, r) => `${(Number(r.channel_fee_rate || 0) * 100).toFixed(2)}%` },
                { title: "通道费", render: (_, r) => amount(r.channel_fee_amount) },
                { title: "对账金额", render: (_, r) => amount(r.settlement_amount) },
              ]}
              scroll={{ x: 980 }}
            />
          </Space>
        )}
      </Drawer>
    </>
  );
}

