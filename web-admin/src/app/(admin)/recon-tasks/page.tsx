"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Drawer, Empty, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type TaskRow = {
  id: number;
  period: string;
  status: string;
};
type IssueRow = {
  issue_id: number;
  task_id: number;
  issue_type: string;
  message: string;
  status: string;
  row_no?: number | null;
  raw_data?: Record<string, unknown> | null;
};

export default function ReconTasksPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [taskId, setTaskId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<TaskRow[]>("/recon/tasks");
      setRows(data);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const fromTask = searchParams.get("task_id");
    if (fromTask) {
      setKeyword(fromTask);
    }
  }, [searchParams]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          `${r.id}${r.period}${r.status}`.includes(keyword) &&
          (!period || r.period.includes(period)) &&
          (!status || r.status === status)
      ),
    [rows, keyword, period, status]
  );
  const confirmTask = (id: number) => {
    Modal.confirm({
      title: "确认账期",
      content: `确认任务 ${id} 后将进入后续账单流程，建议先完成异常处理并复核后再确认。`,
      onOk: async () => {
        try {
          await apiRequest(`/recon/${id}/confirm`, "POST");
          message.success("确认成功");
          await load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };
  const loadIssues = async (id: number) => {
    try {
      const data = await apiRequest<IssueRow[]>(`/recon/issues?task_id=${id}`);
      setIssues(data);
      setTaskId(id);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const resolveIssue = async (id: number) => {
    try {
      await apiRequest(`/recon/issues/${id}/resolve`, "POST");
      if (taskId) await loadIssues(taskId);
      await load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Card
      title="核对任务"
      extra={
        <Space>
          <Input placeholder="搜索任务" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Input placeholder="按账期筛选" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 150 }}
            options={[
              { label: "待确认", value: "待确认" },
              { label: "异常待处理", value: "异常待处理" },
              { label: "已确认", value: "已确认" },
            ]}
            value={status || undefined}
            onChange={(v) => setStatus(v || "")}
          />
          <Button onClick={load}>刷新</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="暂无核对任务" /> }}
        columns={[
          { title: "任务ID", dataIndex: "id" },
          { title: "账期", dataIndex: "period" },
          {
            title: "状态",
            dataIndex: "status",
            render: (v: string) => {
              const color = v === "异常待处理" ? "red" : v === "已确认" ? "green" : "gold";
              return <Tag color={color}>{v}</Tag>;
            },
          },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => loadIssues(r.id)}>
                  异常明细
                </Button>
                <Button size="small" disabled={r.status === "已确认"} onClick={() => confirmTask(r.id)}>
                  确认账期
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer open={!!taskId} onClose={() => setTaskId(null)} title={`任务异常明细 #${taskId || ""}`} width={720}>
        <Table
          rowKey="issue_id"
          dataSource={issues}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: <Empty description="该任务暂无异常明细" /> }}
          columns={[
            { title: "异常ID", dataIndex: "issue_id", width: 90 },
            { title: "类型", dataIndex: "issue_type", width: 130 },
            { title: "明细", dataIndex: "message" },
            { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "已处理" ? "green" : "red"}>{v || "未处理"}</Tag> },
            {
              title: "操作",
              render: (_, r) => (
                <Button size="small" disabled={r.status === "已处理"} onClick={() => resolveIssue(r.issue_id)}>
                  标记已处理
                </Button>
              ),
            },
          ]}
        />
      </Drawer>
    </Card>
  );
}
