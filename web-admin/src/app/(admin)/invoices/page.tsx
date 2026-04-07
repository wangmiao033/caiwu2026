"use client";

import { useState } from "react";
import { Button, Card, Form, Input, InputNumber, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type InvoiceRow = {
  id: number;
  invoice_no: string;
  bill_id: number;
  issue_date: string;
  total_amount: number;
  status: string;
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      const data = await apiRequest<InvoiceRow[]>("/invoices");
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
      <Card title="发票列表">
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "ID", dataIndex: "id" },
            { title: "发票号", dataIndex: "invoice_no" },
            { title: "账单ID", dataIndex: "bill_id" },
            { title: "开票日期", dataIndex: "issue_date" },
            { title: "金额", dataIndex: "total_amount" },
            { title: "状态", dataIndex: "status", render: (v: string) => <Tag>{v}</Tag> },
          ]}
        />
      </Card>
    </Space>
  );
}
