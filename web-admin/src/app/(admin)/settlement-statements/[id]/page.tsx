"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Descriptions, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";

type Item = {
  id: number;
  sort_no: number;
  game_name: string;
  gross_revenue: number | string;
  test_fee: number | string;
  coupon_fee: number | string;
  participation_amount: number | string;
  revenue_share_ratio: number | string;
  channel_fee_ratio: number | string;
  settlement_amount: number | string;
};

type Detail = {
  id: number;
  statement_no: string;
  settlement_month: string;
  channel_name: string;
  statement_title: string;
  our_company_name: string;
  our_company_address: string;
  our_company_phone: string;
  our_tax_no: string;
  our_bank_name: string;
  our_bank_account: string;
  opposite_company_name: string;
  opposite_tax_no: string;
  opposite_bank_name: string;
  opposite_bank_account: string;
  total_gross_revenue: number | string;
  total_test_fee: number | string;
  total_coupon_fee: number | string;
  total_participation_amount: number | string;
  total_settlement_amount: number | string;
  total_settlement_amount_cn: string;
  statement_status: string;
  remark: string;
  items: Item[];
};

function amt(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function ratioPct(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
}

async function downloadMonthlyExport(id: number, channelName: string, month: string) {
  const token = localStorage.getItem("access_token") || "";
  const xRole = localStorage.getItem("x_role") || "";
  const xUser = localStorage.getItem("x_user") || "";
  const resp = await fetch(`/api/proxy/monthly-settlement-statements/${id}/export-excel`, {
    method: "GET",
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "x-role": xRole,
      "x-user": xUser,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    try {
      const j = JSON.parse(text) as { detail?: string };
      throw new Error(j.detail || "导出失败");
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(text || "导出失败");
    }
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `渠道月度结算对账单_${channelName}_${month}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MonthlySettlementStatementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Detail | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      message.error("无效的账单 ID");
      return;
    }
    setLoading(true);
    apiRequest<Detail>(`/monthly-settlement-statements/${id}`)
      .then(setData)
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const columns: ColumnsType<Item> = useMemo(
    () => [
      { title: "序号", dataIndex: "sort_no", width: 64 },
      { title: "游戏", dataIndex: "game_name", width: 160, ellipsis: true },
      { title: "流水", render: (_, r) => amt(r.gross_revenue) },
      { title: "测试费", render: (_, r) => amt(r.test_fee) },
      { title: "代金券", render: (_, r) => amt(r.coupon_fee) },
      { title: "可参与分成", render: (_, r) => amt(r.participation_amount) },
      { title: "分成比例", render: (_, r) => ratioPct(r.revenue_share_ratio) },
      { title: "渠道费比例", render: (_, r) => ratioPct(r.channel_fee_ratio) },
      { title: "结算金额", render: (_, r) => amt(r.settlement_amount) },
    ],
    []
  );

  if (!data && loading) {
    return <Typography.Paragraph>加载中…</Typography.Paragraph>;
  }
  if (!data) {
    return <Typography.Paragraph>未找到账单</Typography.Paragraph>;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/settlement-statements")}>
          返回列表
        </Button>
        <Button
          type="primary"
          onClick={() =>
            void downloadMonthlyExport(data.id, data.channel_name, data.settlement_month).catch((e) =>
              message.error((e as Error).message)
            )
          }
        >
          导出 Excel
        </Button>
      </Space>
      <Card loading={loading} title={data.statement_title}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="账单编号">{data.statement_no}</Descriptions.Item>
          <Descriptions.Item label="账期">{data.settlement_month}</Descriptions.Item>
          <Descriptions.Item label="渠道">{data.channel_name}</Descriptions.Item>
          <Descriptions.Item label="状态">{data.statement_status}</Descriptions.Item>
          <Descriptions.Item label="流水合计">{amt(data.total_gross_revenue)}</Descriptions.Item>
          <Descriptions.Item label="测试费合计">{amt(data.total_test_fee)}</Descriptions.Item>
          <Descriptions.Item label="代金券合计">{amt(data.total_coupon_fee)}</Descriptions.Item>
          <Descriptions.Item label="可参与分成合计">{amt(data.total_participation_amount)}</Descriptions.Item>
          <Descriptions.Item label="结算金额合计">{amt(data.total_settlement_amount)}</Descriptions.Item>
          <Descriptions.Item label="大写金额" span={2}>
            <Typography.Text strong>{data.total_settlement_amount_cn}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        <Typography.Title level={5}>明细</Typography.Title>
        <Table<Item> rowKey="id" dataSource={data.items || []} columns={columns} pagination={false} scroll={{ x: 1100 }} />
        <Typography.Title level={5} style={{ marginTop: 24 }}>
          甲乙双方信息
        </Typography.Title>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="甲方（名称）">{data.our_company_name}</Descriptions.Item>
          <Descriptions.Item label="甲方地址">{data.our_company_address || "—"}</Descriptions.Item>
          <Descriptions.Item label="甲方电话">{data.our_company_phone || "—"}</Descriptions.Item>
          <Descriptions.Item label="甲方税号">{data.our_tax_no || "—"}</Descriptions.Item>
          <Descriptions.Item label="甲方开户行/账号">
            {data.our_bank_name} {data.our_bank_account}
          </Descriptions.Item>
          <Descriptions.Item label="乙方（名称）">{data.opposite_company_name}</Descriptions.Item>
          <Descriptions.Item label="乙方税号">{data.opposite_tax_no || "—"}</Descriptions.Item>
          <Descriptions.Item label="乙方开户行">{data.opposite_bank_name || "—"}</Descriptions.Item>
          <Descriptions.Item label="乙方账号">{data.opposite_bank_account || "—"}</Descriptions.Item>
        </Descriptions>
        <Typography.Title level={5} style={{ marginTop: 24 }}>
          备注
        </Typography.Title>
        <Typography.Paragraph>{data.remark?.trim() || "—"}</Typography.Paragraph>
      </Card>
    </Space>
  );
}
