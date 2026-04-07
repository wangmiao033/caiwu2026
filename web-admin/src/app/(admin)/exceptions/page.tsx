"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Col, Modal, Result, Row, Segmented, Select, Skeleton, Space, Statistic, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { ExceptionOverviewResponse, ExceptionRange, ExceptionStatus, ExceptionType, getExceptionsOverview, updateExceptionStatus } from "@/lib/api/exceptions";

type ExceptionStatusText = "待处理" | "已忽略" | "已解决";
type DayRange = 7 | 30 | 90;

type ExceptionRow = Record<string, unknown> & {
  id: string;
  type: ExceptionType;
  status: ExceptionStatusText;
  createdAt: string;
};

const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  share: "分成异常",
  channel: "未匹配渠道",
  game: "未匹配游戏",
  import: "导入失败",
  overdue: "超期未结算",
};

const STATUS_COLOR: Record<ExceptionStatusText, string> = {
  待处理: "red",
  已忽略: "default",
  已解决: "green",
};

const formatPercent = (ratio: number) => `${Number((ratio * 100).toFixed(4)).toString()}%`;
const formatMoney = (value: number) => `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

const toStatusText = (status: string): ExceptionStatusText => {
  if (status === "ignored") return "已忽略";
  if (status === "resolved") return "已解决";
  return "待处理";
};

const toStatusValue = (status: ExceptionStatusText): ExceptionStatus => {
  if (status === "已忽略") return "ignored";
  if (status === "已解决") return "resolved";
  return "pending";
};

export default function ExceptionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryType = searchParams.get("type");
  const initialType = queryType && ["share", "channel", "game", "import", "overdue"].includes(queryType) ? (queryType as ExceptionType) : "all";

  const [typeFilter, setTypeFilter] = useState<"all" | ExceptionType>(initialType);
  const [range, setRange] = useState<DayRange>(30);
  const [statusFilter, setStatusFilter] = useState<"all" | ExceptionStatusText>("all");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [overview, setOverview] = useState<ExceptionOverviewResponse | null>(null);
  const [detail, setDetail] = useState<ExceptionRow | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const rangeValue: ExceptionRange = range === 7 ? "7d" : range === 30 ? "30d" : "90d";
      const statusValue = statusFilter === "all" ? "all" : toStatusValue(statusFilter);
      const data = await getExceptionsOverview({
        range: rangeValue,
        status: statusValue,
        type: typeFilter,
      });
      setOverview(data);
    } catch (error) {
      const msg = (error as Error).message || "加载异常中心数据失败";
      setErrorText(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [range, statusFilter, typeFilter]);

  const goHandle = (type: ExceptionType) => {
    if (type === "share") router.push("/billing-rules");
    if (type === "channel") router.push("/channel-game-map");
    if (type === "game") router.push("/game-variants");
    if (type === "import") router.push("/import?tab=history");
    if (type === "overdue") router.push("/billing");
  };

  const shareRows: ExceptionRow[] = useMemo(
    () =>
      (overview?.items.share || []).map((x) => ({
        ...(x as Record<string, unknown>),
        id: String(x.id || ""),
        type: "share",
        status: toStatusText(String(x.status || "pending")),
        createdAt: String(x.detected_at || ""),
      })),
    [overview]
  );
  const channelRows: ExceptionRow[] = useMemo(
    () =>
      (overview?.items.channel || []).map((x) => ({
        ...(x as Record<string, unknown>),
        id: String(x.id || ""),
        type: "channel",
        status: toStatusText(String(x.status || "pending")),
        createdAt: String(x.detected_at || ""),
      })),
    [overview]
  );
  const gameRows: ExceptionRow[] = useMemo(
    () =>
      (overview?.items.game || []).map((x) => ({
        ...(x as Record<string, unknown>),
        id: String(x.id || ""),
        type: "game",
        status: toStatusText(String(x.status || "pending")),
        createdAt: String(x.detected_at || ""),
      })),
    [overview]
  );
  const importRows: ExceptionRow[] = useMemo(
    () =>
      (overview?.items.import || []).map((x) => ({
        ...(x as Record<string, unknown>),
        id: String(x.id || ""),
        type: "import",
        status: toStatusText(String(x.status || "pending")),
        createdAt: String(x.detected_at || ""),
      })),
    [overview]
  );
  const overdueRows: ExceptionRow[] = useMemo(
    () =>
      (overview?.items.overdue || []).map((x) => ({
        ...(x as Record<string, unknown>),
        id: String(x.id || ""),
        type: "overdue",
        status: toStatusText(String(x.status || "pending")),
        createdAt: String(x.detected_at || ""),
      })),
    [overview]
  );

  const stats = overview?.summary || { total: 0, share: 0, channel: 0, game: 0, import: 0, overdue: 0 };

  const handleStatusUpdate = async (row: ExceptionRow, status: ExceptionStatusText) => {
    try {
      await updateExceptionStatus({ type: row.type, id: row.id, status: toStatusValue(status) });
      message.success(`已更新为${status}`);
      await loadData();
    } catch (error) {
      message.error((error as Error).message || "状态更新失败");
    }
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
        <Button type="link" onClick={() => handleStatusUpdate(row, "已解决")}>
          标记已解决
        </Button>
        <Button type="link" onClick={() => handleStatusUpdate(row, "已忽略")}>
          忽略
        </Button>
      </Space>
    ),
  });

  const statusColumn = {
    title: "状态",
    dataIndex: "status",
    width: 100,
    render: (value: ExceptionStatusText) => <Tag color={STATUS_COLOR[value]}>{value}</Tag>,
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorText ? (
        <Result
          status="warning"
          title="异常中心加载失败"
          subTitle={errorText}
          extra={
            <Button type="primary" onClick={loadData}>
              重试
            </Button>
          }
        />
      ) : null}
      <Alert type="info" showIcon message="异常总览 + 待处理中心（真实数据）" description="统计和明细来自后端接口，状态更新会持久化保存。" />

      <Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="总异常数" value={stats.total} />}</Col>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="分成异常数" value={stats.share} />}</Col>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="未匹配渠道数" value={stats.channel} />}</Col>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="未匹配游戏数" value={stats.game} />}</Col>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="导入失败数" value={stats.import} />}</Col>
          <Col xs={24} sm={8} lg={4}>{loading ? <Skeleton active paragraph={{ rows: 1 }} title={false} /> : <Statistic title="超期未结算数" value={stats.overdue} />}</Col>
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
          loading={loading}
          dataSource={shareRows}
          columns={[
            { title: "渠道", dataIndex: "channel_name" },
            { title: "游戏", dataIndex: "game_name" },
            { title: "通道费", dataIndex: "channel_share", render: (v: number) => formatPercent(Number(v || 0)) },
            { title: "税点", dataIndex: "tax_rate", render: (v: number) => formatPercent(Number(v || 0)) },
            { title: "研发分成", dataIndex: "rd_share", render: (v: number) => formatPercent(Number(v || 0)) },
            { title: "私点", dataIndex: "private_share", render: (v: number) => formatPercent(Number(v || 0)) },
            { title: "发行分成", dataIndex: "publisher_share", render: (v: number) => formatPercent(Number(v || 0)) },
            { title: "合计", dataIndex: "total_ratio", render: (v: number) => formatPercent(Number(v || 0)) },
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
          loading={loading}
          dataSource={channelRows}
          columns={[
            { title: "导入批次", dataIndex: "batch_name" },
            { title: "原始渠道名", dataIndex: "raw_channel_name" },
            statusColumn,
            { title: "时间", dataIndex: "detected_at", render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-") },
            actionColumns("channel"),
          ]}
        />
      </Card>

      <Card title="未匹配游戏" extra={<Button onClick={() => router.push("/game-variants")}>去游戏/版本映射</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          loading={loading}
          dataSource={gameRows}
          columns={[
            { title: "导入批次", dataIndex: "batch_name" },
            { title: "原始游戏名", dataIndex: "raw_game_name" },
            statusColumn,
            { title: "时间", dataIndex: "detected_at", render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-") },
            actionColumns("game"),
          ]}
        />
      </Card>

      <Card title="导入失败" extra={<Button onClick={() => router.push("/import?tab=history")}>去导入历史</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          loading={loading}
          dataSource={importRows}
          columns={[
            { title: "导入批次", dataIndex: "batch_name" },
            { title: "失败原因", dataIndex: "fail_reason" },
            { title: "失败条数", dataIndex: "invalid_count" },
            statusColumn,
            { title: "时间", dataIndex: "detected_at", render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-") },
            actionColumns("import"),
          ]}
        />
      </Card>

      <Card title="超期未结算" extra={<Button onClick={() => router.push("/billing")}>去账单列表</Button>}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          loading={loading}
          dataSource={overdueRows}
          columns={[
            { title: "渠道", dataIndex: "channel_name" },
            { title: "游戏", dataIndex: "game_name" },
            { title: "账期", dataIndex: "period" },
            { title: "应结算金额", dataIndex: "bill_amount", render: (v: number) => formatMoney(Number(v || 0)) },
            { title: "逾期天数", dataIndex: "overdue_days", render: (v: number) => `${Number(v || 0)}天` },
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
            <Typography.Text>时间：{detail.createdAt ? dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>
            <Typography.Text type="secondary">详情：{String(detail.fail_reason || detail.match_status || detail.source_module || "请按去处理入口继续排查。")}</Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
