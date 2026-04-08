"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";
import { buildExportFilename, exportMultiSheetXlsx } from "@/lib/export";

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

type ChannelBridgeRow = {
  channel: string;
  import_gross_total: string;
  channel_split_total: string;
  rd_split_total: string;
  retention_total: string;
  balance_delta: string;
  is_balanced: boolean;
  active_bills_channel_total: string;
  bills_match_channel_split: boolean;
};

type PeriodReconciliationResp = {
  period: string;
  recon_task_id: number;
  summary: {
    total_import_gross: string;
    channel_split_total: string;
    rd_split_total: string;
    publisher_retention_total: string;
    balance_delta: string;
    unmapped_gross: string;
    raw_row_count: number;
    mapped_row_count: number;
    unmapped_row_count: number;
    active_bills_channel_total: string;
    active_bills_rd_total: string;
    bills_match_raw_split: boolean;
  };
  channels: ChannelBridgeRow[];
  intro_note: string;
};

const PERIOD_YM = /^\d{4}-\d{2}$/;

function getDefaultPeriod(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function amount(v: number | string | null | undefined): string {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function statusTag(status: string) {
  return <Tag color="blue">{status || "generated"}</Tag>;
}

function deltaBalanced(d: string): boolean {
  const n = Number(d);
  return Number.isFinite(n) && Math.abs(n) < 1e-6;
}

export default function SettlementStatementsPage() {
  const router = useRouter();
  const [bridgePeriod, setBridgePeriod] = useState(getDefaultPeriod);
  const [bridgeKeyword, setBridgeKeyword] = useState("");
  const [reco, setReco] = useState<PeriodReconciliationResp | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  const [stmtPeriod, setStmtPeriod] = useState("");
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<StatementDetail | null>(null);

  const canOperate = hasRole(["admin", "finance_manager"]);
  const channelOptions = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);

  const filteredChannels = useMemo(() => {
    const k = bridgeKeyword.trim().toLowerCase();
    if (!reco?.channels) return [];
    if (!k) return reco.channels;
    return reco.channels.filter((c) => c.channel.toLowerCase().includes(k));
  }, [reco, bridgeKeyword]);

  const loadChannels = async () => {
    try {
      const data = await apiRequest<ChannelOption[]>("/channels");
      setChannels(data || []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadReconciliation = useCallback(async () => {
    const p = bridgePeriod.trim();
    if (!PERIOD_YM.test(p)) {
      message.warning("账期格式应为 YYYY-MM");
      return;
    }
    setRecoLoading(true);
    setRecoError(null);
    try {
      const data = await apiRequest<PeriodReconciliationResp>(
        `/settlement-statements/period-reconciliation?period=${encodeURIComponent(p)}`,
      );
      setReco(data);
    } catch (e) {
      setReco(null);
      setRecoError((e as Error).message);
    } finally {
      setRecoLoading(false);
    }
  }, [bridgePeriod]);

  const loadList = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (stmtPeriod) p.set("period", stmtPeriod);
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
    void loadChannels();
    void loadList();
  }, []);

  useEffect(() => {
    if (PERIOD_YM.test(bridgePeriod.trim())) {
      void loadReconciliation();
    }
  }, [bridgePeriod, loadReconciliation]);

  const exportBridge = () => {
    if (!reco) {
      message.warning("请先加载账期核对数据");
      return;
    }
    const s = reco.summary;
    const sumRows: Record<string, unknown>[] = [
      { 项目: "账期", 值: reco.period },
      { 项目: "核对任务ID", 值: reco.recon_task_id },
      { 项目: "导入原始流水总额", 值: s.total_import_gross },
      { 项目: "渠道账单拆分合计", 值: s.channel_split_total },
      { 项目: "研发账单拆分合计", 值: s.rd_split_total },
      { 项目: "发行或保留金额合计", 值: s.publisher_retention_total },
      { 项目: "差额校验", 值: s.balance_delta },
      { 项目: "原始行数", 值: s.raw_row_count },
      { 项目: "已映射行数", 值: s.mapped_row_count },
      { 项目: "未映射行数", 值: s.unmapped_row_count },
      { 项目: "未映射流水金额", 值: s.unmapped_gross },
      { 项目: "有效账单·渠道合计", 值: s.active_bills_channel_total },
      { 项目: "有效账单·研发合计", 值: s.active_bills_rd_total },
      { 项目: "账单与拆分是否一致", 值: s.bills_match_raw_split ? "是" : "否" },
      { 项目: "说明", 值: reco.intro_note },
    ];
    const detailRows = filteredChannels.map((r) => ({
      账期: reco.period,
      渠道: r.channel,
      导入原始流水总额: r.import_gross_total,
      渠道账单应结金额合计: r.channel_split_total,
      研发账单应结金额合计: r.rd_split_total,
      发行或保留金额: r.retention_total,
      差额: r.balance_delta,
      是否平衡: r.is_balanced ? "是" : "否",
      有效账单渠道对象合计: r.active_bills_channel_total,
      与拆分一致: r.bills_match_channel_split ? "是" : "否",
    }));
    exportMultiSheetXlsx(
      [
        { sheetName: "账期总览", rows: sumRows },
        { sheetName: "按渠道明细", rows: detailRows },
      ],
      buildExportFilename("渠道结算核对桥接", "xlsx"),
    );
    message.success("已导出");
  };

  const generateOne = async (overwrite = false) => {
    if (!canOperate) return;
    if (!stmtPeriod) {
      message.error("请先输入账期，例如 2026-04");
      return;
    }
    if (!channelId) {
      message.error("请先选择渠道");
      return;
    }
    try {
      await apiRequest("/settlement-statements/generate", "POST", { period: stmtPeriod, channel_id: channelId, overwrite });
      message.success(overwrite ? "已覆盖重生成" : "生成成功");
      loadList();
    } catch (e) {
      const err = (e as Error).message || "";
      if (!overwrite && err.includes("已存在")) {
        message.warning("该账期渠道对账单已存在，请点击“覆盖重生成”");
      } else {
        message.error(err || "生成失败");
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

  const s = reco?.summary;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message='渠道结算对账单管理 / 核对桥接'
        description={
          <div>
            <p style={{ marginBottom: 8 }}>
              <strong>本页用于核对「导入原始流水 gross」与「账单拆分结果」</strong>（渠道应结、研发应结、发行/保留），数据与账单管理页的生成逻辑一致，且仅基于该账期<strong>唯一有效已确认</strong>导入批次。
            </p>
            <Typography.Text type="secondary">
              导入批次与原始流水请看「导入数据中心」；账单状态、发送与回款请看「账单管理」——账期级流水核对请在本页完成。
            </Typography.Text>
          </div>
        }
      />

      <Card
        title="账期核对桥接（按渠道）"
        extra={
          <Space wrap>
            <Input placeholder="账期 YYYY-MM" value={bridgePeriod} onChange={(e) => setBridgePeriod(e.target.value)} style={{ width: 120 }} />
            <Input placeholder="按渠道名称筛选" value={bridgeKeyword} onChange={(e) => setBridgeKeyword(e.target.value)} style={{ width: 160 }} />
            <Button type="primary" loading={recoLoading} onClick={() => void loadReconciliation()}>
              刷新核对
            </Button>
            <Button disabled={!reco} onClick={exportBridge}>
              导出核对 Excel
            </Button>
            <Button onClick={() => router.push(`/billing?period=${encodeURIComponent(bridgePeriod.trim())}`)}>打开账单管理</Button>
          </Space>
        }
      >
        {recoError ? (
          <Alert type="warning" showIcon message="无法加载核对数据" description={recoError} />
        ) : !reco ? (
          <Empty description={recoLoading ? "加载中…" : "请输入合法账期"} />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Text type="secondary">{reco.intro_note}</Typography.Text>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} title="账期总桥接汇总">
              <Descriptions.Item label="核对任务 ID">{reco.recon_task_id}</Descriptions.Item>
              <Descriptions.Item label="原始行数 / 未映射行">{s?.raw_row_count} / {s?.unmapped_row_count}</Descriptions.Item>
              <Descriptions.Item label="未映射流水金额">{amount(s?.unmapped_gross)}</Descriptions.Item>
              <Descriptions.Item label="导入原始流水总额">{amount(s?.total_import_gross)}</Descriptions.Item>
              <Descriptions.Item label="渠道账单拆分合计">{amount(s?.channel_split_total)}</Descriptions.Item>
              <Descriptions.Item label="研发账单拆分合计">{amount(s?.rd_split_total)}</Descriptions.Item>
              <Descriptions.Item label="发行/保留合计">{amount(s?.publisher_retention_total)}</Descriptions.Item>
              <Descriptions.Item label="差额校验">{amount(s?.balance_delta)}</Descriptions.Item>
              <Descriptions.Item label="有效账单·渠道/研发">{amount(s?.active_bills_channel_total)} / {amount(s?.active_bills_rd_total)}</Descriptions.Item>
            </Descriptions>
            {s && deltaBalanced(s.balance_delta) ? (
              <Alert type="success" showIcon message="当前账期拆分平衡（原始流水 = 渠道拆分 + 研发拆分 + 保留）" />
            ) : s ? (
              <Alert type="error" showIcon message="当前账期恒等式未平衡，请检查映射与分成" description={`差额：${s.balance_delta}`} />
            ) : null}
            {s && !s.bills_match_raw_split ? (
              <Alert
                type="error"
                showIcon
                message="有效账单合计与当前拆分不一致"
                description="请在账单管理中使用「覆盖重生成」使账单与已确认数据一致。"
              />
            ) : null}
            <Table<ChannelBridgeRow>
              rowKey={(r) => `${reco.period}-${r.channel}`}
              loading={recoLoading}
              size="small"
              dataSource={filteredChannels}
              pagination={{ pageSize: 20 }}
              locale={{ emptyText: <Empty description="无渠道行或无匹配筛选" /> }}
              columns={[
                { title: "账期", width: 100, render: () => reco.period },
                { title: "渠道（账单对象）", dataIndex: "channel", ellipsis: true, width: 220 },
                { title: "原始流水总额", dataIndex: "import_gross_total", render: (v: string) => amount(v) },
                { title: "渠道应结合计", dataIndex: "channel_split_total", render: (v: string) => amount(v) },
                { title: "研发应结合计", dataIndex: "rd_split_total", render: (v: string) => amount(v) },
                { title: "保留/发行", dataIndex: "retention_total", render: (v: string) => amount(v) },
                { title: "差额", dataIndex: "balance_delta", render: (v: string) => amount(v) },
                {
                  title: "是否平衡",
                  dataIndex: "is_balanced",
                  width: 100,
                  render: (v: boolean) => (v ? <Tag color="success">是</Tag> : <Tag color="error">否</Tag>),
                },
                { title: "有效账单·渠道对象", dataIndex: "active_bills_channel_total", render: (v: string) => amount(v) },
                {
                  title: "与拆分一致",
                  dataIndex: "bills_match_channel_split",
                  render: (v: boolean) => (v ? <Tag color="blue">是</Tag> : <Tag color="orange">否</Tag>),
                },
              ]}
              scroll={{ x: 1280 }}
            />
          </Space>
        )}
      </Card>

      <Card
        title="渠道对账单文档（按渠道生成 Excel）"
        extra={
          <Space wrap>
            <Input placeholder="账期 YYYY-MM" value={stmtPeriod} onChange={(e) => setStmtPeriod(e.target.value)} style={{ width: 140 }} />
            <Select allowClear placeholder="选择渠道" style={{ width: 220 }} value={channelId} onChange={(v) => setChannelId(v)} options={channelOptions} />
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

      <Drawer title="对账单详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={980} destroyOnClose>
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
    </Space>
  );
}
