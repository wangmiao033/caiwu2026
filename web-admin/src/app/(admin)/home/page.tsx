"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Row, Segmented, Space, Statistic, Table, Tag, Typography } from "antd";
import { Line } from "@ant-design/charts";
import dayjs from "dayjs";

type KpiItem = {
  key: string;
  title: string;
  value: number;
  mom: number;
};

type TrendPoint = {
  date: string;
  type: "流水" | "回款" | "利润";
  amount: number;
};

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

const createMockTrend = (days: number): TrendPoint[] => {
  const rows: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = dayjs().subtract(i, "day").format("MM-DD");
    const dailyFlow = 130000 + (days - i) * 2800 + (i % 3) * 3800;
    const dailyReceived = dailyFlow * 0.84;
    const dailyProfit = dailyReceived - dailyFlow * 0.26;
    rows.push({ date, type: "流水", amount: Number(dailyFlow.toFixed(2)) });
    rows.push({ date, type: "回款", amount: Number(dailyReceived.toFixed(2)) });
    rows.push({ date, type: "利润", amount: Number(dailyProfit.toFixed(2)) });
  }
  return rows;
};

export default function HomePage() {
  const router = useRouter();
  const [range, setRange] = useState<7 | 30>(7);

  const kpis: KpiItem[] = [
    { key: "flow", title: "本月总流水", value: 3860000, mom: 8.4 },
    { key: "received", title: "本月渠道回款", value: 3174000, mom: 6.1 },
    { key: "rdPayable", title: "本月应付研发", value: 1012000, mom: -2.7 },
    { key: "grossProfit", title: "本月毛利润", value: 2162000, mom: 11.3 },
    { key: "unsettled", title: "未结算金额", value: 628500, mom: -4.6 },
    { key: "abnormalBills", title: "异常账单数量", value: 19, mom: 15.2 },
  ];

  const trendData = useMemo(() => createMockTrend(range), [range]);

  const abnormalRows: AlertRow[] = [
    { key: "share", type: "分成异常", count: 6, detail: "合计不等于100%", to: "/exceptions?type=share" },
    { key: "channel", type: "未匹配渠道", count: 4, detail: "导入记录中存在渠道未映射", to: "/exceptions?type=channel" },
    { key: "game", type: "未匹配游戏", count: 9, detail: "导入记录中存在游戏未匹配版本", to: "/exceptions?type=game" },
    { key: "importFail", type: "导入失败记录", count: 3, detail: "近7天导入失败需复核", to: "/exceptions?type=import" },
    { key: "overdue", type: "超期未结算", count: 7, detail: "超过约定结算周期", to: "/exceptions?type=overdue" },
  ];

  const quickActions = [
    { key: "newImport", text: "新建导入", to: "/import" },
    { key: "importHistory", text: "查看导入历史", to: "/import?tab=history" },
    { key: "rules", text: "配置分成规则", to: "/billing-rules" },
    { key: "mapping", text: "渠道映射", to: "/channel-game-map" },
    { key: "billing", text: "账单列表", to: "/billing" },
  ];

  const recentLogs: ActionLogRow[] = [
    { key: "1", operator: "财务A", actionType: "导入记录", time: "2026-04-07 10:21", detail: "导入2026-03渠道流水，新增122行" },
    { key: "2", operator: "运营B", actionType: "修改规则", time: "2026-04-07 09:43", detail: "调整 渠道X-游戏Y 研发分成为45%" },
    { key: "3", operator: "财务A", actionType: "修改渠道映射", time: "2026-04-06 18:32", detail: "新增 渠道M -> 游戏N 映射" },
    { key: "4", operator: "财务C", actionType: "导入记录", time: "2026-04-06 16:05", detail: "导入2026-03补充流水，更新54行" },
    { key: "5", operator: "运营B", actionType: "修改规则", time: "2026-04-06 11:27", detail: "修正税点为3%" },
    { key: "6", operator: "财务A", actionType: "导入记录", time: "2026-04-05 19:10", detail: "导入失败3行，已导出异常并修复" },
    { key: "7", operator: "财务C", actionType: "修改渠道映射", time: "2026-04-05 15:44", detail: "补充未匹配渠道2条" },
    { key: "8", operator: "运营D", actionType: "修改规则", time: "2026-04-04 17:19", detail: "新增 游戏Z 渠道分成规则" },
    { key: "9", operator: "财务A", actionType: "导入记录", time: "2026-04-04 10:56", detail: "导入2026-04首批流水" },
    { key: "10", operator: "财务C", actionType: "修改规则", time: "2026-04-03 14:08", detail: "批量更新私点比例" },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="当前为 Dashboard Mock 数据展示版"
        description="后续后端提供统计接口后，可直接替换 mock 数据源。"
      />

      <Row gutter={[16, 16]}>
        {kpis.map((item) => (
          <Col key={item.key} xs={24} sm={12} lg={8} xl={8}>
            <Card>
              <Statistic title={item.title} value={item.value} formatter={(value) => formatMoney(Number(value || 0))} />
              <Typography.Text type={item.mom >= 0 ? "success" : "danger"}>{formatMom(item.mom)}</Typography.Text>
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
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="异常提醒">
            <Table
              rowKey="key"
              dataSource={abnormalRows}
              size="small"
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
