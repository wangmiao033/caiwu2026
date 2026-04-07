"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Descriptions, Drawer, Empty, Input, Modal, Select, Space, Switch, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
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
  private_rate?: number;
  settlement_amount?: number;
  profit?: number;
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

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState("2026-03");
  const [list, setList] = useState<BillRow[]>([]);
  const [filterType, setFilterType] = useState<string>("");
  const [filterText, setFilterText] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [showTrial, setShowTrial] = useState(false);
  const [rules, setRules] = useState<BillingRule[]>([]);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");

  useEffect(() => {
    const cache = localStorage.getItem("billing_rules_local");
    if (!cache) return;
    try {
      setRules(JSON.parse(cache));
    } catch {}
  }, []);
  useEffect(() => {
    const q = searchParams.get("bill_id") || searchParams.get("keyword") || "";
    if (q) {
      setFilterText(q);
      loadBills();
    }
  }, [searchParams]);

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

  const loadBills = async () => {
    try {
      const query = filterType ? `/billing/bills?bill_type=${filterType}` : "/billing/bills";
      const data = await apiRequest<BillRow[]>(query);
      setList(data);
    } catch (e) {
      message.error((e as Error).message);
    }
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

  const filtered = useMemo(
    () => list.filter((x) => `${x.id}${x.target_name}${x.period}`.toLowerCase().includes(filterText.toLowerCase())),
    [list, filterText]
  );

  const rowsWithTrial = useMemo(() => {
    return filtered.map((bill) => {
      const baseGross = Number(bill.gross_amount ?? bill.amount ?? 0);
      const rule = matchRuleForBill(rules, bill.bill_type, bill.target_name);
      const trial = calcTrialResult(baseGross, rule);
      return { ...bill, trial };
    });
  }, [filtered, rules]);

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
      私点金额: x.trial?.privateAmount ?? "",
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="账单生成">
        <Space>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="账期 2026-03" />
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
            <Button onClick={loadBills}>查询</Button>
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
            <Space>
              <span>显示试算结果</span>
              <Switch checked={showTrial} onChange={setShowTrial} />
            </Space>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={rowsWithTrial}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无账单数据，请先生成或调整筛选条件" /> }}
          columns={[
            { title: "ID", dataIndex: "id" },
            { title: "类型", dataIndex: "bill_type", render: (v: string) => <Tag>{v}</Tag> },
            { title: "账期", dataIndex: "period" },
            { title: "对象", dataIndex: "target_name" },
            { title: "流水(预留)", dataIndex: "gross_amount", render: (v: number) => v ?? "-" },
            { title: "通道费(预留)", dataIndex: "channel_fee", render: (v: number) => v ?? "-" },
            { title: "税点(预留)", dataIndex: "tax_rate", render: (v: number) => v ?? "-" },
            { title: "研发分成(预留)", dataIndex: "rd_share", render: (v: number) => v ?? "-" },
            { title: "私点(预留)", dataIndex: "private_rate", render: (v: number) => v ?? "-" },
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
                  { title: "私点金额", dataIndex: ["trial", "privateAmount"], render: (v: number) => (v ?? "-") },
                  { title: "试算结算金额", dataIndex: ["trial", "settlementAmount"], render: (v: number) => (v ?? "-") },
                  { title: "试算利润", dataIndex: ["trial", "profit"], render: (v: number) => (v ?? "-") },
                ]
              : []),
            { title: "版本", dataIndex: "version" },
            {
              title: "账单状态",
              dataIndex: "flow_status",
              render: (v: string) => <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : v === "已开票" ? "blue" : "default"}>{v || "-"}</Tag>,
            },
            { title: "回款状态", dataIndex: "receipt_status", render: (v: string) => <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : "blue"}>{v || "-"}</Tag> },
            { title: "已回款金额", dataIndex: "received_total", render: (v: number) => v ?? 0 },
            { title: "未回款金额", dataIndex: "outstanding_amount", render: (v: number) => v ?? 0 },
            {
              title: "操作",
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openDetail(r.id)}>
                    查看详情
                  </Button>
                  <Button size="small" loading={sendingId === r.id} onClick={() => sendBill(r.id, "已发送")}>
                    发送
                  </Button>
                  <Button size="small" onClick={() => sendBill(r.id, "对方确认")}>
                    确认
                  </Button>
                </Space>
              ),
            },
          ]}
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
                折扣/通道费/税点/研发分成/私点将作为自动计算依据。<br />
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
                <Descriptions.Item label="私点金额">{detailTrial?.privateAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="试算结算金额">{detailTrial?.settlementAmount ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="试算利润">{detailTrial?.profit ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="公式说明">
                  折扣后流水=原流水*折扣系数；通道费金额=折扣后流水*通道费比例；税额=折扣后流水*税点比例；研发分成金额=折扣后流水*研发分成比例；私点金额=折扣后流水*私点比例；试算结算金额=折扣后流水-通道费金额-税额-研发分成金额-私点金额；试算利润=试算结算金额。
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
    </Space>
  );
}
