"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DatePicker, Form, Input, Select, Space, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ArrowLeftOutlined, SaveOutlined } from "@ant-design/icons";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import ContractItemsEditor from "../ContractItemsEditor";
import { STATUS_OPTIONS, toApiItemPayload, type ContractStatus, type LocalContractItem } from "../types";

type CreatedHeader = { id: number };

export default function ContractNewPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [items, setItems] = useState<LocalContractItem[]>([]);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const start = values.start_date as Dayjs;
    const end = values.end_date as Dayjs;
    const payload = {
      contract_no: String(values.contract_no || "").trim(),
      contract_name: String(values.contract_name || "").trim(),
      channel_name: String(values.channel_name || "").trim(),
      platform_party_name: String(values.platform_party_name || "广州熊动科技有限公司").trim() || "广州熊动科技有限公司",
      platform_party_address: String(values.platform_party_address || "").trim(),
      developer_party_name: String(values.developer_party_name || "").trim(),
      developer_party_address: String(values.developer_party_address || "").trim(),
      start_date: start.format("YYYY-MM-DD"),
      end_date: end.format("YYYY-MM-DD"),
      status: values.status as ContractStatus,
      remark: String(values.remark || "").trim(),
    };
    if (!payload.contract_no || !payload.contract_name || !payload.channel_name) {
      message.error("请填写合同编号、名称与渠道");
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<CreatedHeader>("/contracts", "POST", payload);
      const cid = created.id;
      for (const row of items) {
        const body = toApiItemPayload(row);
        if (!body.game_name) continue;
        await apiRequest(`/contracts/${cid}/items`, "POST", body);
      }
      message.success("合同已创建");
      router.replace(`/contracts/${cid}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/contracts")}>
            返回列表
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void submit()}>
            保存合同
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          独立录入页便于长表单。若持有渠道合同 PDF，可直接进入{" "}
          <Link href="/contracts/import-draft">PDF 合同识别录入</Link>（/contracts/import-draft）生成草稿后保存。
        </Typography.Paragraph>

        <Form
          form={form}
          layout="vertical"
          initialValues={{
            platform_party_name: "广州熊动科技有限公司",
            status: "draft" satisfies ContractStatus,
            start_date: dayjs(),
            end_date: dayjs().add(1, "year"),
          }}
        >
          <Card title="一、合同基础信息" size="small">
            <Form.Item name="contract_no" label="合同编号" rules={[{ required: true, message: "请输入合同编号" }]}>
              <Input placeholder="唯一编号" />
            </Form.Item>
            <Form.Item name="contract_name" label="合同名称" rules={[{ required: true, message: "请输入合同名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="channel_name" label="渠道名称" rules={[{ required: true, message: "请输入渠道名称" }]}>
              <Input placeholder="与主数据渠道名称保持一致便于后续联动" />
            </Form.Item>
            <Form.Item name="platform_party_name" label="平台/发行主体（甲方）">
              <Input />
            </Form.Item>
            <Form.Item name="platform_party_address" label="甲方地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="developer_party_name" label="研发/乙方名称">
              <Input />
            </Form.Item>
            <Form.Item name="developer_party_address" label="乙方地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Space wrap>
              <Form.Item name="start_date" label="开始日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="end_date" label="结束日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={STATUS_OPTIONS} style={{ width: 160 }} />
              </Form.Item>
            </Space>
          </Card>

          <Card title="二、合同明细信息" size="small" style={{ marginTop: 16 }}>
            <ContractItemsEditor value={items} onChange={setItems} />
          </Card>

          <Card title="三、备注 / 来源信息" size="small" style={{ marginTop: 16 }}>
            <Form.Item name="remark" label="备注与来源说明">
              <Input.TextArea
                rows={4}
                placeholder="可填写纸质合同存档位置、扫描件路径、用印版本、对接人等（本版不支持附件上传）"
              />
            </Form.Item>
          </Card>
        </Form>

        <Space>
          <Button type="primary" size="large" loading={saving} icon={<SaveOutlined />} onClick={() => void submit()}>
            保存合同
          </Button>
        </Space>
      </Space>
    </RoleGuard>
  );
}
