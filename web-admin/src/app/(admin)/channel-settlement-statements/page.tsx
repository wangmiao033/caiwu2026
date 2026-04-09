"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
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
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

type ChannelOption = { id: number; name: string };

type ReconciliationStatus = "pending" | "confirmed" | "exported";

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
  reconciliation_status: ReconciliationStatus;
  updated_at: string;
  created_at: string;
};

type SummaryResp = {
  period: string;
  eligible_channel_count: number;
  generated_statement_count: number;
  pending_reconciliation_count: number;
  reconciled_channel_count: number;
  exported_channel_count: number;
  total_settlement_amount: number | string;
  warning?: string | null;
};

type StatementListResp = {
  items: StatementRow[];
  total: number;
};

type StatementDetailItem = {
  id: number;
  game_id: number;
  game_name_snapshot: string;
  gross_amount: number;
  discount_amount: number;
  test_fee_amount?: number;
  coupon_amount?: number;
  settlement_base_amount: number;
  share_ratio?: number;
  channel_fee_rate: number;
  channel_fee_amount: number;
  settlement_amount: number;
  sort_order: number;
};

type StatementDetail = StatementRow & {
  note: string;
  created_by: string;
  party_platform_name?: string;
  party_channel_name?: string;
  reconciliation_status?: ReconciliationStatus;
  items: StatementDetailItem[];
};

type GenerateAllResp = {
  period: string;
  generated: Array<{ id: number; channel_id: number; channel_name: string }>;
  errors: Array<{ channel_id: number; detail: string }>;
};

function normalizePeriodYm(raw: string): string | null {
  const t = raw.trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const monthNum = parseInt(m[2], 10);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${m[1]}-${String(monthNum).padStart(2, "0")}`;
}

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

function ratioPct(v: number | string | null | undefined): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0.00%";
  return `${(n * 100).toFixed(2)}%`;
}

function statusTag(status: string) {
  return <Tag color="blue">{status || "generated"}</Tag>;
}

function reconTag(status: ReconciliationStatus | string | undefined) {
  const s = (status || "pending") as ReconciliationStatus;
  const map: Record<ReconciliationStatus, { label: string; color: string }> = {
    pending: { label: "待对账", color: "orange" },
    confirmed: { label: "已确认", color: "green" },
    exported: { label: "已导出", color: "blue" },
  };
  const x = map[s] || map.pending;
  return <Tag color={x.color}>{x.label}</Tag>;
}

async function downloadStatementExport(id: number, filename: string) {
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
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChannelSettlementStatementsPage() {
  const defaultPeriod = useMemo(() => getDefaultPeriod(), []);
  const [stmtPeriod, setStmtPeriod] = useState(defaultPeriod);
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [listKeyword, setListKeyword] = useState("");
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exportAllLoading, setExportAllLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const listKeywordRef = useRef(listKeyword);
  listKeywordRef.current = listKeyword;

  const canOperate = hasRole(["admin", "finance_manager"]);
  const canExport = hasRole(["admin", "finance_manager"]);

  const channelOptions = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);

  const loadChannels = async () => {
    try {
      const data = await apiRequest<ChannelOption[]>("/channels");
      setChannels(data || []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (stmtPeriod.trim()) {
        const sp = normalizePeriodYm(stmtPeriod.trim());
        p.set("period", sp ?? stmtPeriod.trim());
      }
      if (channelId) p.set("channel_id", String(channelId));
      const kw = listKeywordRef.current.trim();
      if (kw) p.set("keyword", kw);
      p.set("status", "generated");
      const data = await apiRequest<StatementListResp>(`/settlement-statements?${p.toString()}`);
      const items = (data.items || []).map((row) => ({
        ...row,
        reconciliation_status: (row as StatementRow).reconciliation_status || "pending",
      })) as StatementRow[];
      setRows(items);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stmtPeriod, channelId]);

  const loadSummary = useCallback(async () => {
    const periodNorm = normalizePeriodYm(stmtPeriod.trim());
    if (!periodNorm) {
      setSummary(null);
      return;
    }
    setSummaryLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("period", periodNorm);
      if (channelId) q.set("channel_id", String(channelId));
      const kw = listKeywordRef.current.trim();
      if (kw) q.set("keyword", kw);
      const data = await apiRequest<SummaryResp>(`/settlement-statements/summary?${q.toString()}`);
      setSummary(data);
    } catch (e) {
      setSummary(null);
      message.warning((e as Error).message || "汇总加载失败");
    } finally {
      setSummaryLoading(false);
    }
  }, [stmtPeriod, channelId]);

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    void loadList();
    void loadSummary();
  }, [loadList, loadSummary]);

  const refreshData = useCallback(async () => {
    await loadList();
    await loadSummary();
  }, [loadList, loadSummary]);

  const updateReconciliationStatus = async (statementId: number, value: ReconciliationStatus) => {
    try {
      await apiRequest(`/settlement-statements/${statementId}/reconciliation-status`, "PATCH", {
        reconciliation_status: value,
      });
      message.success("对账状态已更新");
      await refreshData();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const canonicalPeriod = (): string | null => {
    const sn = normalizePeriodYm(stmtPeriod.trim());
    if (!sn) {
      message.warning("账期格式应为 YYYY-MM（月份可写 1–12，将自动补为两位数）");
      return null;
    }
    if (sn !== stmtPeriod.trim()) setStmtPeriod(sn);
    return sn;
  };

  const generateBatch = async (overwrite: boolean) => {
    if (!canOperate) return;
    const period = canonicalPeriod();
    if (!period) return;
    setBatchLoading(true);
    try {
      const data = await apiRequest<GenerateAllResp>("/settlement-statements/generate-all-for-period", "POST", {
        period,
        overwrite,
      });
      const nOk = data.generated?.length ?? 0;
      const errs = data.errors ?? [];
      if (nOk) message.success(overwrite ? `已覆盖重生成 ${nOk} 份月结单` : `已生成 ${nOk} 份月结单`);
      if (errs.length) {
        Modal.warning({
          title: overwrite ? "部分渠道未处理" : "部分渠道需覆盖或存在错误",
          width: 560,
          content: (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {errs.map((e) => (
                <div key={e.channel_id} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>渠道 ID {e.channel_id}</Typography.Text>：{String(e.detail)}
                </div>
              ))}
            </div>
          ),
        });
      }
      if (!nOk && !errs.length) message.info("当前账期没有可生成的渠道月结单");
      await refreshData();
    } catch (e) {
      message.error((e as Error).message || "生成失败");
    } finally {
      setBatchLoading(false);
    }
  };

  const confirmOverwrite = () => {
    Modal.confirm({
      title: "确认覆盖重生成？",
      content: "将按当前已确认导入批次与映射规则，覆盖该账期下已有渠道月结单明细。",
      okText: "覆盖重生成",
      cancelText: "取消",
      onOk: () => generateBatch(true),
    });
  };

  const exportAllInList = async () => {
    if (!canExport) return;
    if (!rows.length) {
      message.warning("当前列表为空，请先查询");
      return;
    }
    setExportAllLoading(true);
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const fn = `settlement_${r.period}_${r.channel_name || r.channel_id}.xlsx`;
        /* eslint-disable no-await-in-loop -- 顺序下载避免浏览器拦截多文件 */
        await downloadStatementExport(r.id, fn);
        await new Promise((res) => setTimeout(res, 400));
      }
      message.success(`已依次下载 ${rows.length} 个 Excel`);
      await refreshData();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setExportAllLoading(false);
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

  const exportOne = async (id: number, row: StatementRow) => {
    try {
      const fn = `settlement_statement_${row.period}_${row.channel_name || row.channel_id}.xlsx`;
      await downloadStatementExport(id, fn);
      message.success("导出成功");
      await refreshData();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const detailTotals = useMemo(() => {
    if (!detail?.items?.length) return null;
    const items = detail.items;
    return {
      gross: items.reduce((s, r) => s + Number(r.gross_amount || 0), 0),
      test: items.reduce((s, r) => s + Number(r.test_fee_amount ?? 0), 0),
      coupon: items.reduce((s, r) => s + Number(r.coupon_amount ?? 0), 0),
      shareBase: items.reduce((s, r) => s + Number(r.settlement_base_amount || 0), 0),
      fee: items.reduce((s, r) => s + Number(r.channel_fee_amount || 0), 0),
      settlement: items.reduce((s, r) => s + Number(r.settlement_amount || 0), 0),
    };
  }, [detail]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="渠道结算对账单（导入数据中心/对账链路）"
        description={
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            本页沿用原有「渠道月结单」能力：数据来自导入数据中心已确认批次与映射规则。若需「Excel 导入 →
            月度对账单」独立流程，请使用左侧菜单「渠道月度结算对账单」下的新模块。
          </Typography.Paragraph>
        }
      />

      {summary?.warning ? (
        <Alert type="warning" showIcon message="导入批次异常" description={summary.warning} style={{ marginBottom: 0 }} />
      ) : null}

      <Card size="small" title="月结单汇总（随账期与筛选条件更新）" loading={summaryLoading}>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic title="本月渠道总数" value={summary?.eligible_channel_count ?? 0} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic title="已生成月结单数" value={(summary?.generated_statement_count as number | undefined) ?? 0} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic title="已对完账渠道数" value={(summary?.reconciled_channel_count as number | undefined) ?? 0} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic title="待对账渠道数" value={(summary?.pending_reconciliation_count as number | undefined) ?? 0} valueStyle={{ color: "#d46b08" }} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic title="已导出渠道数" value={(summary?.exported_channel_count as number | undefined) ?? 0} />
          </Col>
          <Col xs={24} sm={12} md={8} lg={8} xl={4}>
            <Statistic
              title="总结算金额"
              value={Number(summary?.total_settlement_amount ?? 0)}
              precision={2}
              suffix="元"
              groupSeparator=","
            />
          </Col>
        </Row>
      </Card>

      <Card
        title="月结单列表"
        extra={
          <Space wrap align="center">
            <Input
              placeholder="账期 YYYY-MM"
              value={stmtPeriod}
              onChange={(e) => setStmtPeriod(e.target.value)}
              onBlur={() => {
                const n = normalizePeriodYm(stmtPeriod.trim());
                if (n) setStmtPeriod(n);
              }}
              style={{ width: 130 }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="渠道筛选"
              style={{ width: 220 }}
              value={channelId}
              onChange={(v) => setChannelId(v)}
              options={channelOptions}
              notFoundContent={channelOptions.length ? undefined : "加载中…"}
            />
            <Input
              placeholder="渠道名称搜索（列表）"
              value={listKeyword}
              onChange={(e) => setListKeyword(e.target.value)}
              style={{ width: 180 }}
              onPressEnter={() => loadList()}
            />
            <Button
              onClick={() => {
                void refreshData();
              }}
              loading={loading || summaryLoading}
            >
              查询
            </Button>
            {canOperate && (
              <>
                <Button type="primary" loading={batchLoading} onClick={() => generateBatch(false)}>
                  生成月结单
                </Button>
                <Button loading={batchLoading} onClick={confirmOverwrite}>
                  覆盖重生成
                </Button>
              </>
            )}
            {canExport && (
              <Button loading={exportAllLoading} onClick={exportAllInList} disabled={!rows.length}>
                导出 Excel（当前列表）
              </Button>
            )}
          </Space>
        }
      >
        <Table<StatementRow>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: <Empty description="无月结单，请确认账期与导入批次后生成" /> }}
          columns={[
            { title: "账期", dataIndex: "period", width: 100 },
            { title: "渠道", dataIndex: "channel_name", width: 200, ellipsis: true },
            { title: "原始流水合计", render: (_, r) => amount(r.total_gross_amount) },
            { title: "结算金额合计", render: (_, r) => amount(r.total_settlement_amount) },
            { title: "状态", width: 100, render: (_, r) => statusTag(r.status) },
            {
              title: "对账状态",
              width: 140,
              render: (_, r) =>
                canOperate ? (
                  <Select<ReconciliationStatus>
                    size="small"
                    style={{ width: 120 }}
                    value={(r.reconciliation_status as ReconciliationStatus) || "pending"}
                    options={[
                      { value: "pending", label: "待对账" },
                      { value: "confirmed", label: "已确认" },
                      { value: "exported", label: "已导出" },
                    ]}
                    onChange={(v) => void updateReconciliationStatus(r.id, v)}
                  />
                ) : (
                  reconTag(r.reconciliation_status)
                ),
            },
            {
              title: "操作",
              fixed: "right",
              width: 220,
              render: (_, r) => (
                <Space>
                  <Button size="small" type="link" onClick={() => openDetail(r.id)}>
                    查看详情
                  </Button>
                  {canExport && (
                    <Button size="small" type="link" onClick={() => exportOne(r.id, r)}>
                      导出
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
          scroll={{ x: 960 }}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Drawer title="渠道月结单详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={1020} destroyOnClose>
        {!detail ? null : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="账期">{detail.period}</Descriptions.Item>
              <Descriptions.Item label="渠道">{detail.channel_name}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="对账状态">{reconTag(detail.reconciliation_status)}</Descriptions.Item>
              <Descriptions.Item label="创建人">{detail.created_by || "-"}</Descriptions.Item>
              <Descriptions.Item label="原始流水合计">{amount(detail.total_gross_amount)}</Descriptions.Item>
              <Descriptions.Item label="结算金额合计">{amount(detail.total_settlement_amount)}</Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              游戏明细
            </Typography.Title>
            <Table<StatementDetailItem>
              rowKey="id"
              dataSource={detail.items || []}
              pagination={false}
              size="small"
              columns={[
                { title: "结算月份", width: 100, render: () => detail.period },
                { title: "游戏名称", dataIndex: "game_name_snapshot", width: 200, ellipsis: true },
                { title: "合作总收入", render: (_, r) => amount(r.gross_amount) },
                { title: "测试费", render: (_, r) => amount(r.test_fee_amount ?? 0) },
                { title: "代金券", render: (_, r) => amount(r.coupon_amount ?? 0) },
                { title: "参与分成金额", render: (_, r) => amount(r.settlement_base_amount) },
                { title: "分成比例", render: (_, r) => ratioPct(r.share_ratio ?? r.channel_fee_rate) },
                { title: "通道费", render: (_, r) => amount(r.channel_fee_amount) },
                { title: "结算金额", render: (_, r) => amount(r.settlement_amount) },
              ]}
              scroll={{ x: 1000 }}
              summary={() =>
                detailTotals ? (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}>
                        <Typography.Text strong>合计</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2}>
                        <Typography.Text strong>{amount(detailTotals.gross)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3}>
                        <Typography.Text strong>{amount(detailTotals.test)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4}>
                        <Typography.Text strong>{amount(detailTotals.coupon)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5}>
                        <Typography.Text strong>{amount(detailTotals.shareBase)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} />
                      <Table.Summary.Cell index={7}>
                        <Typography.Text strong>{amount(detailTotals.fee)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={8}>
                        <Typography.Text strong>{amount(detailTotals.settlement)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                ) : null
              }
            />

            <Descriptions bordered size="small" column={1} title="双方信息">
              <Descriptions.Item label="甲方（平台）">{detail.party_platform_name || "广州熊动科技有限公司"}</Descriptions.Item>
              <Descriptions.Item label="乙方（渠道）">{detail.party_channel_name || detail.channel_name || "-"}</Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Text strong>备注</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>{detail.note?.trim() || "—"}</Typography.Paragraph>
            </div>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
