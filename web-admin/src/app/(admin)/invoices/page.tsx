"use client";

import { useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { exportRowsToXlsx } from "@/lib/export";

type InvoiceRow = {
  id: number;
  invoice_no: string;
  bill_id: number;
  issue_date: string;
  total_amount: number;
  status: string;
  period?: string;
  target_name?: string;
  remark?: string;
  created_at?: string;
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");
  const [keyword, setKeyword] = useState("");
  const [form] = Form.useForm();

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (period) params.set("period", period);
      if (keyword) params.set("keyword", keyword);
      const data = await apiRequest<InvoiceRow[]>(`/invoices${params.toString() ? `?${params.toString()}` : ""}`);
      setRows(data);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const create = async () => {
    const values = await form.validateFields();
    try {
      await apiRequest("/invoices", "POST", values);
      message.success("开票成功");
      form.resetFields();
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const filtered = useMemo(() => rows, [rows]);
  const exportData = () => {
    exportRowsToXlsx(
      filtered.map((x) => ({
        发票ID: x.id,
        发票编号: x.invoice_no,
        关联账单: x.bill_id,
        目标对象: x.target_name || "",
        金额: x.total_amount,
        状态: x.status,
        开票日期: x.issue_date,
        备注: x.remark || "",
        创建时间: x.created_at || "",
      })),
      "invoices_export.xlsx"
    );
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="发票登记">
        <Form form={form} layout="inline" initialValues={{ issue_date: "2026-04-01", tax_amount: 0 }}>
          <Form.Item name="invoice_no" rules={[{ required: true }]}><Input placeholder="发票号" /></Form.Item>
          <Form.Item name="bill_id" rules={[{ required: true }]}><InputNumber placeholder="账单ID" /></Form.Item>
          <Form.Item name="issue_date" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
          <Form.Item name="amount_without_tax" rules={[{ required: true }]}><InputNumber placeholder="不含税金额" /></Form.Item>
          <Form.Item name="tax_amount" rules={[{ required: true }]}><InputNumber placeholder="税额" /></Form.Item>
          <Form.Item name="total_amount" rules={[{ required: true }]}><InputNumber placeholder="价税合计" /></Form.Item>
          <Form.Item><Button type="primary" onClick={create}>提交</Button></Form.Item>
          <Form.Item><Button onClick={load}>刷新列表</Button></Form.Item>
        </Form>
      </Card>
      <Card
        title="发票列表"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="状态筛选"
              style={{ width: 140 }}
              options={[
                { label: "待开票", value: "待开票" },
                { label: "已开票", value: "已开票" },
                { label: "已作废", value: "已作废" },
              ]}
              value={status || undefined}
              onChange={(v) => setStatus(v || "")}
            />
            <Input placeholder="账期筛选" value={period} onChange={(e) => setPeriod(e.target.value)} />
            <Input placeholder="关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <Button onClick={load}>查询</Button>
            <Button onClick={exportData}>导出</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={filtered}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "ID", dataIndex: "id" },
            { title: "发票号", dataIndex: "invoice_no" },
            { title: "账单ID", dataIndex: "bill_id" },
            { title: "目标对象", dataIndex: "target_name" },
            { title: "账期", dataIndex: "period" },
            { title: "开票日期", dataIndex: "issue_date" },
            { title: "金额", dataIndex: "total_amount" },
            { title: "状态", dataIndex: "status", render: (v: string) => <Tag>{v}</Tag> },
          ]}
        />
      </Card>
    </Space>
  );
}
