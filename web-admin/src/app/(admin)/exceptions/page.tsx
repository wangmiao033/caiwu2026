"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Modal, Result, Segmented, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { apiRequest } from "@/lib/api";
import { ExceptionOverviewResponse, getExceptionsOverview, updateExceptionStatus } from "@/lib/api/exceptions";
import { getCurrentRole } from "@/lib/rbac";
import {
  STATUS_COLOR,
  buildBillingRulesHubUrl,
  buildChannelGameMapHubUrl,
  buildQuickNavigationUrl,
  exceptionHandleQuery,
  flattenOverviewToRows,
  formatRatioPercent,
  listContextFromFilters,
  parseRangeFilter,
  parseStatusFilter,
  parseTypeFilter,
  rangeToQuery,
  shareExceptionReasonText,
  statusFilterToQuery,
  toStatusValue,
  type DayRange,
  type ExceptionStatusText,
  type SourceFilter,
  type StatusFilter,
  type TypeFilter,
  type UnifiedExceptionRow,
} from "./exceptions-shared";

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
  const [bulkRecomputing, setBulkRecomputing] = useState(false);
  const [recomputeId, setRecomputeId] = useState<string | null>(null);

  const listNavCtx = () => listContextFromFilters(typeFilter, statusFilter, range);

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

  const rows = useMemo(() => flattenOverviewToRows(overview), [overview]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => (sourceFilter === "all" ? true : r.source === sourceFilter));
  }, [rows, sourceFilter]);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [range, statusFilter, typeFilter, sourceFilter]);

  const goHandlePage = (row: UnifiedExceptionRow) => {
    const q = exceptionHandleQuery(listNavCtx());
    router.push(`/exceptions/${encodeURIComponent(row.key)}/handle?${q}`);
  };

  const buildQuickNavigationUrlWithCtx = (row: UnifiedExceptionRow) => buildQuickNavigationUrl(row, listNavCtx());

  const goQuick = (row: UnifiedExceptionRow) => {
    router.push(buildQuickNavigationUrlWithCtx(row));
  };

  const goQuickNewTab = (row: UnifiedExceptionRow) => {
    window.open(buildQuickNavigationUrlWithCtx(row), "_blank", "noopener,noreferrer");
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

  const collectRecomputeHistoryIds = (selected: UnifiedExceptionRow[]): number[] => {
    const byTask = new Map<number, number>();
    const noTaskHistoryIds = new Set<number>();
    for (const row of selected) {
      if (!row.importHistoryId) continue;
      if (row.taskId) {
        if (!byTask.has(row.taskId)) byTask.set(row.taskId, row.importHistoryId);
      } else {
        noTaskHistoryIds.add(row.importHistoryId);
      }
    }
    return [...new Set([...byTask.values(), ...noTaskHistoryIds])];
  };

  const handleBulkRecompute = () => {
    const selected = filteredRows.filter((x) => selectedRowKeys.includes(x.key));
    if (!selected.length) {
      message.warning("请先选择异常");
      return;
    }
    const historyIds = collectRecomputeHistoryIds(selected);
    if (!historyIds.length) {
      message.warning("所选异常均未关联导入批次，无法重算");
      return;
    }
    Modal.confirm({
      title: "批量重算所属批次",
      content: `将对选中异常涉及的批次进行去重后重算（共 ${historyIds.length} 个批次），是否继续？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setBulkRecomputing(true);
        let ok = 0;
        const failures: string[] = [];
        try {
          for (const id of historyIds) {
            try {
              await apiRequest(`/imports/history/${id}/recompute`, "POST");
              ok += 1;
            } catch (error) {
              failures.push(`#${id}: ${(error as Error).message || "重算失败"}`);
            }
          }
          const fail = failures.length;
          if (fail === 0) {
            message.success(`已重算 ${ok} 个批次`);
          } else {
            message.warning(`成功 ${ok}，失败 ${fail}：${failures.slice(0, 5).join("；")}`);
          }
          setSelectedRowKeys([]);
          await loadData();
        } finally {
          setBulkRecomputing(false);
        }
      },
    });
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
            <Button disabled={!selectedRowKeys.length || bulkRecomputing} loading={bulkRecomputing} onClick={handleBulkRecompute}>
              批量重算所属批次
            </Button>
          </Space>
        </Space>
      </Card>

      <Card title="异常中心统一列表">
        <Table
          rowKey="key"
          loading={loading}
          dataSource={filteredRows}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys.map((k) => String(k))) }}
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
              width: 420,
              render: (_: unknown, row: UnifiedExceptionRow) => (
                <Space size={4} wrap>
                  <Button type="link" onClick={() => setDetail(row)}>
                    查看详情
                  </Button>
                  <Button type="link" onClick={() => goHandlePage(row)}>
                    独立处理
                  </Button>
                  <Button type="link" onClick={() => goQuick(row)}>
                    快捷处理
                  </Button>
                  <Button type="link" onClick={() => goQuickNewTab(row)}>
                    新标签
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
            <Space wrap>
              <Button type="link" onClick={() => goHandlePage(detail)}>
                独立处理页
              </Button>
            </Space>
            <Typography.Text>异常ID：{detail.id}</Typography.Text>
            <Typography.Text>类型：{detail.typeLabel}</Typography.Text>
            <Typography.Text>
              状态：<Tag color={STATUS_COLOR[detail.status]}>{detail.status}</Tag>
            </Typography.Text>
            <Typography.Text>来源：{detail.sourceLabel}</Typography.Text>
            <Typography.Text>所属批次：{detail.batchName || "-"}</Typography.Text>
            <Typography.Text>账期：{detail.period || "-"}</Typography.Text>
            <Typography.Text>时间：{detail.detectedAt ? dayjs(detail.detectedAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>
            {detail.type === "share" ? (
              <>
                <Typography.Text strong>渠道：{String(detail.raw.channel_name || "-")}</Typography.Text>
                <Typography.Text strong>游戏：{String(detail.raw.game_name || "-")}</Typography.Text>
                <Typography.Text>渠道费（映射口径）：{formatRatioPercent(detail.raw.channel_share)}</Typography.Text>
                <Typography.Text>税点：{formatRatioPercent(detail.raw.tax_rate)}</Typography.Text>
                <Typography.Text>研发分成（映射口径）：{formatRatioPercent(detail.raw.rd_share)}</Typography.Text>
                <Typography.Text>私点：{formatRatioPercent(detail.raw.private_share)}</Typography.Text>
                <Typography.Text>发行分成（推算）：{formatRatioPercent(detail.raw.publisher_share)}</Typography.Text>
                <Typography.Text>合计比例：{formatRatioPercent(detail.raw.total_ratio)}</Typography.Text>
                <Typography.Text type="warning">异常原因：{shareExceptionReasonText(detail.raw)}</Typography.Text>
                <Typography.Text type="secondary">
                  建议处理：在「规则配置」中按上述渠道、游戏筛选后编辑对应行，或到「渠道-游戏映射」核对 revenue_share_ratio / rd_settlement_ratio。亦可点击「快捷处理」自动跳转并筛选。
                </Typography.Text>
                <Space wrap>
                  <Button
                    type="link"
                    href={buildBillingRulesHubUrl(detail, listNavCtx())}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    规则配置（新标签）
                  </Button>
                  <Button
                    type="link"
                    href={buildChannelGameMapHubUrl(detail, listNavCtx())}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    渠道-游戏映射（新标签）
                  </Button>
                </Space>
              </>
            ) : (
              <Typography.Text type="secondary">明细：{detail.detail}</Typography.Text>
            )}
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
