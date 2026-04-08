"use client";

import { Form, Input, InputNumber, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";

export type Project = { id: number; name: string; status: string };

export type GameVariant = {
  id: number;
  project_id: number;
  variant_name: string;
  raw_game_name: string;
  discount_type: string;
  version_type: string;
  server_type: string;
  status: string;
  remark: string;
  rd_company?: string | null;
  publish_company?: string | null;
  rd_share_percent?: number | null;
  publish_share_percent?: number | null;
  settlement_remark?: string | null;
  created_at: string;
};

export const DISCOUNT_OPTIONS = [
  { label: "无", value: "none" },
  { label: "0.1 折", value: "0.1" },
  { label: "0.05 折", value: "0.05" },
];

export const VERSION_OPTIONS = [
  { label: "常规版", value: "常规版" },
  { label: "联运版", value: "联运版" },
  { label: "自运营版", value: "自运营版" },
  { label: "折扣版", value: "折扣版" },
];

export const SERVER_OPTIONS = [
  { label: "混服", value: "混服" },
  { label: "专服", value: "专服" },
];

export const defaultFormValues = {
  project_id: undefined as number | undefined,
  variant_name: "",
  raw_game_name: "",
  discount_type: "none",
  version_type: "常规版",
  server_type: "混服",
  status: true,
  remark: "",
  rd_company: "",
  publish_company: "广州熊动科技有限公司",
  rd_share_percent: undefined as number | undefined,
  publish_share_percent: undefined as number | undefined,
  settlement_remark: "",
};

export function variantToFormValues(r: GameVariant) {
  return {
    project_id: r.project_id,
    variant_name: r.variant_name,
    raw_game_name: r.raw_game_name,
    discount_type: r.discount_type,
    version_type: r.version_type,
    server_type: r.server_type,
    status: r.status === "active",
    remark: r.remark,
    rd_company: r.rd_company || "",
    publish_company: r.publish_company || "广州熊动科技有限公司",
    rd_share_percent: r.rd_share_percent ?? undefined,
    publish_share_percent: r.publish_share_percent ?? undefined,
    settlement_remark: r.settlement_remark || "",
  };
}

export type GameVariantFormValues = {
  project_id: number;
  variant_name: string;
  raw_game_name: string;
  discount_type: string;
  version_type: string;
  server_type: string;
  status: boolean;
  remark: string;
  rd_company: string;
  publish_company: string;
  rd_share_percent: number | undefined;
  publish_share_percent: number | undefined;
  settlement_remark: string;
};

export function buildGameVariantPayload(values: GameVariantFormValues) {
  return {
    project_id: values.project_id,
    variant_name: values.variant_name.trim(),
    raw_game_name: values.raw_game_name.trim(),
    discount_type: values.discount_type,
    version_type: values.version_type,
    server_type: values.server_type,
    status: values.status ? "active" : "paused",
    remark: (values.remark || "").trim(),
    rd_company: (values.rd_company || "").trim() || null,
    publish_company: (values.publish_company || "").trim() || "广州熊动科技有限公司",
    rd_share_percent: typeof values.rd_share_percent === "number" ? values.rd_share_percent : null,
    publish_share_percent: typeof values.publish_share_percent === "number" ? values.publish_share_percent : null,
    settlement_remark: (values.settlement_remark || "").trim() || null,
  };
}

export function GameVariantFormFields({ form, projects }: { form: FormInstance; projects: Project[] }) {
  return (
    <Form
      form={form}
      layout="vertical"
      onValuesChange={(changedValues) => {
        if (Object.prototype.hasOwnProperty.call(changedValues, "rd_share_percent")) {
          const rd = changedValues.rd_share_percent as number | null | undefined;
          if (typeof rd === "number") {
            form.setFieldValue("publish_share_percent", Number((100 - rd).toFixed(2)));
          } else {
            form.setFieldValue("publish_share_percent", undefined);
          }
        }
      }}
    >
      <Form.Item name="project_id" label="所属项目" rules={[{ required: true, message: "请选择项目" }]}>
        <Select
          placeholder="选择项目"
          options={projects.map((p) => ({
            label: `${p.name}${p.status !== "active" ? "（暂停）" : ""}`,
            value: p.id,
          }))}
          showSearch
          optionFilterProp="label"
        />
      </Form.Item>
      <Form.Item name="variant_name" label="版本名称" rules={[{ required: true, message: "例如：005折混服" }]}>
        <Input placeholder="如：005折混服" />
      </Form.Item>
      <Form.Item
        name="raw_game_name"
        label="原始游戏名"
        rules={[{ required: true, message: "与导入/对账中的 game_name 一致，如：一起来修仙005折混服" }]}
      >
        <Input placeholder="与流水中的游戏名称一致" />
      </Form.Item>
      <Form.Item name="discount_type" label="折扣类型" rules={[{ required: true }]}>
        <Select options={DISCOUNT_OPTIONS} />
      </Form.Item>
      <Form.Item name="version_type" label="版本类型" rules={[{ required: true }]}>
        <Select options={VERSION_OPTIONS} />
      </Form.Item>
      <Form.Item name="server_type" label="服类型" rules={[{ required: true }]}>
        <Select options={SERVER_OPTIONS} />
      </Form.Item>
      <Form.Item name="status" label="启用" valuePropName="checked" initialValue>
        <Switch />
      </Form.Item>
      <Form.Item name="rd_company" label="研发主体">
        <Input placeholder="可为空" />
      </Form.Item>
      <Form.Item name="publish_company" label="发行主体" initialValue="广州熊动科技有限公司">
        <Input placeholder="默认：广州熊动科技有限公司" />
      </Form.Item>
      <Form.Item
        name="rd_share_percent"
        label="研发分成(%)"
        rules={[
          {
            validator: (_, value: number | undefined) => {
              if (value == null) return Promise.resolve();
              if (value >= 0 && value <= 100) return Promise.resolve();
              return Promise.reject(new Error("研发分成需在 0~100 之间"));
            },
          },
        ]}
      >
        <InputNumber min={0} max={100} step={0.01} precision={2} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="publish_share_percent" label="发行分成(%)">
        <InputNumber min={0} max={100} step={0.01} precision={2} style={{ width: "100%" }} disabled />
      </Form.Item>
      <Form.Item name="settlement_remark" label="结算备注">
        <Input.TextArea rows={2} placeholder="可为空" />
      </Form.Item>
      <Form.Item name="remark" label="备注">
        <Input.TextArea rows={2} placeholder="可选" />
      </Form.Item>
    </Form>
  );
}
