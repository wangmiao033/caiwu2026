"use client";

import { useState } from "react";
import { Button, Card, Col, Row, Statistic, Table, message } from "antd";
import { Column } from "@ant-design/charts";
import { apiRequest } from "@/lib/api";

type FinanceRes = {
  total_receivable: number;
  total_invoiced?: number;
  total_received: number;
  outstanding: number;
  overdue_amount?: number;
  status_breakdown?: Record<string, number>;
  recent_period_summary?: Array<{ period: string; bill_count: number; receivable: number; received: number; outstanding: number }>;
  pending_bills?: Array<{
    bill_id: number;
    period: string;
    target_name: string;
    bill_type: string;
    amount: number;
    received_total: number;
    outstanding_amount: number;
    receipt_status: string;
  }>;
};

export default function FinancePage() {
  const [data, setData] = useState<FinanceRes>({ total_receivable: 0, total_received: 0, outstanding: 0, status_breakdown: {} });
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [receiptCount, setReceiptCount] = useState(0);

  const load = async () => {
    try {
      const d = await apiRequest<FinanceRes>("/dashboard/finance");
      setData(d);
      const [invoices, receipts] = await Promise.all([apiRequest<unknown[]>("/invoices"), apiRequest<unknown[]>("/receipts")]);
      setInvoiceCount(invoices.length);
      setReceiptCount(receipts.length);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const chartData = Object.entries(data.status_breakdown || {}).map(([name, value]) => ({ name, value }));

  return (
    <>
      <Button type="primary" onClick={load} style={{ marginBottom: 16 }}>
        刷新数据
      </Button>
      <Row gutter={16}>
        <Col span={8}><Card><Statistic title="应收" value={data.total_receivable || 0} precision={2} /></Card></Col>
        <Col span={8}><Card><Statistic title="已开票总额" value={data.total_invoiced || 0} precision={2} /></Card></Col>
        <Col span={8}><Card><Statistic title="已回款总额" value={data.total_received || 0} precision={2} /></Card></Col>
        <Col span={8} style={{ marginTop: 16 }}><Card><Statistic title="未回款总额" value={data.outstanding || 0} precision={2} /></Card></Col>
        <Col span={8} style={{ marginTop: 16 }}><Card><Statistic title="逾期金额" value={data.overdue_amount || 0} precision={2} /></Card></Col>
        <Col span={8} style={{ marginTop: 16 }}><Card><Statistic title="发票数量" value={invoiceCount} /></Card></Col>
        <Col span={8} style={{ marginTop: 16 }}><Card><Statistic title="回款数量" value={receiptCount} /></Card></Col>
      </Row>
      <Card title="回款状态分布" style={{ marginTop: 16 }}>
        <Column data={chartData} xField="name" yField="value" />
      </Card>
      <Card title="最近账期汇总" style={{ marginTop: 16 }}>
        <Table
          rowKey="period"
          size="small"
          pagination={false}
          dataSource={data.recent_period_summary || []}
          columns={[
            { title: "账期", dataIndex: "period" },
            { title: "账单数", dataIndex: "bill_count" },
            { title: "应收", dataIndex: "receivable" },
            { title: "已收", dataIndex: "received" },
            { title: "未收", dataIndex: "outstanding" },
          ]}
        />
      </Card>
      <Card title="最近未回款账单" style={{ marginTop: 16 }}>
        <Table
          rowKey="bill_id"
          size="small"
          pagination={{ pageSize: 8 }}
          dataSource={data.pending_bills || []}
          columns={[
            { title: "账单ID", dataIndex: "bill_id" },
            { title: "账期", dataIndex: "period" },
            { title: "对象", dataIndex: "target_name" },
            { title: "类型", dataIndex: "bill_type" },
            { title: "应收", dataIndex: "amount" },
            { title: "已收", dataIndex: "received_total" },
            { title: "未收", dataIndex: "outstanding_amount" },
            { title: "状态", dataIndex: "receipt_status" },
          ]}
        />
      </Card>
    </>
  );
}
