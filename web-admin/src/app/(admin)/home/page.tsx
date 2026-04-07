"use client";

import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Table, Typography } from "antd";
import { apiRequest } from "@/lib/api";

type FinanceData = {
  total_receivable: number;
  total_received: number;
  outstanding: number;
};
type BillRow = { id: number; target_name: string; period: string; amount: number; status: string };
type TaskRow = { id: number; period: string; status: string };

export default function HomePage() {
  const [data, setData] = useState<FinanceData>({ total_receivable: 0, total_received: 0, outstanding: 0 });
  const [bills, setBills] = useState<BillRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    apiRequest<FinanceData>("/dashboard/finance")
      .then(setData)
      .catch(() => {});
    apiRequest<BillRow[]>("/billing/bills")
      .then((x) => setBills(x.slice(0, 5)))
      .catch(() => {});
    apiRequest<TaskRow[]>("/recon/tasks")
      .then((x) => setTasks(x.slice(0, 5)))
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
      <Col span={12} style={{ marginTop: 16 }}>
        <Card>
          <Typography.Title level={5}>最近账单</Typography.Title>
          <Table
            size="small"
            rowKey="id"
            dataSource={bills}
            pagination={false}
            columns={[
              { title: "ID", dataIndex: "id", width: 70 },
              { title: "对象", dataIndex: "target_name" },
              { title: "账期", dataIndex: "period" },
              { title: "状态", dataIndex: "status" },
            ]}
          />
        </Card>
      </Col>
      <Col span={12} style={{ marginTop: 16 }}>
        <Card>
          <Typography.Title level={5}>最近导入任务</Typography.Title>
          <Table
            size="small"
            rowKey="id"
            dataSource={tasks}
            pagination={false}
            columns={[
              { title: "任务ID", dataIndex: "id", width: 90 },
              { title: "账期", dataIndex: "period" },
              { title: "状态", dataIndex: "status" },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
