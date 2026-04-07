"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type TaskRow = {
  id: number;
  period: string;
  status: string;
};

export default function ReconTasksPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [keyword, setKeyword] = useState("");

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
  }, []);

  const filtered = useMemo(() => rows.filter((r) => `${r.id}${r.period}${r.status}`.includes(keyword)), [rows, keyword]);
  const confirmTask = (id: number) => {
    Modal.confirm({
      title: "确认账期",
      content: `确认任务 ${id} 吗？确认前请确保异常均已处理。`,
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

  return (
    <Card
      title="核对任务"
      extra={
        <Space>
          <Input placeholder="搜索任务" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={load}>刷新</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
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
              <Button size="small" disabled={r.status === "已确认"} onClick={() => confirmTask(r.id)}>
                确认账期
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
