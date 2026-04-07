"use client";

import { useState } from "react";
import { Button, Card, Col, Row, Statistic } from "antd";
import { Column } from "@ant-design/charts";
import { apiRequest } from "@/lib/api";

type FinanceRes = {
  total_receivable: number;
  total_received: number;
  outstanding: number;
  status_breakdown?: Record<string, number>;
};

export default function FinancePage() {
  const [data, setData] = useState<FinanceRes>({ total_receivable: 0, total_received: 0, outstanding: 0, status_breakdown: {} });

  const load = async () => {
    const d = await apiRequest<FinanceRes>("/dashboard/finance");
    setData(d);
  };

  const chartData = Object.entries(data.status_breakdown || {}).map(([name, value]) => ({ name, value }));

  return (
    <>
      <Button type="primary" onClick={load} style={{ marginBottom: 16 }}>
        刷新数据
      </Button>
      <Row gutter={16}>
        <Col span={8}><Card><Statistic title="应收" value={data.total_receivable || 0} precision={2} /></Card></Col>
        <Col span={8}><Card><Statistic title="已收" value={data.total_received || 0} precision={2} /></Card></Col>
        <Col span={8}><Card><Statistic title="未收" value={data.outstanding || 0} precision={2} /></Card></Col>
      </Row>
      <Card title="回款状态分布" style={{ marginTop: 16 }}>
        <Column data={chartData} xField="name" yField="value" />
      </Card>
    </>
  );
}
