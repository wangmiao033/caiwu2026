"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { exportRowsToXlsx } from "@/lib/export";

type ReceiptRow = {
  id: number;
  bill_id: number;
  received_at: string;
  amount: number;
  bank_ref: string;
  account_name: string;
  status?: string;
  target_name?: string;
  period?: string;
  remark?: string;
  created_at?: string;
};

export default function ReceiptsPage() {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");
  const [keyword, setKeyword] = useState("");
  const [openEdit, setOpenEdit] = useState(false);
  const [editing, setEditing] = useState<ReceiptRow | null>(null);
  const [editForm] = Form.useForm();

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (period) params.set("period", period);
      if (keyword) params.set("keyword", keyword);
      const data = await apiRequest<ReceiptRow[]>(`/receipts${params.toString() ? `?${params.toString()}` : ""}`);
      setRows(data);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      const result = await apiRequest<{ collection_status: string; receipt_id: number }>("/receipts", "POST", values);
      message.success("回款登记成功");
      form.resetFields();
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const update = async () => {
    const values = await editForm.validateFields();
    if (!editing) return;
    try {
      await apiRequest(`/receipts/${editing.id}`, "PUT", values);
      message.success("编辑成功");
      setOpenEdit(false);
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const filtered = useMemo(() => rows, [rows]);
  const exportData = () => {
    exportRowsToXlsx(
      filtered.map((x) => ({
        回款ID: x.id,
        关联账单: x.bill_id,
        目标对象: x.target_name || "",
        金额: x.amount,
        回款日期: x.received_at,
        状态: x.status || "",
        备注: x.remark || "",
        创建时间: x.created_at || "",
      })),
      "receipts_export.xlsx"
    );
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
      <Card
        title="回款列表"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="状态筛选"
              style={{ width: 160 }}
              options={[
                { label: "待回款", value: "待回款" },
                { label: "部分回款", value: "部分回款" },
                { label: "已回款", value: "已回款" },
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
            { title: "回款ID", dataIndex: "id" },
            { title: "账单ID", dataIndex: "bill_id" },
            { title: "目标对象", dataIndex: "target_name" },
            { title: "账期", dataIndex: "period" },
            { title: "回款日期", dataIndex: "received_at" },
            { title: "金额", dataIndex: "amount" },
            { title: "流水号", dataIndex: "bank_ref" },
            { title: "收款账户", dataIndex: "account_name" },
            {
              title: "核销状态",
              dataIndex: "status",
              render: (v: string) => <Tag color={v === "已回款" ? "green" : v === "部分回款" ? "gold" : "blue"}>{v || "-"}</Tag>,
            },
            {
              title: "操作",
              render: (_, r) => (
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    editForm.setFieldsValue({
                      bill_id: r.bill_id,
                      received_at: r.received_at,
                      amount: r.amount,
                      bank_ref: r.bank_ref,
                      account_name: r.account_name,
                      status: r.status,
                      remark: r.remark || "",
                    });
                    setOpenEdit(true);
                  }}
                >
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal open={openEdit} title={`编辑回款 #${editing?.id || ""}`} onCancel={() => setOpenEdit(false)} onOk={update}>
        <Form form={editForm} layout="vertical">
          <Form.Item label="账单ID" name="bill_id" rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="回款日期" name="received_at" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="流水号" name="bank_ref" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="收款账户" name="account_name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true }]}>
            <Select options={[{ label: "待回款", value: "待回款" }, { label: "部分回款", value: "部分回款" }, { label: "已回款", value: "已回款" }]} />
          </Form.Item>
          <Form.Item label="备注" name="remark"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
