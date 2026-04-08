"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Descriptions, Drawer, Empty, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, message } from "antd";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";
import { BillingRule, calcTrialResult, matchRuleForBill } from "@/lib/billingTrial";
import { buildExportFilename, exportRowsToCsv, exportRowsToXlsx } from "@/lib/export";

type BillRow = {
  id: number;
  bill_type: "channel" | "rd";
  period: string;
  target_name: string;
  amount: number;
  status: string;
  version: number;
  collection_status: string;
  lifecycle_status?: "active" | "discarded";
  invoice_status?: string;
  receipt_status?: string;
  received_total?: number;
  outstanding_amount?: number;
  latest_receipt_date?: string;
  flow_status?: string;
  gross_amount?: number;
  channel_fee?: number;
  tax_rate?: number;
  rd_share?: number;
  settlement_amount?: number;
  profit?: number;
};

type CleanupDuplicatesResp = {
  dry_run?: boolean;
  deleted_count?: number;
  skipped_count?: number;
  duplicate_group_count?: number;
  kept_group_count?: number;
};

type BillDetail = BillRow & {
  invoiced_total?: number;
  invoice_info?: {
    has_invoice: boolean;
    invoice_no: string;
    invoice_amount: number;
    issue_date: string;
  };
  receipt_info?: {
    received_total: number;
    outstanding_amount: number;
    latest_receipt_date: string;
    receipt_status: string;
  };
};

const BILLING_LAST_PERIOD_KEY = "billing_last_period";
const PERIOD_YM_RE = /^\d{4}-\d{2}$/;

function getCurrentPeriod(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getRecentPeriodOptions(count = 6): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const d = new Date();
  for (let i = 0; i < count; i += 1) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const value = `${y}-${m}`;
    out.push({ label: value, value });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function parseBool(raw: string | null, defaultValue: boolean): boolean {
  if (raw === null) return defaultValue;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return defaultValue;
}

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [list, setList] = useState<BillRow[]>([]);
  const [filterType, setFilterType] = useState<string>(searchParams.get("type") || "");
  const [filterText, setFilterText] = useState(searchParams.get("keyword") || "");
  const [billLifecycle, setBillLifecycle] = useState<"active" | "discarded" | "all">(() => {
    const v = (searchParams.get("lifecycle_status") || "active").trim();
    return (v === "discarded" || v === "all" || v === "active" ? v : "active") as "active" | "discarded" | "all";
  });
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [discardingId, setDiscardingId] = useState<number | null>(null);
  const [bulkDiscarding, setBulkDiscarding] = useState(false);
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [showTrial, setShowTrial] = useState(parseBool(searchParams.get("show_trial"), false));
  const [reconMode, setReconMode] = useState(parseBool(searchParams.get("recon_mode"), true));
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size") || 100));
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get("page") || 1));
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [rules, setRules] = useState<BillingRule[]>([]);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const billingBootstrappedRef = useRef(false);
  const lastUrlPeriodRef = useRef<string | null>(null);
  const recentPeriodOptions = useMemo(() => getRecentPeriodOptions(6), []);

  useEffect(() => {
    const cache = localStorage.getItem("billing_rules_local");
    if (!cache) return;
    try {
      setRules(JSON.parse(cache));
    } catch {}
  }, []);
  const generate = async () => {
    Modal.confirm({
      title: "确认生成账单",
      content: `将按账期 ${period} 生成账单。该操作会产生新账单记录，请确认账期与规则配置无误。`,
      onOk: async () => {
        try {
          const data = await apiRequest<Record<string, unknown>>(`/billing/generate?period=${encodeURIComponent(period)}&force_new_version=false`, "POST");
          message.success(`生成完成: ${JSON.stringify(data)}`);
          await loadBills();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const loadBills = async (opts?: { period?: string; billIdToOpen?: number | null }) => {
    try {
      const nextPeriod = (opts?.period ?? period ?? "").trim();
      const q = new URLSearchParams();
      if (nextPeriod) q.set("period", nextPeriod);
      if (filterType) q.set("bill_type", filterType);
      if (billLifecycle) q.set("lifecycle_status", billLifecycle);
      const query = `/billing/bills${q.toString() ? `?${q.toString()}` : ""}`;
      const data = await apiRequest<BillRow[]>(query);
      setList(data);
      if (opts?.billIdToOpen) {
        await openDetail(opts.billIdToOpen);
      }
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const canDiscardBill = (b: BillRow) => {
    if (b.lifecycle_status === "discarded") return false;
    const isDraft = b.status === "待发送" || b.flow_status === "草稿";
    const noInvoice = (b.invoice_status || "待开票") !== "已开票";
    const noReceipt = (b.receipt_status || "待回款") === "待回款" && Number(b.received_total || 0) <= 0;
    const outstandingOk =
      b.outstanding_amount === undefined || b.amount === undefined ? true : Number(b.outstanding_amount || 0) >= Number(b.amount || 0);
    return isDraft && noInvoice && noReceipt && outstandingOk;
  };

  const discardBill = (b: BillRow) => {
    Modal.confirm({
      title: "作废账单",
      content: "该账单将标记为作废，不再参与默认列表和后续流程，是否继续？",
      okType: "danger",
      onOk: async () => {
        setDiscardingId(b.id);
        try {
          await apiRequest(`/billing/${b.id}/discard`, "POST");
          message.success("账单已作废");
          await loadBills();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setDiscardingId(null);
        }
      },
    });
  };

  const applyPeriod = async (nextRaw: string) => {
    const next = nextRaw.trim();
    if (!PERIOD_YM_RE.test(next)) {
      message.warning("账期格式应为 YYYY-MM");
      return;
    }
    setPeriod(next);
    try {
      localStorage.setItem(BILLING_LAST_PERIOD_KEY, next);
    } catch {
      /* ignore */
    }
    await loadBills({ period: next });
  };

  const sendBill = async (id: number, status: string) => {
    Modal.confirm({
      title: "确认发送账单",
      content: `将账单 ${id} 更新为 ${status}。该操作会进入对外流转，请确认后执行。`,
      onOk: async () => {
        setSendingId(id);
        try {
          await apiRequest(`/billing/${id}/send`, "POST", { status, note: "前端发送" });
          message.success("状态更新成功");
          await loadBills();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setSendingId(null);
        }
      },
    });
  };
  const openDetail = async (id: number) => {
    try {
      const data = await apiRequest<BillDetail>(`/billing/${id}`);
      setDetail(data);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openDetailInNewTab = (id: number) => {
    window.open(`/billing?bill_id=${id}&period=${encodeURIComponent(period)}`, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [period, filterText, filterType, billLifecycle, currentPage, pageSize, reconMode, showTrial]);

  const filtered = useMemo(
    () => list.filter((x) => `${x.id}${x.target_name}${x.period}`.toLowerCase().includes(filterText.toLowerCase())),
    [list, filterText]
  );

  const rowsWithTrial = useMemo(
    () =>
      [...filtered]
        .map((bill) => {
          const baseGross = Number(bill.gross_amount ?? bill.amount ?? 0);
          const rule = matchRuleForBill(rules, bill.bill_type, bill.target_name);
          const trial = calcTrialResult(baseGross, rule);
          return { ...bill, trial };
        })
        .sort((a, b) => Number(b.outstanding_amount ?? 0) - Number(a.outstanding_amount ?? 0)),
    [filtered, rules]
  );

  const detailTrial = useMemo(() => {
    if (!detail) return null;
    const baseGross = Number(detail.gross_amount ?? detail.amount ?? 0);
    const rule = matchRuleForBill(rules, detail.bill_type, detail.target_name);
    return calcTrialResult(baseGross, rule);
  }, [detail, rules]);
  const exportBills = () => {
    message.loading({ content: "正在导出数据...", key: "bill_export" });
    const data = rowsWithTrial.map((x) => ({
      账单ID: x.id,
      账单类型: x.bill_type,
      目标对象: x.target_name,
      账期: x.period,
      状态: x.flow_status || x.status,
      流水: x.gross_amount ?? x.amount,
      规则状态: x.trial?.matched ? "已匹配规则" : "未配置规则",
      折扣后流水: x.trial?.discountedGross ?? "",
      通道费金额: x.trial?.channelFeeAmount ?? "",
      税额: x.trial?.taxAmount ?? "",
      研发分成金额: x.trial?.rdShareAmount ?? "",
      试算结算金额: x.trial?.settlementAmount ?? "",
      试算利润: x.trial?.profit ?? "",
      发送状态: x.status,
      创建时间: "",
      说明: "试算结果仅供前端预览核对，正式结算以后端结果为准",
    }));
    if (exportFormat === "csv") {
      exportRowsToCsv(data, buildExportFilename("billing", "csv"));
    } else {
      exportRowsToXlsx(data, buildExportFilename("billing", "xlsx"));
    }
    message.success({ content: "导出成功", key: "bill_export" });
  };

  const selectedRows = useMemo(
    () => rowsWithTrial.filter((x) => selectedRowKeys.includes(String(x.id))),
    [rowsWithTrial, selectedRowKeys]
  );

  const bulkDiscardBills = () => {
    const targets = selectedRows.filter((b) => canDiscardBill(b));
    if (!targets.length) {
      message.warning("所选账单均不满足作废条件（仅支持测试草稿账单）");
      return;
    }
    Modal.confirm({
      title: "批量作废账单",
      content: "将把所选账单标记为作废，不再参与默认列表和后续流程，是否继续？",
      okType: "danger",
      onOk: async () => {
        setBulkDiscarding(true);
        const okIds: number[] = [];
        const failed: Array<{ id: number; reason: string }> = [];
        for (const b of targets) {
          try {
            // 串行调用，优先稳定
            await apiRequest(`/billing/${b.id}/discard`, "POST");
            okIds.push(b.id);
          } catch (e) {
            const reason = (e as Error).message || "unknown";
            failed.push({ id: b.id, reason });
          }
        }
        if (failed.length === 0) {
          message.success(`已作废 ${okIds.length} 条`);
        } else {
          const preview = failed
            .slice(0, 5)
            .map((x) => `#${x.id}:${x.reason}`)
            .join("；");
          message.warning(`成功 ${okIds.length} 条，失败 ${failed.length} 条${preview ? `（${preview}${failed.length > 5 ? "…" : ""}）` : ""}`);
        }
        setSelectedRowKeys([]);
        await loadBills();
        setBulkDiscarding(false);
      },
    });
  };

  const gotoBatchReceipt = () => {
    if (!selectedRows.length) {
      message.warning("请先勾选账单");
      return;
    }
    const ids = selectedRows.map((x) => x.id).join(",");
    router.push(`/receipts?keyword=${ids}`);
    message.info("请在回款页面逐条登记回款，登记后账单会自动变为已回款/部分回款");
  };

  const cleanupDuplicateDraftBills = () => {
    Modal.confirm({
      title: "清理重复草稿账单",
      content: "将删除重复的草稿账单，且仅删除未回款、未开票、无依赖的重复项，是否继续？",
      okText: "确认清理",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const data = await apiRequest<CleanupDuplicatesResp>("/billing/cleanup-duplicates", "POST", { dry_run: false });
          const deleted = data.deleted_count ?? 0;
          const skipped = data.skipped_count ?? 0;
          message.success(`清理完成：已删除 ${deleted} 条，跳过 ${skipped} 条`);
          await loadBills();
        } catch (e) {
          message.error((e as Error).message || "清理失败");
          throw e;
        }
      },
    });
  };

  useEffect(() => {
    const q = searchParams.get("period")?.trim() ?? "";
    const validQ = PERIOD_YM_RE.test(q);
    const billId = Number(searchParams.get("bill_id") || 0);

    if (!billingBootstrappedRef.current) {
      let p = getCurrentPeriod();
      if (validQ) {
        p = q;
        lastUrlPeriodRef.current = q;
      } else {
        lastUrlPeriodRef.current = null;
        try {
          const s = localStorage.getItem(BILLING_LAST_PERIOD_KEY)?.trim() ?? "";
          if (PERIOD_YM_RE.test(s)) p = s;
        } catch {
          /* ignore */
        }
      }
      setPeriod(p);
      void loadBills({ period: p, billIdToOpen: billId > 0 ? billId : null });
      billingBootstrappedRef.current = true;
      return;
    }

    if (validQ && lastUrlPeriodRef.current !== q) {
      lastUrlPeriodRef.current = q;
      setPeriod(q);
      void loadBills({ period: q, billIdToOpen: billId > 0 ? billId : null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams 变化时按 URL 账期同步；loadBills 依赖当前 filterType
  }, [searchParams]);

  useEffect(() => {
    if (!billingBootstrappedRef.current) return;
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (filterText) params.set("keyword", filterText);
    if (filterType) params.set("type", filterType);
    if (billLifecycle && billLifecycle !== "active") params.set("lifecycle_status", billLifecycle);
    if (!reconMode) params.set("recon_mode", "0");
    if (showTrial) params.set("show_trial", "1");
    if (pageSize !== 100) params.set("page_size", String(pageSize));
    if (currentPage !== 1) params.set("page", String(currentPage));
    if (detail?.id) params.set("bill_id", String(detail.id));
    router.replace(`/billing${params.toString() ? `?${params.toString()}` : ""}`);
    if (PERIOD_YM_RE.test(period)) {
      try {
        localStorage.setItem(BILLING_LAST_PERIOD_KEY, period);
      } catch {
        /* ignore */
      }
    }
  }, [period, filterText, filterType, billLifecycle, reconMode, showTrial, pageSize, currentPage, detail?.id, router]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="账单生成">
        <Space wrap>
          <Input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            onBlur={() => {
              const t = period.trim();
              if (PERIOD_YM_RE.test(t)) void applyPeriod(t);
            }}
            placeholder="账期 YYYY-MM"
            style={{ width: 130 }}
          />
          <Select
            placeholder="最近账期"
            allowClear
            style={{ width: 150 }}
            options={recentPeriodOptions}
            value={recentPeriodOptions.some((o) => o.value === period) ? period : undefined}
            onChange={(v) => {
              if (v) void applyPeriod(v);
            }}
          />
          <Button type="primary" onClick={generate}>
            生成账单
          </Button>
        </Space>
      </Card>
      <Card
        title="账单列表"
        extra={
          <Space>
            <Input placeholder="搜索" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
            <Select
              placeholder="类型"
              allowClear
              style={{ width: 140 }}
              options={[
                { label: "渠道", value: "channel" },
                { label: "研发", value: "rd" },
              ]}
              value={filterType || undefined}
              onChange={(v) => setFilterType(v || "")}
            />
            <Select
              placeholder="生命周期"
              style={{ width: 140 }}
              options={[
                { label: "有效账单", value: "active" },
                { label: "已作废", value: "discarded" },
                { label: "全部", value: "all" },
              ]}
              value={billLifecycle}
              onChange={(v) => setBillLifecycle((v || "active") as "active" | "discarded" | "all")}
            />
            <Button onClick={() => loadBills()}>查询</Button>
            <Select
              style={{ width: 100 }}
              value={exportFormat}
              onChange={(v) => setExportFormat(v)}
              options={[
                { label: "Excel", value: "xlsx" },
                { label: "CSV", value: "csv" },
              ]}
            />
            <Button onClick={exportBills}>导出账单</Button>
            {hasRole(["admin"]) && (
              <Button danger onClick={cleanupDuplicateDraftBills}>
                清理重复草稿账单
              </Button>
            )}
            <Button
              danger
              disabled={selectedRowKeys.length === 0 || bulkDiscarding}
              loading={bulkDiscarding}
              onClick={bulkDiscardBills}
            >
              批量作废
            </Button>
            <Tooltip title="后端暂无批量直接置已回款接口，需先登记回款；这里支持批量跳转。">
              <Button onClick={gotoBatchReceipt}>批量标记已回款</Button>
            </Tooltip>
            <Space>
              <span>对账模式</span>
              <Switch checked={reconMode} onChange={setReconMode} checkedChildren="对账" unCheckedChildren="普通" />
            </Space>
            {!reconMode && (
              <Space>
                <span>显示试算结果</span>
                <Switch checked={showTrial} onChange={setShowTrial} />
              </Space>
            )}
            <Space>
              <span>每页</span>
              <Select
                style={{ width: 100 }}
                value={pageSize}
                onChange={(v) => setPageSize(v)}
                options={[
                  { label: "100", value: 100 },
                  { label: "200", value: 200 },
                  { label: "500", value: 500 },
                ]}
              />
            </Space>
          </Space>
        }
      >
        <Table
          size={reconMode ? "small" : "middle"}
          rowKey="id"
          dataSource={rowsWithTrial}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((k) => String(k))),
          }}
          rowClassName={() => (reconMode ? "recon-row-compact" : "")}
          pagination={{
            current: currentPage,
            pageSize,
            showSizeChanger: false,
            onChange: (page) => {
              setCurrentPage(page);
              setSelectedRowKeys([]);
            },
          }}
          locale={{ emptyText: <Empty description="暂无账单数据，请先生成或调整筛选条件" /> }}
          columns={
            reconMode
              ? [
                  { title: "渠道", dataIndex: "target_name" },
                  { title: "流水", dataIndex: "gross_amount", render: (v: number, r: BillRow) => v ?? r.amount ?? "-" },
                  { title: "金额", dataIndex: "amount" },
                  { title: "已回款", dataIndex: "received_total", render: (v: number) => v ?? 0 },
                  { title: "未回款", dataIndex: "outstanding_amount", render: (v: number) => v ?? 0 },
                  {
                    title: "状态",
                    dataIndex: "flow_status",
                    render: (v: string, r: BillRow) =>
                      r.lifecycle_status === "discarded" ? (
                        <Tag color="default">已作废</Tag>
                      ) : (
                        <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : v === "已开票" ? "blue" : "default"}>{v || "-"}</Tag>
                      ),
                  },
                  {
                    title: "操作",
                    render: (_, r: BillRow) => (
                      <Space>
                        <Button size="small" onClick={() => openDetail(r.id)}>
                          查看详情
                        </Button>
                        <Button size="small" onClick={() => openDetailInNewTab(r.id)}>
                          新标签打开
                        </Button>
                      </Space>
                    ),
                  },
                ]
              : [
                  { title: "ID", dataIndex: "id" },
                  { title: "类型", dataIndex: "bill_type", render: (v: string) => <Tag>{v}</Tag> },
                  { title: "账期", dataIndex: "period" },
                  { title: "对象", dataIndex: "target_name" },
                  { title: "流水(预留)", dataIndex: "gross_amount", render: (v: number) => v ?? "-" },
                  { title: "通道费(预留)", dataIndex: "channel_fee", render: (v: number) => v ?? "-" },
                  { title: "税点(预留)", dataIndex: "tax_rate", render: (v: number) => v ?? "-" },
                  { title: "研发分成(预留)", dataIndex: "rd_share", render: (v: number) => v ?? "-" },
                  { title: "金额", dataIndex: "amount" },
                  { title: "开票状态", dataIndex: "invoice_status", render: (v: string) => <Tag color={v === "已开票" ? "green" : "orange"}>{v || "-"}</Tag> },
                  { title: "结算金额(预留)", dataIndex: "settlement_amount", render: (v: number) => v ?? "-" },
                  { title: "利润(预留)", dataIndex: "profit", render: (v: number) => v ?? "-" },
                  ...(showTrial
                    ? [
                        {
                          title: "规则状态",
                          dataIndex: ["trial", "matched"],
                          render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "已匹配规则" : "未配置规则"}</Tag>,
                        },
                        { title: "折扣后流水", dataIndex: ["trial", "discountedGross"], render: (v: number) => (v ?? "-") },
                        { title: "通道费金额", dataIndex: ["trial", "channelFeeAmount"], render: (v: number) => (v ?? "-") },
                        { title: "税额", dataIndex: ["trial", "taxAmount"], render: (v: number) => (v ?? "-") },
                        { title: "研发分成金额", dataIndex: ["trial", "rdShareAmount"], render: (v: number) => (v ?? "-") },
                        { title: "试算结算金额", dataIndex: ["trial", "settlementAmount"], render: (v: number) => (v ?? "-") },
                        { title: "试算利润", dataIndex: ["trial", "profit"], render: (v: number) => (v ?? "-") },
                      ]
                    : []),
                  { title: "版本", dataIndex: "version" },
                  {
                    title: "账单状态",
                    dataIndex: "flow_status",
                    render: (v: string, r: BillRow) =>
                      r.lifecycle_status === "discarded" ? (
                        <Tag color="default">已作废</Tag>
                      ) : (
                        <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : v === "已开票" ? "blue" : "default"}>{v || "-"}</Tag>
                      ),
                  },
                  { title: "回款状态", dataIndex: "receipt_status", render: (v: string) => <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : "blue"}>{v || "-"}</Tag> },
                  { title: "已回款金额", dataIndex: "received_total", render: (v: number) => v ?? 0 },
                  { title: "未回款金额", dataIndex: "outstanding_amount", render: (v: number) => v ?? 0 },
                  {
                    title: "操作",
                    render: (_, r: BillRow) => (
                      <Space>
                        <Button size="small" onClick={() => openDetail(r.id)}>
                          查看详情
                        </Button>
                        <Button size="small" onClick={() => openDetailInNewTab(r.id)}>
                          新标签打开
                        </Button>
                        <Button
                          size="small"
                          disabled={r.lifecycle_status === "discarded"}
                          loading={sendingId === r.id}
                          onClick={() => sendBill(r.id, "已发送")}
                        >
                          发送
                        </Button>
                        <Button size="small" disabled={r.lifecycle_status === "discarded"} onClick={() => sendBill(r.id, "对方确认")}>
                          确认
                        </Button>
                        {canDiscardBill(r) && (
                          <Button size="small" danger loading={discardingId === r.id} onClick={() => discardBill(r)}>
                            作废
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]
          }
        />
      </Card>
      <Drawer open={!!detail} title={`查看账单详情 #${detail?.id || ""}`} width={560} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Descriptions column={1} bordered>
              <Descriptions.Item label="账单类型">{detail.bill_type}</Descriptions.Item>
              <Descriptions.Item label="账期">{detail.period}</Descriptions.Item>
              <Descriptions.Item label="对象">{detail.target_name}</Descriptions.Item>
              <Descriptions.Item label="金额">{detail.amount}</Descriptions.Item>
              <Descriptions.Item label="账单状态">{detail.flow_status || detail.status}</Descriptions.Item>
              <Descriptions.Item label="开票状态">{detail.invoice_status || "-"}</Descriptions.Item>
              <Descriptions.Item label="回款状态">{detail.receipt_status || detail.collection_status || "-"}</Descriptions.Item>
              <Descriptions.Item label="规则来源说明">
                当前账单规则来自系统“规则配置”页（游戏+渠道维度）。<br />
                折扣/通道费/税点/研发分成将作为自动计算依据。<br />
                当前接口若未返回明细字段，则前端展示预留列，待后端逐步补全。
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="试算明细（前端预览，不替代正式结算）">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="规则匹配">{detailTrial?.matched ? `已匹配：${detailTrial.ruleName}` : "未配置规则"}</Descriptions.Item>
                <Descriptions.Item label="折扣后流水">{detailTrial?.discountedGross ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="通道费金额">{detailTrial?.channelFeeAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="税额">{detailTrial?.taxAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="研发分成金额">{detailTrial?.rdShareAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="试算结算金额">{detailTrial?.settlementAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="试算利润">{detailTrial?.profit ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="公式说明">
                  折扣后流水=原流水*折扣系数；通道费金额=折扣后流水*通道费比例；税额=折扣后流水*税点比例；研发分成金额=折扣后流水*研发分成比例；试算结算金额=折扣后流水-通道费金额-税额-研发分成金额；试算利润=试算结算金额。
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Card size="small" title="关联发票信息">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="是否已开票">{detail.invoice_info?.has_invoice ? "是" : "否"}</Descriptions.Item>
                <Descriptions.Item label="发票编号">{detail.invoice_info?.invoice_no || "-"}</Descriptions.Item>
                <Descriptions.Item label="发票金额">{detail.invoice_info?.invoice_amount ?? 0}</Descriptions.Item>
                <Descriptions.Item label="开票日期">{detail.invoice_info?.issue_date || "-"}</Descriptions.Item>
                <Descriptions.Item label="操作">
                  <Button size="small" onClick={() => router.push(`/invoices?keyword=${detail.id}`)}>
                    查看发票
                  </Button>
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Card size="small" title="关联回款信息">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="已回款金额">{detail.receipt_info?.received_total ?? detail.received_total ?? 0}</Descriptions.Item>
                <Descriptions.Item label="未回款金额">{detail.receipt_info?.outstanding_amount ?? detail.outstanding_amount ?? 0}</Descriptions.Item>
                <Descriptions.Item label="最近回款日期">{detail.receipt_info?.latest_receipt_date || detail.latest_receipt_date || "-"}</Descriptions.Item>
                <Descriptions.Item label="回款状态">{detail.receipt_info?.receipt_status || detail.receipt_status || "-"}</Descriptions.Item>
                <Descriptions.Item label="操作">
                  <Button size="small" onClick={() => router.push(`/receipts?keyword=${detail.id}`)}>
                    查看回款
                  </Button>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Space>
        )}
      </Drawer>
      <style jsx global>{`
        .recon-row-compact td {
          padding-top: 6px !important;
          padding-bottom: 6px !important;
        }
      `}</style>
    </Space>
  );
}
