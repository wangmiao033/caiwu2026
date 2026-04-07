"use client";

import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Typography } from "antd";
import { apiRequest } from "@/lib/api";

type FinanceData = {
  total_receivable: number;
  total_received: number;
  outstanding: number;
};

export default function HomePage() {
  const [data, setData] = useState<FinanceData>({ total_receivable: 0, total_received: 0, outstanding: 0 });

  useEffect(() => {
    apiRequest<FinanceData>("/dashboard/finance")
      .then(setData)
      .catch(() => {});
  }, []);

  return (
    <Row gutter={16}>
      <Col span={8}>
        <Card>
          <Statistic title="应收总额" value={data.total_receivable || 0} precision={2} />
        </Card>
      </Col>
      <Col span={8}>
        <Card>
          <Statistic title="已收总额" value={data.total_received || 0} precision={2} />
        </Card>
      </Col>
      <Col span={8}>
        <Card>
          <Statistic title="未收总额" value={data.outstanding || 0} precision={2} />
        </Card>
      </Col>
      <Col span={24} style={{ marginTop: 16 }}>
        <Card>
          <Typography.Title level={5}>系统说明</Typography.Title>
          <Typography.Paragraph type="secondary">
            本系统对接 FastAPI 对账接口，支持导入核对、账单处理、开票和回款管理。
          </Typography.Paragraph>
        </Card>
      </Col>
    </Row>
  );
}
