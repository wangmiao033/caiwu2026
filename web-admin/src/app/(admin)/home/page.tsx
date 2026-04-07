"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Result, Row, Segmented, Skeleton, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { Line } from "@ant-design/charts";
import dayjs from "dayjs";
import { DashboardOverview, DashboardRange, getDashboardOverview } from "@/lib/api/dashboard";

type KpiItem = {
  key: string;
  title: string;
  value: number;
  mom: number;
};

type TrendPoint = DashboardOverview["trends"][number];

type AlertRow = {
  key: string;
  type: string;
  count: number;
  detail: string;
  to: string;
};

type ActionLogRow = {
  key: string;
  operator: string;
  actionType: string;
  time: string;
  detail: string;
};

const formatMoney = (value: number) =>
  `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

const formatMom = (mom: number) => {
  if (mom === 0) return "环比 0%";
  const absPercent = `${Math.abs(mom).toFixed(1)}%`;
  return mom > 0 ? `环比 ↑ ${absPercent}` : `环比 ↓ ${absPercent}`;
};

export default function HomePage() {
  const router = useRouter();
  const [range, setRange] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);

  const fetchOverview = async (nextRange: 7 | 30) => {
    setLoading(true);
    setErrorText("");
    try {
      const apiRange: DashboardRange = nextRange === 7 ? "7d" : "30d";
      const data = await getDashboardOverview(apiRange);
      setOverview(data);
    } catch (error) {
      const msg = (error as Error).message || "获取首页数据失败";
      setErrorText(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview(range);
  }, [range]);

  const kpis: KpiItem[] = useMemo(
    () => [
      { key: "flow", title: "本月总流水", value: Number(overview?.summary.monthly_gross_revenue || 0), mom: Number(overview?.summary_compare.monthly_gross_revenue || 0) },
      { key: "received", title: "本月渠道回款", value: Number(overview?.summary.monthly_channel_receipts || 0), mom: Number(overview?.summary_compare.monthly_channel_receipts || 0) },
      { key: "rdPayable", title: "本月应付研发", value: Number(overview?.summary.monthly_rd_payable || 0), mom: Number(overview?.summary_compare.monthly_rd_payable || 0) },
      { key: "grossProfit", title: "本月毛利润", value: Number(overview?.summary.monthly_gross_profit || 0), mom: Number(overview?.summary_compare.monthly_gross_profit || 0) },
      { key: "unsettled", title: "未结算金额", value: Number(overview?.summary.unsettled_amount || 0), mom: Number(overview?.summary_compare.unsettled_amount || 0) },
      { key: "abnormalBills", title: "异常账单数量", value: Number(overview?.summary.exception_bill_count || 0), mom: Number(overview?.summary_compare.exception_bill_count || 0) },
    ],
    [overview]
  );

  const trendData: TrendPoint[] = useMemo(
    () => (overview?.trends || []).map((item) => ({ ...item, date: dayjs(item.date).format("MM-DD") })),
    [overview]
  );

  const abnormalRows: AlertRow[] = useMemo(
    () => [
      { key: "share", type: "分成异常", count: Number(overview?.exceptions.share || 0), detail: "合计不等于100%", to: "/exceptions?type=share&status=pending&range=30d" },
      { key: "channel", type: "未匹配渠道", count: Number(overview?.exceptions.channel || 0), detail: "导入记录中存在渠道未映射", to: "/exceptions?type=channel&status=pending&range=30d" },
      { key: "game", type: "未匹配游戏", count: Number(overview?.exceptions.game || 0), detail: "导入记录中存在游戏未匹配版本", to: "/exceptions?type=game&status=pending&range=30d" },
      { key: "importFail", type: "导入失败记录", count: Number(overview?.exceptions.import || 0), detail: "导入失败记录需复核", to: "/exceptions?type=import&status=pending&range=30d" },
      { key: "overdue", type: "超期未结算", count: Number(overview?.exceptions.overdue || 0), detail: "超过约定结算周期", to: "/exceptions?type=overdue&status=pending&range=30d" },
    ],
    [overview]
  );

  const quickActions = [
    { key: "newImport", text: "新建导入", to: "/import" },
    { key: "importHistory", text: "查看导入历史", to: "/import?tab=history" },
    { key: "rules", text: "配置分成规则", to: "/billing-rules" },
    { key: "mapping", text: "渠道映射", to: "/channel-game-map" },
    { key: "billing", text: "账单列表", to: "/billing" },
  ];

  const recentLogs: ActionLogRow[] = useMemo(
    () =>
      (overview?.recent_activities || []).map((item) => ({
        key: String(item.id),
        operator: item.operator || "-",
        actionType: item.action_type || "-",
        time: item.created_at ? dayjs(item.created_at).format("YYYY-MM-DD HH:mm") : "-",
        detail: item.detail || "-",
      })),
    [overview]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorText ? (
        <Result
          status="warning"
          title="首页数据加载失败"
          subTitle={errorText}
          extra={
            <Button type="primary" onClick={() => fetchOverview(range)}>
              重试
            </Button>
          }
        />
      ) : null}

      <Alert type="info" showIcon message="首页已接入真实后端统计数据" description="支持 7天/30天 切换并实时刷新核心指标、趋势、异常与最近操作。" />

      <Row gutter={[16, 16]}>
        {kpis.map((item) => (
          <Col key={item.key} xs={24} sm={12} lg={8} xl={8}>
            <Card>
              {loading ? (
                <Skeleton active paragraph={{ rows: 1 }} title={false} />
              ) : (
                <>
                  <Statistic title={item.title} value={item.value} formatter={(value) => formatMoney(Number(value || 0))} />
                  <Typography.Text type={item.mom >= 0 ? "success" : "danger"}>{formatMom(item.mom)}</Typography.Text>
                </>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="金额趋势"
        extra={
          <Segmented
            value={range}
            options={[
              { label: "最近7天", value: 7 },
              { label: "最近30天", value: 30 },
            ]}
            onChange={(value) => setRange(value as 7 | 30)}
          />
        }
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} title={false} />
        ) : (
          <Line
            data={trendData}
            xField="date"
            yField="amount"
            colorField="type"
            axis={{
              y: {
                labelFormatter: (value: string) => formatMoney(Number(value || 0)),
              },
            }}
            tooltip={{
              items: [{ channel: "y", valueFormatter: (value: string | number) => formatMoney(Number(value || 0)) }],
            }}
            smooth
            height={320}
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="异常提醒">
            <Table
              rowKey="key"
              dataSource={abnormalRows}
              size="small"
              loading={loading}
              pagination={false}
              columns={[
                { title: "类型", dataIndex: "type", width: 120 },
                { title: "数量", dataIndex: "count", width: 80, render: (value: number) => <Tag color={value > 0 ? "red" : "green"}>{value}</Tag> },
                { title: "说明", dataIndex: "detail" },
                {
                  title: "操作",
                  width: 100,
                  render: (_, row) => (
                    <Button type="link" onClick={() => router.push(row.to)}>
                      去处理
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="快捷入口">
            <Space wrap>
              {quickActions.map((item) => (
                <Button key={item.key} type="default" onClick={() => router.push(item.to)}>
                  {item.text}
                </Button>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title="最近操作记录">
        <Table
          rowKey="key"
          dataSource={recentLogs}
          size="small"
          loading={loading}
          pagination={false}
          columns={[
            { title: "操作人", dataIndex: "operator", width: 120 },
            { title: "操作类型", dataIndex: "actionType", width: 120 },
            { title: "时间", dataIndex: "time", width: 170 },
            { title: "详情", dataIndex: "detail" },
          ]}
        />
      </Card>
    </Space>
  );
}
