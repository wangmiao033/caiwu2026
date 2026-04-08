"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DatePicker, Form, Input, Select, Space, Typography, Upload, message } from "antd";
import type { UploadProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ArrowLeftOutlined, FilePdfOutlined, SaveOutlined, UploadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { apiRequest, apiRequestDirect } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import ContractItemsEditor from "../ContractItemsEditor";
import {
  STORED_STATUS_OPTIONS,
  createEmptyContractItem,
  toApiItemPayload,
  validateContractItemsForSave,
  type ContractStoredStatus,
  type LocalContractItem,
} from "../types";

type CreatedHeader = { id: number };

type DraftParseItem = {
  game_name?: string;
  channel_name?: string;
  discount_label?: string;
  discount_rate?: number | string;
  channel_share_percent?: number | string;
  channel_fee_percent?: number | string;
  tax_percent?: number | string;
  private_percent?: number | string;
  item_remark?: string;
  rd_share_note?: string;
  is_active?: boolean;
};

type DraftParseOut = {
  contract_no?: string;
  contract_name?: string;
  channel_name?: string;
  platform_party_name?: string;
  platform_party_address?: string;
  developer_party_name?: string;
  developer_party_address?: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  remark?: string;
  items?: DraftParseItem[];
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 合同 PDF 直传后端（绕过 Next 函数体积分上限），须与后端 CORS 配置一致。 */
function resolveDirectBackendBase(): string {
  const u = (process.env.NEXT_PUBLIC_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (u) return u;
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  return "";
}

function draftItemsToLocal(rows: DraftParseItem[] | undefined, defaultChannel: string): LocalContractItem[] {
  const dc = defaultChannel.trim();
  if (!rows?.length) {
    const one = createEmptyContractItem();
    if (dc) one.channel_name = dc;
    return [one];
  }
  return rows.map((r) => {
    const row = createEmptyContractItem();
    if (dc) row.channel_name = dc;
    return {
      ...row,
      game_name: String(r.game_name || "").trim(),
      channel_name: String(r.channel_name || "").trim() || dc,
      discount_label: String(r.discount_label || "").trim(),
      discount_rate: num(r.discount_rate),
      channel_share_percent: num(r.channel_share_percent),
      channel_fee_percent: num(r.channel_fee_percent),
      tax_percent: num(r.tax_percent),
      private_percent: num(r.private_percent),
      item_remark: String(r.item_remark || "").trim(),
      rd_share_note: String(r.rd_share_note || "").trim(),
      is_active: r.is_active !== false,
    };
  });
}

export default function ContractImportDraftPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const headerChannel = Form.useWatch("channel_name", form) as string | undefined;
  const [items, setItems] = useState<LocalContractItem[]>([createEmptyContractItem()]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyParse = (data: DraftParseOut) => {
    const start = data.start_date ? dayjs(data.start_date) : dayjs();
    const end = data.end_date ? dayjs(data.end_date) : dayjs().add(1, "year");
    form.setFieldsValue({
      contract_no: String(data.contract_no || "").trim(),
      contract_name: String(data.contract_name || "").trim(),
      channel_name: String(data.channel_name || "").trim(),
      platform_party_name: String(data.platform_party_name || "广州熊动科技有限公司").trim() || "广州熊动科技有限公司",
      platform_party_address: String(data.platform_party_address || "").trim(),
      developer_party_name: String(data.developer_party_name || "").trim(),
      developer_party_address: String(data.developer_party_address || "").trim(),
      start_date: start.isValid() ? start : dayjs(),
      end_date: end.isValid() ? end : dayjs().add(1, "year"),
      status: (data.status as ContractStoredStatus) || "draft",
      remark: String(data.remark || "").trim(),
    });
    setItems(draftItemsToLocal(data.items, String(data.channel_name || "")));
    message.success("已根据 PDF 生成草稿，请核对后保存");
  };

  const parseProps: UploadProps = {
    accept: ".pdf,application/pdf",
    maxCount: 1,
    showUploadList: true,
    disabled: parsing,
    beforeUpload: (file) => {
      void (async () => {
        const lower = (file.name || "").toLowerCase();
        if (!lower.endsWith(".pdf")) {
          message.error("请上传 PDF 文件");
          return;
        }
        setParsing(true);
        try {
          const base = resolveDirectBackendBase();
          if (!base) {
            message.error("未配置 NEXT_PUBLIC_BACKEND_URL，无法将 PDF 直传后端（生产环境请在部署变量中填写与后端一致的公开地址）");
            return;
          }
          const fd = new FormData();
          fd.append("file", file);
          const data = await apiRequestDirect<DraftParseOut>(
            `${base}/contracts/import-draft/parse`,
            "POST",
            fd,
            true
          );
          applyParse(data);
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setParsing(false);
        }
      })();
      return false;
    },
  };

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
      status: values.status as ContractStoredStatus,
      remark: String(values.remark || "").trim(),
    };
    if (!payload.contract_no || !payload.contract_name || !payload.channel_name) {
      message.error("请填写合同编号、名称与渠道");
      return;
    }
    const ive = validateContractItemsForSave(items);
    if (ive.length) {
      message.error(ive[0]);
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<CreatedHeader>("/contracts", "POST", payload);
      const cid = created.id;
      for (const row of items) {
        const body = toApiItemPayload(row);
        if (!body.game_name && !body.channel_name) continue;
        if (!body.game_name || !body.channel_name) {
          message.error("每条明细需同时填写游戏与渠道");
          setSaving(false);
          return;
        }
        await apiRequest(`/contracts/${cid}/items`, "POST", body);
      }
      message.success("合同已保存");
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
            确认保存
          </Button>
        </Space>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          上传渠道合同 PDF，后端抽取文本并规则识别字段，生成可编辑草稿；识别结果请务必人工核对。手工新建请走{" "}
          <Link href="/contracts/new">新建合同</Link>。
        </Typography.Paragraph>

        <Card title="PDF 上传与识别" size="small">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              仅支持 PDF（最大约 10MB）。扫描版若无文本层将无法识别，需 OCR 工具预处理（本版不包含）。
            </Typography.Text>
            <Upload {...parseProps}>
              <Button icon={<UploadOutlined />} loading={parsing}>
                选择 PDF 并识别
              </Button>
            </Upload>
          </Space>
        </Card>

        <Form
          form={form}
          layout="vertical"
          initialValues={{
            platform_party_name: "广州熊动科技有限公司",
            status: "draft" satisfies ContractStoredStatus,
            start_date: dayjs(),
            end_date: dayjs().add(1, "year"),
          }}
        >
          <Card title="一、合同基础信息" size="small">
            <Form.Item name="contract_no" label="合同编号" rules={[{ required: true, message: "请输入合同编号" }]}>
              <Input placeholder="识别或手工填写" />
            </Form.Item>
            <Form.Item name="contract_name" label="合同名称" rules={[{ required: true, message: "请输入合同名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="channel_name" label="渠道名称 / 对方公司" rules={[{ required: true, message: "请输入渠道名称" }]}>
              <Input placeholder="可与乙方名称一致，请按主数据核对" />
            </Form.Item>
            <Form.Item name="platform_party_name" label="甲方（平台/发行）">
              <Input />
            </Form.Item>
            <Form.Item name="platform_party_address" label="甲方地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="developer_party_name" label="乙方（研发/合作方）">
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
              <Form.Item name="status" label="合同状态" rules={[{ required: true }]}>
                <Select options={STORED_STATUS_OPTIONS} style={{ width: 160 }} />
              </Form.Item>
            </Space>
          </Card>

          <Card title="二、合同明细（游戏、折扣、分成、费用、税点、私点）" size="small" style={{ marginTop: 16 }}>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              <FilePdfOutlined /> 识别结果依赖 PDF 排版，可能不完整；可在下表增删改。
            </Typography.Paragraph>
            <ContractItemsEditor
              value={items}
              onChange={setItems}
              headerChannelName={typeof headerChannel === "string" ? headerChannel : ""}
            />
          </Card>

          <Card title="三、备注" size="small" style={{ marginTop: 16 }}>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={4} placeholder="来源说明、核对记录等" />
            </Form.Item>
          </Card>
        </Form>

        <Space>
          <Button type="primary" size="large" loading={saving} icon={<SaveOutlined />} onClick={() => void submit()}>
            确认保存
          </Button>
        </Space>
      </Space>
    </RoleGuard>
  );
}
