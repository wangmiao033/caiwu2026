"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Col, Modal, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";

type ExceptionType = "share" | "channel" | "game" | "import" | "overdue";
type ExceptionStatus = "待处理" | "已忽略" | "已解决";
type DayRange = 7 | 30 | 90;

type ExceptionRow = {
  id: string;
  type: ExceptionType;
  status: ExceptionStatus;
  createdAt: string;
  batch?: string;
  channel?: string;
  game?: string;
  channelFee?: number;
  taxRate?: number;
  rdShare?: number;
  privateRate?: number;
  publishShare?: number;
  totalShare?: number;
  reason?: string;
  failedCount?: number;
  amount?: number;
  overdueDays?: number;
};

const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  share: "分成异常",
  channel: "未匹配渠道",
  game: "未匹配游戏",
  import: "导入失败",
  overdue: "超期未结算",
};

const STATUS_COLOR: Record<ExceptionStatus, string> = {
  待处理: "red",
  已忽略: "default",
  已解决: "green",
};

const formatPercent = (ratio: number) => `${Number((ratio * 100).toFixed(4)).toString()}%`;
const formatMoney = (value: number) => `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

const mockRows: ExceptionRow[] = [
  { id: "s1", type: "share", status: "待处理", createdAt: "2026-04-07 10:24", channel: "渠道A", game: "游戏甲", channelFee: 0.2, taxRate: 0.03, rdShare: 0.5, privateRate: 0.05, publishShare: 0.3, totalShare: 1.08 },
  { id: "s2", type: "share", status: "待处理", createdAt: "2026-04-06 16:12", channel: "渠道B", game: "游戏乙", channelFee: 0.3, taxRate: 0.02, rdShare: 0.45, privateRate: 0.03, publishShare: 0.2, totalShare: 1.0 },
  { id: "c1", type: "channel", status: "待处理", createdAt: "2026-04-07 09:50", batch: "IMP-20260407-01", channel: "渠道_AA", reason: "系统中未找到对应渠道映射" },
  { id: "c2", type: "channel", status: "已忽略", createdAt: "2026-04-05 14:32", batch: "IMP-20260405-03", channel: "渠道_临时", reason: "测试导入数据" },
  { id: "g1", type: "game", status: "待处理", createdAt: "2026-04-07 11:03", batch: "IMP-20260407-02", game: "一起来修仙005折混服", reason: "未匹配到版本" },
  { id: "g2", type: "game", status: "已解决", createdAt: "2026-04-04 18:15", batch: "IMP-20260404-01", game: "游戏未命名", reason: "已补齐版本并重匹配" },
  { id: "i1", type: "import", status: "待处理", createdAt: "2026-04-06 09:08", batch: "IMP-20260406-01", reason: "模板字段缺失", failedCount: 12 },
  { id: "i2", type: "import", status: "待处理", createdAt: "2026-04-03 13:20", batch: "IMP-20260403-02", reason: "账期格式非法", failedCount: 4 },
  { id: "o1", type: "overdue", status: "待处理", createdAt: "2026-04-07 08:22", channel: "渠道C", game: "游戏丙", amount: 216000, overdueDays: 14, batch: "2026-03" },
  { id: "o2", type: "overdue", status: "已解决", createdAt: "2026-03-30 11:40", channel: "渠道D", game: "游戏丁", amount: 98000, overdueDays: 5, batch: "2026-03" },
];

const diffDays = (dateText: string) => Math.floor((Date.now() - new Date(dateText.replace(" ", "T")).getTime()) / 86400000);

export default function ExceptionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryType = searchParams.get("type");
  const initialType = queryType && ["share", "channel", "game", "import", "overdue"].includes(queryType) ? (queryType as ExceptionType) : "all";

  const [typeFilter, setTypeFilter] = useState<"all" | ExceptionType>(initialType);
  const [range, setRange] = useState<DayRange>(30);
  const [statusFilter, setStatusFilter] = useState<"all" | ExceptionStatus>("all");
  const [rows, setRows] = useState<ExceptionRow[]>(mockRows);
  const [detail, setDetail] = useState<ExceptionRow | null>(null);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (typeFilter !== "all" && row.type !== typeFilter) return false;
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        return diffDays(row.createdAt) <= range;
      }),
    [rows, typeFilter, statusFilter, range]
  );

  const countByType = (type: ExceptionType) => filteredRows.filter((x) => x.type === type).length;

  const stats = useMemo(
    () => ({
      total: filteredRows.length,
      share: countByType("share"),
      channel: countByType("channel"),
      game: countByType("game"),
      import: countByType("import"),
      overdue: countByType("overdue"),
    }),
    [filteredRows]
  );

  const updateStatus = (id: string, status: ExceptionStatus) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));
    message.success(`已更新为${status}`);
  };

  const goHandle = (type: ExceptionType) => {
    if (type === "share") router.push("/billing-rules");
    if (type === "channel") router.push("/channel-game-map");
    if (type === "game") router.push("/game-variants");
    if (type === "import") router.push("/import?tab=history");
    if (type === "overdue") router.push("/billing");
  };

  const actionColumns = (type: ExceptionType) => ({
    title: "操作",
    width: 260,
    render: (_: unknown, row: ExceptionRow) => (
      <Space size={4}>
        <Button type="link" onClick={() => setDetail(row)}>
          查看详情
        </Button>
        <Button type="link" onClick={() => goHandle(type)}>
          去处理
        </Button>
        <Button type="link" onClick={() => updateStatus(row.id, "已解决")}>
          标记已解决
        </Button>
        <Button type="link" onClick={() => updateStatus(row.id, "已忽略")}>
          忽略
        </Button>
      </Space>
    ),
  });

  const statusColumn = {
    title: "状态",
    dataIndex: "status",
    width: 100,
    render: (value: ExceptionStatus) => <Tag color={STATUS_COLOR[value]}>{value}</Tag>,
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert type="warning" showIcon message="异常总览 + 待处理中心（Mock版）" description="当前页面仅使用前端 mock 数据，后续可直接接入后端异常中心接口。" />

      <Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8} lg={4}><Statistic title="总异常数" value={stats.total} /></Col>
          <Col xs={24} sm={8} lg={4}><Statistic title="分成异常数" value={stats.share} /></Col>
          <Col xs={24} sm={8} lg={4}><Statistic title="未匹配渠道数" value={stats.channel} /></Col>
          <Col xs={24} sm={8} lg={4}><Statistic title="未匹配游戏数" value={stats.game} /></Col>
          <Col xs={24} sm={8} lg={4}><Statistic title="导入失败数" value={stats.import} /></Col>
          <Col xs={24} sm={8} lg={4}><Statistic title="超期未结算数" value={stats.overdue} /></Col>
        </Row>
      </Card>

      <Card>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={[
              { label: "全部异常类型", value: "all" },
              { label: "分成异常", value: "share" },
              { label: "未匹配渠道", value: "channel" },
              { label: "未匹配游戏", value: "game" },
              { label: "导入失败", value: "import" },
              { label: "超期未结算", value: "overdue" },
            ]}
          />
          <Segmented
            value={range}
            onChange={(value) => setRange(value as DayRange)}
            options={[
              { label: "最近7天", value: 7 },
              { label: "最近30天", value: 30 },
              { label: "最近90天", value: 90 },
            ]}
          />
          <Select
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={[
              { label: "全部状态", value: "all" },
              { label: "待处理", value: "待处理" },
              { label: "已忽略", value: "已忽略" },
              { label: "已解决", value: "已解决" },
            ]}
          />
        </Space>
      </Card>

      <Card title="分成异常" extra={<Button onClick={() => router.push("/billing-rules")}>去规则配置</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={filteredRows.filter((x) => x.type === "share")}
          columns={[
            { title: "渠道", dataIndex: "channel" },
            { title: "游戏", dataIndex: "game" },
            { title: "通道费", dataIndex: "channelFee", render: (v: number) => formatPercent(v || 0) },
            { title: "税点", dataIndex: "taxRate", render: (v: number) => formatPercent(v || 0) },
            { title: "研发分成", dataIndex: "rdShare", render: (v: number) => formatPercent(v || 0) },
            { title: "私点", dataIndex: "privateRate", render: (v: number) => formatPercent(v || 0) },
            { title: "发行分成", dataIndex: "publishShare", render: (v: number) => formatPercent(v || 0) },
            { title: "合计", dataIndex: "totalShare", render: (v: number) => formatPercent(v || 0) },
            statusColumn,
            actionColumns("share"),
          ]}
        />
      </Card>

      <Card title="未匹配渠道" extra={<Button onClick={() => router.push("/channel-game-map")}>去渠道映射</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={filteredRows.filter((x) => x.type === "channel")}
          columns={[
            { title: "导入批次", dataIndex: "batch" },
            { title: "原始渠道名", dataIndex: "channel" },
            statusColumn,
            { title: "时间", dataIndex: "createdAt" },
            actionColumns("channel"),
          ]}
        />
      </Card>

      <Card title="未匹配游戏" extra={<Button onClick={() => router.push("/game-variants")}>去游戏/版本映射</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={filteredRows.filter((x) => x.type === "game")}
          columns={[
            { title: "导入批次", dataIndex: "batch" },
            { title: "原始游戏名", dataIndex: "game" },
            statusColumn,
            { title: "时间", dataIndex: "createdAt" },
            actionColumns("game"),
          ]}
        />
      </Card>

      <Card title="导入失败" extra={<Button onClick={() => router.push("/import?tab=history")}>去导入历史</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={filteredRows.filter((x) => x.type === "import")}
          columns={[
            { title: "导入批次", dataIndex: "batch" },
            { title: "失败原因", dataIndex: "reason" },
            { title: "失败条数", dataIndex: "failedCount" },
            statusColumn,
            { title: "时间", dataIndex: "createdAt" },
            actionColumns("import"),
          ]}
        />
      </Card>

      <Card title="超期未结算" extra={<Button onClick={() => router.push("/billing")}>去账单列表</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={filteredRows.filter((x) => x.type === "overdue")}
          columns={[
            { title: "渠道", dataIndex: "channel" },
            { title: "游戏", dataIndex: "game" },
            { title: "账期", dataIndex: "batch" },
            { title: "应结算金额", dataIndex: "amount", render: (v: number) => formatMoney(v || 0) },
            { title: "逾期天数", dataIndex: "overdueDays", render: (v: number) => `${v || 0}天` },
            statusColumn,
            actionColumns("overdue"),
          ]}
        />
      </Card>

      <Modal open={!!detail} title={detail ? `${EXCEPTION_LABEL[detail.type]}详情` : "异常详情"} onCancel={() => setDetail(null)} footer={null}>
        {detail ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text>异常ID：{detail.id}</Typography.Text>
            <Typography.Text>类型：{EXCEPTION_LABEL[detail.type]}</Typography.Text>
            <Typography.Text>状态：<Tag color={STATUS_COLOR[detail.status]}>{detail.status}</Tag></Typography.Text>
            <Typography.Text>时间：{detail.createdAt}</Typography.Text>
            <Typography.Text type="secondary">详情：{detail.reason || "请按去处理入口继续排查。"}</Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
