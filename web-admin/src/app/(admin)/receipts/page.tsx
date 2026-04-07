"use client";

import { useState } from "react";
import { Button, Card, Form, Input, InputNumber, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type ReceiptRow = {
  key: number;
  bill_id: number;
  received_at: string;
  amount: number;
  bank_ref: string;
  account_name: string;
  collection_status?: string;
};

export default function ReceiptsPage() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<ReceiptRow[]>([]);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      const result = await apiRequest<{ collection_status: string; receipt_id: number }>("/receipts", "POST", values);
      message.success("回款登记成功");
      setRows((prev) => [
        {
          key: result.receipt_id,
          ...values,
          collection_status: result.collection_status,
        },
        ...prev,
      ]);
      form.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="回款登记">
        <Form form={form} layout="inline" initialValues={{ received_at: "2026-04-01" }}>
          <Form.Item name="bill_id" rules={[{ required: true }]}><InputNumber placeholder="账单ID" /></Form.Item>
          <Form.Item name="received_at" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
          <Form.Item name="amount" rules={[{ required: true }]}><InputNumber placeholder="回款金额" /></Form.Item>
          <Form.Item name="bank_ref" rules={[{ required: true }]}><Input placeholder="流水号" /></Form.Item>
          <Form.Item name="account_name" rules={[{ required: true }]}><Input placeholder="收款账户" /></Form.Item>
          <Form.Item><Button type="primary" onClick={submit}>提交</Button></Form.Item>
        </Form>
      </Card>
      <Card title="已登记回款（本次会话）">
        <Table
          rowKey="key"
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "账单ID", dataIndex: "bill_id" },
            { title: "回款日期", dataIndex: "received_at" },
            { title: "金额", dataIndex: "amount" },
            { title: "流水号", dataIndex: "bank_ref" },
            { title: "收款账户", dataIndex: "account_name" },
            {
              title: "核销状态",
              dataIndex: "collection_status",
              render: (v: string) => <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : "blue"}>{v || "-"}</Tag>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
