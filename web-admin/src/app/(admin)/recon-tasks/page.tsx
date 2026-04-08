"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  notification,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";

type ImportSummary = {
  batch_count: number;
  total_import_rows: number;
  valid_rows: number;
  invalid_rows: number;
  amount_sum: string;
  matched_variant_rows: number;
  unmatched_variant_rows: number;
};

type ImportBatchRow = {
  id: number;
  import_type: string;
  period: string;
  file_name: string;
  task_id: number;
  total_count: number;
  valid_count: number;
  invalid_count: number;
  amount_sum: number | string;
  status: string;
  summary: string;
  lifecycle_status?: "active" | "discarded";
  created_by: string;
  created_at: string;
  matched_variant_count?: number;
  unmatched_variant_count?: number;
  task_status: string;
};

type ImportListResp = {
  items: ImportBatchRow[];
  total: number;
  page: number;
  page_size: number;
  summary: ImportSummary;
};

type BatchStats = {
  by_channel: { channel_name: string; row_count: number; gross_amount: string }[];
  by_game: { game_name: string; row_count: number; gross_amount: string }[];
  unique_channel_count: number;
  unique_game_count: number;
  exceptions: {
    unmatched_channels: string[];
    unmatched_games: string[];
    unmapped_pairs: string[];
    variant_unmatched: { game_name: string; count: number }[];
  };
};

type IssueRow = {
  issue_id: number;
  task_id: number;
  issue_type: string;
  message: string;
  status: string;
  remark?: string;
};

type ImportDetail = ImportBatchRow & {
  unresolved_issue_count?: number;
  resolved_issue_count?: number;
};
type RecomputeResp = { total: number; matched: number; unmatched: number; issues: number };
type DiscardResp = { id: number; lifecycle_status: "discarded"; already_discarded?: boolean };
type RevertConfirmResp = { task_id: number; status: string };

const emptySummary: ImportSummary = {
  batch_count: 0,
  total_import_rows: 0,
  valid_rows: 0,
  invalid_rows: 0,
  amount_sum: "0",
  matched_variant_rows: 0,
  unmatched_variant_rows: 0,
};

function fmtMoney(v: string | number | undefined): string {
  if (v === undefined || v === null) return "0";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReconTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ImportBatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [summary, setSummary] = useState<ImportSummary>(emptySummary);
  const [keyword, setKeyword] = useState("");
  const [period, setPeriod] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState<"active" | "discarded" | "all">("active");
  const [applied, setApplied] = useState({
    keyword: "",
    period: "",
    importStatus: "",
    taskStatus: "",
    lifecycleStatus: "active" as "active" | "discarded" | "all",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"overview" | "issues">("overview");
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [batchStats, setBatchStats] = useState<BatchStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [recomputingId, setRecomputingId] = useState<number | null>(null);
  const [discardingId, setDiscardingId] = useState<number | null>(null);
  const [revertingTaskId, setRevertingTaskId] = useState<number | null>(null);

  const loadList = useCallback(
    async (pageOverride?: number) => {
      setLoading(true);
      const p = pageOverride ?? page;
      try {
        const qs = new URLSearchParams();
        qs.set("page", String(p));
        qs.set("page_size", String(pageSize));
        if (applied.keyword) qs.set("keyword", applied.keyword);
        if (applied.period) qs.set("period", applied.period);
        if (applied.importStatus) qs.set("status", applied.importStatus);
        if (applied.taskStatus) qs.set("task_status", applied.taskStatus);
        if (applied.lifecycleStatus) qs.set("lifecycle_status", applied.lifecycleStatus);
        const data = await apiRequest<ImportListResp>(`/imports/history?${qs.toString()}`);
        setItems(data.items || []);
        setTotal(data.total ?? 0);
        setSummary(data.summary || emptySummary);
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, applied]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const tid = searchParams.get("task_id");
    if (!tid || !items.length) return;
    const n = Number(tid);
    if (!Number.isFinite(n)) return;
    const row = items.find((x) => x.task_id === n);
    if (row) {
      setActiveHistoryId(row.id);
      setDrawerTab("overview");
      setDrawerOpen(true);
    }
  }, [searchParams, items]);

  const loadDetailBundle = async (historyId: number, tab: "overview" | "issues") => {
    setActiveHistoryId(historyId);
    setDrawerTab(tab);
    setDrawerOpen(true);
    setStatsLoading(true);
    setIssuesLoading(tab === "issues");
    try {
      const [d, st] = await Promise.all([
        apiRequest<ImportDetail>(`/imports/history/${historyId}`),
        apiRequest<BatchStats>(`/imports/history/${historyId}/batch-stats`),
      ]);
      setDetail(d);
      setBatchStats(st);
      if (tab === "issues") {
        const iss = await apiRequest<IssueRow[]>(`/imports/history/${historyId}/issues`);
        setIssues(iss);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStatsLoading(false);
      setIssuesLoading(false);
    }
  };

  const openIssuesTab = async (historyId: number) => {
    setActiveHistoryId(historyId);
    setDrawerTab("issues");
    setDrawerOpen(true);
    setIssuesLoading(true);
    setStatsLoading(true);
    try {
      const [d, st, iss] = await Promise.all([
        apiRequest<ImportDetail>(`/imports/history/${historyId}`),
        apiRequest<BatchStats>(`/imports/history/${historyId}/batch-stats`),
        apiRequest<IssueRow[]>(`/imports/history/${historyId}/issues`),
      ]);
      setDetail(d);
      setBatchStats(st);
      setIssues(iss);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStatsLoading(false);
      setIssuesLoading(false);
    }
  };

  const refreshDrawerIfOpen = async () => {
    if (!drawerOpen || !activeHistoryId) return;
    if (drawerTab === "issues") {
      await openIssuesTab(activeHistoryId);
    } else {
      await loadDetailBundle(activeHistoryId, "overview");
    }
  };

  const confirmTask = (taskId: number, period: string) => {
    Modal.confirm({
      title: "确认入账",
      content: `确认任务 ${taskId} 后将进入后续账单流程，建议先完成异常处理并复核后再确认。`,
      onOk: async () => {
        try {
          await apiRequest(`/recon/${taskId}/confirm`, "POST");
          await loadList();
          if (activeHistoryId && detail?.task_id === taskId) {
            const d = await apiRequest<ImportDetail>(`/imports/history/${activeHistoryId}`);
            setDetail(d);
          }
          const periodNorm = (period || "").trim();
          if (periodNorm) {
            notification.success({
              message: "确认入账成功",
              description: `账期 ${periodNorm} 已确认。可前往账单管理查看或生成该账期账单。`,
              btn: (
                <Button type="primary" size="small" onClick={() => router.push(`/billing?period=${encodeURIComponent(periodNorm)}`)}>
                  去账单管理
                </Button>
              ),
              duration: 10,
            });
          } else {
            message.success("确认成功");
          }
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const revertConfirmTask = (row: ImportBatchRow) => {
    Modal.confirm({
      title: "撤销入账",
      content: "撤销后该批次将回到待确认状态，是否继续？",
      onOk: async () => {
        setRevertingTaskId(row.task_id);
        try {
          await apiRequest<RevertConfirmResp>(`/recon/${row.task_id}/revert-confirm`, "POST");
          message.success("撤销成功，批次已回到待确认");
          await loadList();
          await refreshDrawerIfOpen();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setRevertingTaskId(null);
        }
      },
    });
  };

  const resolveIssue = async (issueId: number) => {
    try {
      await apiRequest(`/recon/issues/${issueId}/resolve`, "POST", { status: "已处理", remark: "" });
      message.success("已标记处理");
      if (activeHistoryId) {
        const iss = await apiRequest<IssueRow[]>(`/imports/history/${activeHistoryId}/issues`);
        setIssues(iss);
        const d = await apiRequest<ImportDetail>(`/imports/history/${activeHistoryId}`);
        setDetail(d);
      }
      await loadList();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const exportBatch = async (row: ImportBatchRow) => {
    try {
      message.loading({ content: "正在准备导出…", key: "import_export" });
      const raw = await apiRequest<Record<string, unknown>[]>(`/imports/history/${row.id}/raw-rows`);
      exportRowsToXlsx(raw, buildExportFilename(`import_batch_${row.period}_${row.id}`, "xlsx"));
      message.success({ content: "导出完成", key: "import_export" });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const recomputeBatch = (row: ImportBatchRow) => {
    Modal.confirm({
      title: "重新计算批次数据",
      content: "将基于最新的渠道、游戏、映射及分成规则重新计算该批次数据，是否继续？",
      onOk: async () => {
        setRecomputingId(row.id);
        try {
          const resp = await apiRequest<RecomputeResp>(`/imports/history/${row.id}/recompute`, "POST");
          message.success(`重算完成：共 ${resp.total} 条，匹配 ${resp.matched} 条，异常 ${resp.unmatched} 条`);
          await loadList();
          await refreshDrawerIfOpen();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setRecomputingId(null);
        }
      },
    });
  };

  const discardBatch = (row: ImportBatchRow) => {
    Modal.confirm({
      title: "作废批次",
      content: "该批次将标记为已作废，不再参与默认统计和后续处理，是否继续？",
      okType: "danger",
      onOk: async () => {
        setDiscardingId(row.id);
        try {
          await apiRequest<DiscardResp>(`/imports/history/${row.id}/discard`, "POST");
          message.success("批次已作废");
          await loadList();
          await refreshDrawerIfOpen();
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setDiscardingId(null);
        }
      },
    });
  };

  const hasExceptions = useMemo(() => {
    if (!batchStats) return false;
    const ex = batchStats.exceptions;
    return (
      ex.unmatched_channels.length > 0 ||
      ex.unmatched_games.length > 0 ||
      ex.unmapped_pairs.length > 0 ||
      ex.variant_unmatched.length > 0
    );
  }, [batchStats]);

  const overviewPanel = (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {detail && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="文件名">{detail.file_name || "—"}</Descriptions.Item>
          <Descriptions.Item label="账期">{detail.period}</Descriptions.Item>
          <Descriptions.Item label="导入时间">{detail.created_at}</Descriptions.Item>
          <Descriptions.Item label="操作人">{detail.created_by || "—"}</Descriptions.Item>
          <Descriptions.Item label="总流水" span={2}>
            {fmtMoney(detail.amount_sum)}
          </Descriptions.Item>
        </Descriptions>
      )}
      {detail && (
        <Descriptions title="数据统计" bordered size="small" column={2}>
          <Descriptions.Item label="渠道数">{batchStats?.unique_channel_count ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="游戏数">{batchStats?.unique_game_count ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="总记录数">{detail.total_count}</Descriptions.Item>
          <Descriptions.Item label="正常 / 异常">
            {detail.valid_count} / {detail.invalid_count}
          </Descriptions.Item>
        </Descriptions>
      )}
      <Typography.Title level={5}>按渠道汇总</Typography.Title>
      <Table
        size="small"
        rowKey="channel_name"
        loading={statsLoading}
        pagination={false}
        dataSource={batchStats?.by_channel || []}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
        columns={[
          { title: "渠道", dataIndex: "channel_name" },
          { title: "条数", dataIndex: "row_count", width: 100 },
          { title: "流水合计", dataIndex: "gross_amount", render: (v: string) => fmtMoney(v) },
        ]}
      />
      <Typography.Title level={5}>按游戏汇总</Typography.Title>
      <Table
        size="small"
        rowKey="game_name"
        loading={statsLoading}
        pagination={false}
        dataSource={batchStats?.by_game || []}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
        columns={[
          { title: "游戏", dataIndex: "game_name" },
          { title: "条数", dataIndex: "row_count", width: 100 },
          { title: "流水合计", dataIndex: "gross_amount", render: (v: string) => fmtMoney(v) },
        ]}
      />
      {hasExceptions && batchStats && (
        <>
          <Typography.Title level={5}>异常概览</Typography.Title>
          <Space direction="vertical" style={{ width: "100%" }}>
            {batchStats.exceptions.unmatched_channels.length > 0 && (
              <div>
                <Typography.Text strong>未匹配渠道</Typography.Text>
                <div>{batchStats.exceptions.unmatched_channels.join("、") || "—"}</div>
              </div>
            )}
            {batchStats.exceptions.unmatched_games.length > 0 && (
              <div>
                <Typography.Text strong>未匹配游戏（主数据）</Typography.Text>
                <div>{batchStats.exceptions.unmatched_games.join("、") || "—"}</div>
              </div>
            )}
            {batchStats.exceptions.unmapped_pairs.length > 0 && (
              <div>
                <Typography.Text strong>未映射组合</Typography.Text>
                <ul style={{ marginBottom: 0 }}>
                  {batchStats.exceptions.unmapped_pairs.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {batchStats.exceptions.variant_unmatched.length > 0 && (
              <div>
                <Typography.Text strong>版本未匹配</Typography.Text>
                <ul style={{ marginBottom: 0 }}>
                  {batchStats.exceptions.variant_unmatched.map((v) => (
                    <li key={v.game_name}>
                      {v.game_name}（{v.count} 条）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Space>
          <Space wrap>
            <Button type="link" onClick={() => router.push("/channels")}>
              去渠道管理
            </Button>
            <Button type="link" onClick={() => router.push("/games")}>
              去游戏管理
            </Button>
            <Button type="link" onClick={() => router.push("/channel-game-map")}>
              去渠道游戏映射
            </Button>
            <Button type="link" onClick={() => router.push("/game-variants")}>
              去版本管理
            </Button>
          </Space>
        </>
      )}
    </Space>
  );

  const issuesPanel = (
    <Table
      rowKey="issue_id"
      loading={issuesLoading}
      dataSource={issues}
      pagination={{ pageSize: 8 }}
      locale={{ emptyText: <Empty description="该批次暂无异常明细" /> }}
      columns={[
        { title: "异常ID", dataIndex: "issue_id", width: 90 },
        { title: "类型", dataIndex: "issue_type", width: 120 },
        { title: "明细", dataIndex: "message" },
        {
          title: "状态",
          dataIndex: "status",
          width: 100,
          render: (v: string) => <Tag color={v === "已处理" ? "green" : "red"}>{v || "未处理"}</Tag>,
        },
        {
          title: "操作",
          width: 120,
          render: (_, r) => (
            <Button size="small" disabled={r.status === "已处理"} onClick={() => resolveIssue(r.issue_id)}>
              标记已处理
            </Button>
          ),
        },
      ]}
    />
  );

  return (
    <Card
      title="导入数据中心"
      extra={
        <Space wrap>
          <Input placeholder="搜索文件名 / 摘要 / 账期 / 任务ID" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Input placeholder="账期" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 120 }} />
          <Select
            allowClear
            placeholder="导入单状态"
            style={{ width: 140 }}
            options={[
              { label: "待确认", value: "待确认" },
              { label: "异常待处理", value: "异常待处理" },
            ]}
            value={importStatus || undefined}
            onChange={(v) => setImportStatus(v || "")}
          />
          <Select
            allowClear
            placeholder="核对任务状态"
            style={{ width: 140 }}
            options={[
              { label: "待确认", value: "待确认" },
              { label: "异常待处理", value: "异常待处理" },
              { label: "已确认", value: "已确认" },
            ]}
            value={taskStatus || undefined}
            onChange={(v) => setTaskStatus(v || "")}
          />
          <Select
            placeholder="批次状态"
            style={{ width: 140 }}
            options={[
              { label: "有效批次", value: "active" },
              { label: "已作废", value: "discarded" },
              { label: "全部", value: "all" },
            ]}
            value={lifecycleStatus}
            onChange={(v) => setLifecycleStatus((v || "active") as "active" | "discarded" | "all")}
          />
          <Button
            type="primary"
            onClick={() => {
              setApplied({
                keyword: keyword.trim(),
                period: period.trim(),
                importStatus,
                taskStatus,
                lifecycleStatus,
              });
              setPage(1);
            }}
          >
            查询
          </Button>
          <Button onClick={() => void loadList()}>刷新</Button>
        </Space>
      }
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="导入批次数" value={summary.batch_count} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="总导入条数" value={summary.total_import_rows} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="正常条数" value={summary.valid_rows} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="异常条数" value={summary.invalid_rows} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="总流水" value={fmtMoney(summary.amount_sum)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="已匹配版本行数" value={summary.matched_variant_rows} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6} xl={4}>
          <Card size="small">
            <Statistic title="未匹配版本行数" value={summary.unmatched_variant_rows} />
          </Card>
        </Col>
      </Row>

      <Table<ImportBatchRow>
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps || 20);
          },
        }}
        locale={{ emptyText: <Empty description="暂无导入批次" /> }}
        columns={[
          { title: "导入时间", dataIndex: "created_at", width: 170 },
          { title: "账期", dataIndex: "period", width: 100 },
          { title: "文件名", dataIndex: "file_name", ellipsis: true },
          { title: "总行数", dataIndex: "total_count", width: 88 },
          { title: "正常行数", dataIndex: "valid_count", width: 88 },
          { title: "异常行数", dataIndex: "invalid_count", width: 88 },
          { title: "已匹配版本", dataIndex: "matched_variant_count", width: 100, render: (v) => v ?? "—" },
          { title: "未匹配版本", dataIndex: "unmatched_variant_count", width: 100, render: (v) => v ?? "—" },
          {
            title: "流水合计",
            dataIndex: "amount_sum",
            width: 120,
            render: (v) => fmtMoney(v),
          },
          {
            title: "状态",
            width: 120,
            render: (_, r) => {
              if (r.lifecycle_status === "discarded") {
                return <Tag color="default">已作废</Tag>;
              }
              const color = r.task_status === "异常待处理" ? "red" : r.task_status === "已确认" ? "green" : "gold";
              return (
                <Space direction="vertical" size={0}>
                  <Tag color={color}>{r.task_status || "—"}</Tag>
                  {r.status !== r.task_status ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.status}</Typography.Text> : null}
                </Space>
              );
            },
          },
          {
            title: "操作",
            key: "actions",
            fixed: "right",
            width: 480,
            render: (_, r) => (
              <Space wrap size="small">
                <Button size="small" type="link" onClick={() => void loadDetailBundle(r.id, "overview")}>
                  查看明细
                </Button>
                <Button size="small" type="link" onClick={() => void openIssuesTab(r.id)}>
                  查看异常
                </Button>
                <Button size="small" type="link" onClick={() => void exportBatch(r)}>
                  导出本批
                </Button>
                <Button
                  size="small"
                  type="link"
                  disabled={r.task_status === "已确认" || r.lifecycle_status === "discarded"}
                  onClick={() => confirmTask(r.task_id, r.period)}
                >
                  确认入账
                </Button>
                <Button
                  size="small"
                  type="link"
                  disabled={r.lifecycle_status === "discarded" || r.task_status !== "已确认"}
                  loading={revertingTaskId === r.task_id}
                  onClick={() => revertConfirmTask(r)}
                >
                  撤销入账
                </Button>
                <Button
                  size="small"
                  type="link"
                  disabled={r.lifecycle_status === "discarded"}
                  loading={recomputingId === r.id}
                  onClick={() => recomputeBatch(r)}
                >
                  重新计算
                </Button>
                <Button
                  size="small"
                  type="link"
                  danger
                  loading={discardingId === r.id}
                  disabled={r.lifecycle_status === "discarded" || r.task_status === "已确认"}
                  onClick={() => discardBatch(r)}
                >
                  作废批次
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={detail ? `导入批次 #${detail.id}（任务 ${detail.task_id}）` : "批次详情"}
        width={920}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setActiveHistoryId(null);
          setDetail(null);
          setBatchStats(null);
          setIssues([]);
        }}
        destroyOnClose
      >
        <Tabs
          activeKey={drawerTab}
          onChange={async (k) => {
            const tab = k as "overview" | "issues";
            setDrawerTab(tab);
            if (tab === "issues" && activeHistoryId) {
              setIssuesLoading(true);
              try {
                const iss = await apiRequest<IssueRow[]>(`/imports/history/${activeHistoryId}/issues`);
                setIssues(iss);
              } catch (e) {
                message.error((e as Error).message);
              } finally {
                setIssuesLoading(false);
              }
            }
          }}
          items={[
            { key: "overview", label: "批次概况", children: overviewPanel },
            { key: "issues", label: "异常明细", children: issuesPanel },
          ]}
        />
      </Drawer>
    </Card>
  );
}
