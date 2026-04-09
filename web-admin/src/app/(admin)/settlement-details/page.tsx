"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

type ChannelOption = { id: number; name: string };
type GameOption = { id: number; name: string };

type DetailRow = {
  id: number;
  batch_id: number;
  settlement_month: string;
  channel_id: number;
  channel_name: string;
  game_id: number | null;
  game_name: string;
  raw_game_name: string;
  game_name_snapshot: string;
  gross_revenue: number | string;
  test_fee: number | string;
  coupon_fee: number | string;
  participation_amount: number | string;
  revenue_share_ratio: number | string | null;
  channel_fee_ratio: number | string | null;
  settlement_amount: number | string;
  row_status: string;
  error_message: string;
  remark: string;
  monthly_statement_id: number | null;
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

function ratioPct(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
}

function statusTag(s: string) {
  const colors: Record<string, string> = {
    normal: "green",
    error: "red",
    pending_confirm: "gold",
    used_in_statement: "blue",
  };
  return <Tag color={colors[s] || "default"}>{s}</Tag>;
}

export default function SettlementDetailsPage() {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [games, setGames] = useState<GameOption[]>([]);
  const [month, setMonth] = useState("");
  const [channelId, setChannelId] = useState<number | undefined>();
  const [rowStatus, setRowStatus] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    normal: 0,
    error: 0,
    pending_confirm: 0,
    used_in_statement: 0,
  });
  const [items, setItems] = useState<DetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<DetailRow | null>(null);
  const [form] = Form.useForm();

  const canWrite = hasRole(["admin", "finance_manager", "ops_manager"]);

  const channelOpts = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);
  const gameOpts = useMemo(() => games.map((g) => ({ label: g.name, value: g.id })), [games]);

  const loadRefs = async () => {
    try {
      const [ch, gm] = await Promise.all([
        apiRequest<ChannelOption[]>("/channels"),
        apiRequest<GameOption[]>("/games"),
      ]);
      setChannels(ch || []);
      setGames(gm || []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadList = async (pageNum: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (month.trim()) {
        const m = normalizePeriodYm(month.trim());
        if (m) q.set("settlement_month", m);
      }
      if (channelId) q.set("channel_id", String(channelId));
      if (rowStatus) q.set("row_status", rowStatus);
      if (keyword.trim()) q.set("keyword", keyword.trim());
      q.set("page", String(pageNum));
      q.set("page_size", "30");
      const data = await apiRequest<{ stats: typeof stats; items: DetailRow[]; total: number }>(
        `/settlement-details?${q.toString()}`
      );
      setStats(data.stats || stats);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(pageNum);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRefs();
  }, []);

  useEffect(() => {
    void loadList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅筛选条件变化时回到第一页
  }, [month, channelId, rowStatus, keyword]);

  const openEdit = (r: DetailRow) => {
    if (!canWrite) return;
    if (r.row_status === "used_in_statement") {
      message.warning("已用于账单的明细不可编辑");
      return;
    }
    setEditing(r);
    form.setFieldsValue({
      game_id: r.game_id ?? undefined,
      test_fee: Number(r.test_fee),
      coupon_fee: Number(r.coupon_fee),
      revenue_share_ratio: r.revenue_share_ratio != null ? Number(r.revenue_share_ratio) : undefined,
      channel_fee_ratio: r.channel_fee_ratio != null ? Number(r.channel_fee_ratio) : undefined,
      remark: r.remark,
      row_status: r.row_status,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const v = await form.validateFields();
      await apiRequest(`/settlement-details/${editing.id}`, "PATCH", {
        game_id: v.game_id,
        test_fee: v.test_fee,
        coupon_fee: v.coupon_fee,
        revenue_share_ratio: v.revenue_share_ratio,
        channel_fee_ratio: v.channel_fee_ratio,
        remark: v.remark,
        row_status: v.row_status,
      });
      message.success("已保存并重算");
      setEditOpen(false);
      await loadList(page);
    } catch (e) {
      if ((e as { errorFields?: unknown })?.errorFields) return;
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<DetailRow> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "账期", dataIndex: "settlement_month", width: 90 },
    { title: "渠道", dataIndex: "channel_name", width: 110, ellipsis: true },
    { title: "原始游戏名", dataIndex: "raw_game_name", width: 120, ellipsis: true },
    { title: "游戏", dataIndex: "game_name", width: 120, ellipsis: true },
    { title: "流水", render: (_, r) => amt(r.gross_revenue) },
    { title: "测试费", render: (_, r) => amt(r.test_fee) },
    { title: "代金券", render: (_, r) => amt(r.coupon_fee) },
    { title: "参与分成", render: (_, r) => amt(r.participation_amount) },
    { title: "分成比", render: (_, r) => ratioPct(r.revenue_share_ratio) },
    { title: "渠道费比", render: (_, r) => ratioPct(r.channel_fee_ratio) },
    { title: "结算额", render: (_, r) => amt(r.settlement_amount) },
    { title: "状态", dataIndex: "row_status", width: 120, render: (s) => statusTag(String(s)) },
    {
      title: "操作",
      width: 80,
      fixed: "right",
      render: (_, r) =>
        canWrite ? (
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        结算明细
      </Typography.Title>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title="总条数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title="正常" value={stats.normal} valueStyle={{ color: "#3f8600" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title="异常" value={stats.error} valueStyle={{ color: "#cf1322" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title="待确认" value={stats.pending_confirm} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={4}>
          <Card size="small">
            <Statistic title="已用于账单" value={stats.used_in_statement} />
          </Card>
        </Col>
      </Row>
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
            placeholder="行状态"
            style={{ width: 140 }}
            value={rowStatus}
            onChange={(v) => setRowStatus(v)}
            options={[
              { value: "normal", label: "normal" },
              { value: "error", label: "error" },
              { value: "pending_confirm", label: "pending_confirm" },
              { value: "used_in_statement", label: "used_in_statement" },
            ]}
          />
          <Input placeholder="搜索游戏/备注" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 180 }} />
          <Button type="primary" onClick={() => void loadList(1)} loading={loading}>
            查询
          </Button>
        </Space>
        <Table<DetailRow>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize: 30,
            total,
            showSizeChanger: false,
            onChange: (p) => void loadList(p),
          }}
        />
      </Card>
      <Modal title="编辑明细" open={editOpen} onOk={() => void submitEdit()} onCancel={() => setEditOpen(false)} width={560} destroyOnClose>
        {editing?.error_message ? (
          <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
            {editing.error_message}
          </Typography.Paragraph>
        ) : null}
        <Form form={form} layout="vertical">
          <Form.Item name="game_id" label="游戏">
            <Select showSearch optionFilterProp="label" options={gameOpts} placeholder="选择 games 主数据" allowClear />
          </Form.Item>
          <Form.Item name="test_fee" label="测试费">
            <InputNumber style={{ width: "100%" }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="coupon_fee" label="代金券">
            <InputNumber style={{ width: "100%" }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="revenue_share_ratio" label="流水分成比例（小数，如 0.3）">
            <InputNumber style={{ width: "100%" }} min={0} max={1} step={0.01} />
          </Form.Item>
          <Form.Item name="channel_fee_ratio" label="渠道费比例（小数）">
            <InputNumber style={{ width: "100%" }} min={0} max={1} step={0.01} />
          </Form.Item>
          <Form.Item name="row_status" label="行状态">
            <Select
              options={[
                { value: "normal", label: "normal" },
                { value: "pending_confirm", label: "pending_confirm" },
                { value: "error", label: "error" },
              ]}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
