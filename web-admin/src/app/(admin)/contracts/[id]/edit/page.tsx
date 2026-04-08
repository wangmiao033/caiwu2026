"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, DatePicker, Form, Input, Select, Space, Spin, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ArrowLeftOutlined, SaveOutlined } from "@ant-design/icons";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import ContractItemsEditor from "../../ContractItemsEditor";
import {
  STATUS_OPTIONS,
  toApiItemPayload,
  validateContractItemsForSave,
  type ContractStatus,
  type LocalContractItem,
} from "../../types";

type ContractItemRow = {
  id: number;
  contract_id: number;
  game_name: string;
  channel_name?: string;
  discount_label: string;
  discount_rate: number;
  channel_share_percent: number;
  channel_fee_percent: number;
  tax_percent: number;
  private_percent: number;
  item_remark?: string;
  rd_share_note: string;
  is_active: boolean;
};

type ContractDetail = {
  id: number;
  contract_no: string;
  contract_name: string;
  channel_name: string;
  platform_party_name: string;
  platform_party_address: string;
  developer_party_name: string;
  developer_party_address: string;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  remark: string;
  items: ContractItemRow[];
};

function mapServerItemsToLocal(rows: ContractItemRow[], fallbackChannel: string): LocalContractItem[] {
  const fb = fallbackChannel.trim();
  return rows.map((it) => ({
    localKey: `srv-${it.id}`,
    id: it.id,
    game_name: it.game_name,
    channel_name: (it.channel_name || "").trim() || fb,
    discount_label: it.discount_label || "",
    discount_rate: it.discount_rate ?? 0,
    channel_share_percent: it.channel_share_percent ?? 0,
    channel_fee_percent: it.channel_fee_percent ?? 0,
    tax_percent: it.tax_percent ?? 0,
    private_percent: it.private_percent ?? 0,
    item_remark: it.item_remark || "",
    rd_share_note: it.rd_share_note || "",
    is_active: !!it.is_active,
  }));
}

export default function ContractEditPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params.id;
  const contractId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
  const [form] = Form.useForm();
  const headerChannel = Form.useWatch("channel_name", form) as string | undefined;
  const [items, setItems] = useState<LocalContractItem[]>([]);
  const [deletedServerIds, setDeletedServerIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(contractId) || contractId <= 0) return;
    setLoading(true);
    try {
      const data = await apiRequest<ContractDetail>(`/contracts/${contractId}`);
      form.setFieldsValue({
        contract_no: data.contract_no,
        contract_name: data.contract_name,
        channel_name: data.channel_name,
        platform_party_name: data.platform_party_name || "广州熊动科技有限公司",
        platform_party_address: data.platform_party_address || "",
        developer_party_name: data.developer_party_name || "",
        developer_party_address: data.developer_party_address || "",
        start_date: data.start_date ? dayjs(data.start_date) : null,
        end_date: data.end_date ? dayjs(data.end_date) : null,
        status: data.status,
        remark: data.remark || "",
      });
      setItems(mapServerItemsToLocal(data.items || [], data.channel_name || ""));
      setDeletedServerIds([]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contractId, form]);

  useEffect(() => {
    void load();
  }, [load]);

  const onItemsChange = useCallback((next: LocalContractItem[]) => {
    setItems((prev) => {
      const prevIds = new Set(prev.filter((r) => r.id).map((r) => r.id as number));
      const nextIds = new Set(next.filter((r) => r.id).map((r) => r.id as number));
      const removed = [...prevIds].filter((id) => !nextIds.has(id));
      if (removed.length) {
        setDeletedServerIds((d) => [...d, ...removed]);
      }
      return next;
    });
  }, []);

  const submit = async () => {
    if (!Number.isFinite(contractId) || contractId <= 0) return;
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
    const ive = validateContractItemsForSave(items);
    if (ive.length) {
      message.error(ive[0]);
      return;
    }
    setSaving(true);
    try {
      const delUnique = [...new Set(deletedServerIds)];
      for (const delId of delUnique) {
        await apiRequest(`/contract-items/${delId}`, "DELETE");
      }
      await apiRequest(`/contracts/${contractId}`, "PUT", payload);
      for (const row of items) {
        const body = toApiItemPayload(row);
        if (!body.game_name && !body.channel_name && !row.id) continue;
        if (!body.game_name || !body.channel_name) {
          message.error("每条明细需填写游戏与渠道；可删除空白行。");
          setSaving(false);
          return;
        }
        if (row.id && row.id > 0) {
          await apiRequest(`/contract-items/${row.id}`, "PUT", body);
        } else {
          await apiRequest(`/contracts/${contractId}/items`, "POST", body);
        }
      }
      message.success("已保存");
      router.push(`/contracts/${contractId}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!Number.isFinite(contractId) || contractId <= 0) {
    return (
      <RoleGuard allow={["admin", "finance_manager", "tech"]}>
        <Typography.Text>无效的合同 ID</Typography.Text>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Spin spinning={loading}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Button onClick={() => router.push(`/contracts/${contractId}`)}>返回详情</Button>
            <Button onClick={() => router.push("/contracts")}>返回列表</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void submit()}>
              保存变更
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            在此页完成合同主档与明细的一体维护；识别草稿将落在 <Link href="/contracts/import-draft">import-draft</Link>{" "}
           （后续迭代）。保存后会跳转详情页。
          </Typography.Paragraph>

          <Form form={form} layout="vertical">
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
              <ContractItemsEditor
                value={items}
                onChange={onItemsChange}
                headerChannelName={typeof headerChannel === "string" ? headerChannel : ""}
              />
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

          <Button type="primary" size="large" loading={saving} icon={<SaveOutlined />} onClick={() => void submit()}>
            保存变更
          </Button>
        </Space>
      </Spin>
    </RoleGuard>
  );
}
