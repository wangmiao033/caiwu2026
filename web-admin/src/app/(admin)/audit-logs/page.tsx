"use client";

import { useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Space, Table, message } from "antd";
import dayjs from "dayjs";
import { apiRequest } from "@/lib/api";

type AuditRow = {
  id: number;
  operator: string;
  action: string;
  target_type: string;
  target_id: string;
  summary: string;
  created_at: string;
};

type AuditListResp = {
  items: AuditRow[];
  total: number;
  page: number;
  page_size: number;
};

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [operator, setOperator] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");

  const load = async (nextPage = page) => {
    try {
      const p = new URLSearchParams();
      p.set("page", String(nextPage));
      p.set("page_size", "20");
      if (operator) p.set("operator", operator);
      if (action) p.set("action", action);
      if (targetType) p.set("target_type", targetType);
      if (startTime) p.set("start_time", startTime);
      if (endTime) p.set("end_time", endTime);
      const data = await apiRequest<AuditListResp>(`/audit/logs?${p.toString()}`);
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  return (
    <Card
      title="系统操作审计日志"
      extra={
        <Space>
          <Input placeholder="操作人" value={operator} onChange={(e) => setOperator(e.target.value)} />
          <Input placeholder="动作" value={action} onChange={(e) => setAction(e.target.value)} />
          <Input placeholder="对象类型" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
          <DatePicker
            showTime
            placeholder="开始时间"
            value={startTime ? dayjs(startTime) : null}
            onChange={(v) => setStartTime(v ? v.toISOString() : "")}
          />
          <DatePicker
            showTime
            placeholder="结束时间"
            value={endTime ? dayjs(endTime) : null}
            onChange={(v) => setEndTime(v ? v.toISOString() : "")}
          />
          <Button type="primary" onClick={() => load(1)}>
            查询
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => load(p) }}
        columns={[
          { title: "操作人", dataIndex: "operator", width: 120 },
          { title: "动作", dataIndex: "action", width: 180 },
          { title: "对象类型", dataIndex: "target_type", width: 130 },
          { title: "对象ID", dataIndex: "target_id", width: 120 },
          { title: "摘要", dataIndex: "summary" },
          { title: "时间", dataIndex: "created_at", width: 180 },
        ]}
      />
    </Card>
  );
}

