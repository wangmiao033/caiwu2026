"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Col, Empty, Row, Statistic, Table, Typography, message } from "antd";
import { apiRequest } from "@/lib/api";

type FinanceData = {
  total_receivable: number;
  total_received: number;
  outstanding: number;
  pending_bills?: Array<{ bill_id: number; period: string }>;
};
type BillRow = { id: number; target_name: string; period: string; amount: number; status: string };
type TaskRow = { id: number; period: string; status: string };

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<FinanceData>({ total_receivable: 0, total_received: 0, outstanding: 0 });
  const [bills, setBills] = useState<BillRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [todo, setTodo] = useState({ unresolvedIssues: 0, needInvoice: 0, needReceipt: 0, overdueBills: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [finance, billList, taskList] = await Promise.all([
          apiRequest<FinanceData>("/dashboard/finance"),
          apiRequest<Array<BillRow & { invoice_status?: string; outstanding_amount?: number; period: string }>>("/billing/bills"),
          apiRequest<TaskRow[]>("/recon/tasks"),
        ]);
        setData(finance);
        setBills(billList.slice(0, 5));
        setTasks(taskList.slice(0, 5));
        const nowPeriod = new Date().toISOString().slice(0, 7);
        setTodo({
          unresolvedIssues: taskList.filter((x) => x.status === "异常待处理").length,
          needInvoice: billList.filter((x) => x.invoice_status !== "已开票").length,
          needReceipt: billList.filter((x) => Number(x.outstanding_amount || 0) > 0).length,
          overdueBills: billList.filter((x) => Number(x.outstanding_amount || 0) > 0 && x.period < nowPeriod).length,
        });
      } catch (e) {
        message.error((e as Error).message);
      }
    })();
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
          <Typography.Title level={5}>待处理事项</Typography.Title>
          <Row gutter={12}>
            <Col span={12}><Card hoverable onClick={() => router.push("/recon-tasks?status=异常待处理")}><Statistic title="未处理异常数" value={todo.unresolvedIssues} /></Card></Col>
            <Col span={12}><Card hoverable onClick={() => router.push("/billing?keyword=待开票")}><Statistic title="待开票账单数" value={todo.needInvoice} /></Card></Col>
            <Col span={12} style={{ marginTop: 12 }}><Card hoverable onClick={() => router.push("/billing?keyword=待回款")}><Statistic title="未回款账单数" value={todo.needReceipt} /></Card></Col>
            <Col span={12} style={{ marginTop: 12 }}><Card hoverable onClick={() => router.push("/finance")}><Statistic title="逾期账单数" value={todo.overdueBills} /></Card></Col>
          </Row>
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
            locale={{ emptyText: <Empty description="暂无账单数据" /> }}
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
            locale={{ emptyText: <Empty description="暂无导入任务" /> }}
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
