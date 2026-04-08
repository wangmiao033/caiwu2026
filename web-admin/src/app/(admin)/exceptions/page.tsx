"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Modal, Result, Segmented, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { apiRequest } from "@/lib/api";
import { ExceptionOverviewResponse, ExceptionRange, ExceptionStatus, ExceptionType, getExceptionsOverview, updateExceptionStatus } from "@/lib/api/exceptions";
import { getCurrentRole } from "@/lib/rbac";

type ExceptionStatusText = "待处理" | "已忽略" | "已解决";
type DayRange = 7 | 30 | 90;
type StatusFilter = "all" | ExceptionStatusText;
type SourceFilter = "all" | "import_issue" | "channel_game_map" | "import_history" | "billing" | "import";
type TypeFilter = "all" | ExceptionType;

type UnifiedExceptionRow = {
  key: string;
  id: string;
  type: ExceptionType;
  typeLabel: string;
  source: string;
  sourceLabel: string;
  status: ExceptionStatusText;
  detectedAt: string;
  taskId?: number;
  importHistoryId?: number;
  period?: string;
  batchName?: string;
  detail: string;
  raw: Record<string, unknown>;
};

const TYPE_LABEL: Record<ExceptionType, string> = {
  share: "分成异常",
  channel: "未匹配渠道(旧)",
  game: "未匹配游戏(旧)",
  import: "导入失败(旧)",
  overdue: "超期未结算",
  unmatched_channel: "未匹配渠道",
  unmatched_game: "未匹配游戏",
  unmapped_pair: "未映射组合",
  variant_unmatched: "版本未匹配",
  import_failed: "导入失败",
};

const STATUS_COLOR: Record<ExceptionStatusText, string> = {
  待处理: "red",
  已忽略: "default",
  已解决: "green",
};

const TYPE_WHITE_LIST: TypeFilter[] = [
  "all",
  "share",
  "unmatched_channel",
  "unmatched_game",
  "unmapped_pair",
  "variant_unmatched",
  "import_failed",
  "overdue",
];
const STATUS_QUERY_WHITE_LIST = ["all", "pending", "ignored", "resolved"] as const;
const RANGE_WHITE_LIST = ["7d", "30d", "90d"] as const;

const parseTypeFilter = (value: string | null): TypeFilter => (value && TYPE_WHITE_LIST.includes(value as TypeFilter) ? (value as TypeFilter) : "all");
const parseStatusFilter = (value: string | null): StatusFilter => {
  if (value === "pending") return "待处理";
  if (value === "ignored") return "已忽略";
  if (value === "resolved") return "已解决";
  return "all";
};
const parseRangeFilter = (value: string | null): DayRange => {
  if (value === "7d") return 7;
  if (value === "90d") return 90;
  return 30;
};
const rangeToQuery = (value: DayRange): ExceptionRange => (value === 7 ? "7d" : value === 90 ? "90d" : "30d");

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
const statusFilterToQuery = (value: StatusFilter): "all" | ExceptionStatus => (value === "all" ? "all" : toStatusValue(value));

const sourceLabel = (source: string) => {
  if (source === "import_issue") return "导入批次异常";
  if (source === "channel_game_map") return "分成规则";
  if (source === "import_history") return "导入历史";
  if (source === "billing") return "账单";
  if (source === "import") return "导入数据";
  return source || "未知来源";
};

const normalizeType = (rawType: string): ExceptionType => {
  const known = rawType as ExceptionType;
  if (
    [
      "share",
      "channel",
      "game",
      "import",
      "overdue",
      "unmatched_channel",
      "unmatched_game",
      "unmapped_pair",
      "variant_unmatched",
      "import_failed",
    ].includes(known)
  ) {
    return known;
  }
  return "import_failed";
};

const parsePairFromDetail = (detail: string): { channel: string; game: string } => {
  const text = detail || "";
  const part = text.split(":").slice(1).join(":").trim();
  const seg = part || text;
  const [channel, game] = seg.split("/").map((s) => s.trim());
  return { channel: channel || "", game: game || "" };
};

export default function ExceptionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const role = getCurrentRole();
  const canUpdate = role === "admin" || role === "finance_manager";

  const [range, setRange] = useState<DayRange>(() => parseRangeFilter(searchParams.get("range")));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => parseStatusFilter(searchParams.get("status")));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => parseTypeFilter(searchParams.get("type")));
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [overview, setOverview] = useState<ExceptionOverviewResponse | null>(null);
  const [detail, setDetail] = useState<UnifiedExceptionRow | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [recomputeId, setRecomputeId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const data = await getExceptionsOverview({
        range: rangeToQuery(range),
        status: statusFilterToQuery(statusFilter),
        type: typeFilter === "all" ? "all" : typeFilter,
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
    void loadData();
  }, [range, statusFilter, typeFilter]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("type", typeFilter);
    next.set("status", statusFilterToQuery(statusFilter));
    next.set("range", rangeToQuery(range));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [typeFilter, statusFilter, range, pathname, router, searchParams]);

  const rows = useMemo<UnifiedExceptionRow[]>(() => {
    const out: UnifiedExceptionRow[] = [];
    const items = overview?.items || {};
    Object.entries(items).forEach(([bucket, arr]) => {
      (arr || []).forEach((raw) => {
        const row = raw as Record<string, unknown>;
        const type = normalizeType(String(row.type || bucket || "import_failed"));
        const id = String(row.id || "");
        const source = String(row.source_module || bucket || "");
        const status = toStatusText(String(row.status || "pending"));
        const detailText = String(row.detail || row.fail_reason || row.match_status || "");
        out.push({
          key: `${type}:${id}`,
          id,
          type,
          typeLabel: TYPE_LABEL[type] || type,
          source,
          sourceLabel: sourceLabel(source),
          status,
          detectedAt: String(row.detected_at || ""),
          taskId: Number(row.task_id || 0) || undefined,
          importHistoryId: Number(row.import_history_id || 0) || undefined,
          period: String(row.period || ""),
          batchName: String(row.batch_name || ""),
          detail: detailText || "请通过快捷入口处理该异常",
          raw: row,
        });
      });
    });
    return out.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
  }, [overview]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => (sourceFilter === "all" ? true : r.source === sourceFilter));
  }, [rows, sourceFilter]);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [range, statusFilter, typeFilter, sourceFilter]);

  const goQuick = (row: UnifiedExceptionRow) => {
    if (row.type === "unmatched_channel" || row.type === "channel") {
      const ch = String(row.raw.raw_channel_name || "");
      router.push(`/channels${ch ? `?keyword=${encodeURIComponent(ch)}` : ""}`);
      return;
    }
    if (row.type === "unmatched_game" || row.type === "game") {
      const gm = String(row.raw.raw_game_name || "");
      router.push(`/games${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`);
      return;
    }
    if (row.type === "unmapped_pair") {
      const { channel, game } = parsePairFromDetail(row.detail);
      const qs = new URLSearchParams();
      if (channel) qs.set("channel", channel);
      if (game) qs.set("game", game);
      router.push(`/channel-game-map${qs.toString() ? `?${qs.toString()}` : ""}`);
      return;
    }
    if (row.type === "variant_unmatched") {
      const gm = row.detail.split(":").slice(1).join(":").trim();
      router.push(`/game-variants${gm ? `?keyword=${encodeURIComponent(gm)}` : ""}`);
      return;
    }
    if (row.type === "share") {
      router.push("/billing-rules");
      return;
    }
    if (row.type === "overdue") {
      router.push("/billing");
      return;
    }
    router.push("/import?tab=history");
  };

  const gotoBatch = (row: UnifiedExceptionRow) => {
    if (row.taskId) {
      router.push(`/recon-tasks?task_id=${row.taskId}`);
      return;
    }
    router.push("/recon-tasks");
  };

  const updateOneStatus = async (row: UnifiedExceptionRow, target: ExceptionStatusText) => {
    await updateExceptionStatus({ type: row.type, id: row.id, status: toStatusValue(target) });
  };

  const handleBulkResolve = () => {
    const selected = filteredRows.filter((x) => selectedRowKeys.includes(x.key));
    if (!selected.length) {
      message.warning("请先选择异常");
      return;
    }
    Modal.confirm({
      title: "批量标记已处理",
      content: `将把选中的 ${selected.length} 条异常标记为已解决，是否继续？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setBulkResolving(true);
        let ok = 0;
        let fail = 0;
        for (const row of selected) {
          try {
            await updateOneStatus(row, "已解决");
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        if (fail === 0) message.success(`批量处理完成，共 ${ok} 条`);
        else message.warning(`批量处理完成：成功 ${ok} 条，失败 ${fail} 条`);
        setSelectedRowKeys([]);
        await loadData();
        setBulkResolving(false);
      },
    });
  };

  const recomputeBatch = (row: UnifiedExceptionRow) => {
    if (!row.importHistoryId) {
      message.warning("该异常未关联导入批次，无法重算");
      return;
    }
    Modal.confirm({
      title: "重算所属批次",
      content: "将对该异常所属批次执行重新计算，是否继续？",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setRecomputeId(row.key);
        try {
          const resp = await apiRequest<{ total: number; matched: number; unmatched: number; issues: number }>(
            `/imports/history/${row.importHistoryId}/recompute`,
            "POST"
          );
          message.success(`重算完成：共 ${resp.total} 条，匹配 ${resp.matched} 条，异常 ${resp.unmatched} 条`);
          await loadData();
        } catch (error) {
          message.error((error as Error).message || "重算失败");
        } finally {
          setRecomputeId(null);
        }
      },
    });
  };

  const stats = overview?.summary || {};

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

      <Card>
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Select
              style={{ width: 220 }}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v)}
              options={[
                { label: "全部异常类型", value: "all" },
                { label: "分成异常", value: "share" },
                { label: "未匹配渠道", value: "unmatched_channel" },
                { label: "未匹配游戏", value: "unmatched_game" },
                { label: "未映射组合", value: "unmapped_pair" },
                { label: "版本未匹配", value: "variant_unmatched" },
                { label: "导入失败", value: "import_failed" },
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
              onChange={(v) => setStatusFilter(v)}
              options={[
                { label: "全部状态", value: "all" },
                { label: "待处理", value: "待处理" },
                { label: "已忽略", value: "已忽略" },
                { label: "已解决", value: "已解决" },
              ]}
            />
            <Select
              style={{ width: 180 }}
              value={sourceFilter}
              onChange={(v) => setSourceFilter(v)}
              options={[
                { label: "全部来源", value: "all" },
                { label: "导入批次异常", value: "import_issue" },
                { label: "分成规则", value: "channel_game_map" },
                { label: "导入历史", value: "import_history" },
                { label: "账单", value: "billing" },
                { label: "导入数据", value: "import" },
              ]}
            />
          </Space>
          <Space>
            <Tag color="blue">总异常 {Number(stats.total || 0)}</Tag>
            <Button onClick={loadData}>刷新</Button>
            {canUpdate ? (
              <Button type="primary" disabled={!selectedRowKeys.length} loading={bulkResolving} onClick={handleBulkResolve}>
                批量标记已处理
              </Button>
            ) : null}
          </Space>
        </Space>
      </Card>

      <Card title="异常中心统一列表">
        <Table
          rowKey="key"
          loading={loading}
          dataSource={filteredRows}
          rowSelection={canUpdate ? { selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys.map((k) => String(k))) } : undefined}
          locale={{ emptyText: "暂无异常数据" }}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: "异常ID", dataIndex: "id", width: 170 },
            { title: "异常类型", dataIndex: "typeLabel", width: 140 },
            { title: "来源", dataIndex: "sourceLabel", width: 130 },
            { title: "来源批次", dataIndex: "batchName", render: (v: string, r: UnifiedExceptionRow) => v || (r.taskId ? `task-${r.taskId}` : "-") },
            { title: "账期", dataIndex: "period", width: 90, render: (v: string) => v || "-" },
            { title: "明细描述", dataIndex: "detail", ellipsis: true },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: ExceptionStatusText) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
            },
            {
              title: "时间",
              dataIndex: "detectedAt",
              width: 155,
              render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "-"),
            },
            {
              title: "操作",
              width: 360,
              render: (_: unknown, row: UnifiedExceptionRow) => (
                <Space size={4} wrap>
                  <Button type="link" onClick={() => setDetail(row)}>
                    查看详情
                  </Button>
                  <Button type="link" onClick={() => goQuick(row)}>
                    快捷处理
                  </Button>
                  <Button type="link" onClick={() => gotoBatch(row)}>
                    查看所属批次
                  </Button>
                  {row.importHistoryId ? (
                    <Button type="link" loading={recomputeId === row.key} onClick={() => recomputeBatch(row)}>
                      重算该批次
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <Button
                      type="link"
                      onClick={async () => {
                        try {
                          await updateOneStatus(row, "已解决");
                          message.success("已标记处理");
                          await loadData();
                        } catch (e) {
                          message.error((e as Error).message || "状态更新失败");
                        }
                      }}
                    >
                      标记已处理
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal open={!!detail} title="异常详情" onCancel={() => setDetail(null)} footer={null}>
        {detail ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text>异常ID：{detail.id}</Typography.Text>
            <Typography.Text>类型：{detail.typeLabel}</Typography.Text>
            <Typography.Text>状态：<Tag color={STATUS_COLOR[detail.status]}>{detail.status}</Tag></Typography.Text>
            <Typography.Text>来源：{detail.sourceLabel}</Typography.Text>
            <Typography.Text>所属批次：{detail.batchName || "-"}</Typography.Text>
            <Typography.Text>账期：{detail.period || "-"}</Typography.Text>
            <Typography.Text>时间：{detail.detectedAt ? dayjs(detail.detectedAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>
            <Typography.Text type="secondary">明细：{detail.detail}</Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
