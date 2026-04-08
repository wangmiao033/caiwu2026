"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Descriptions, Result, Space, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { ExceptionRange, ExceptionStatus, ExceptionType } from "@/lib/api/exceptions";
import { getExceptionsOverview } from "@/lib/api/exceptions";
import {
  IMPORT_DATA_CENTER_PATH,
  STATUS_COLOR,
  buildBillingRulesHubUrl,
  buildChannelGameMapHubUrl,
  buildGamesManagementUrl,
  buildQuickNavigationUrl,
  exceptionHandleQuery,
  flattenOverviewToRows,
  formatRatioPercent,
  getSuggestedHandlingText,
  listContextFromSearchParams,
  parseExceptionRouteKey,
  rangeToQuery,
  shareExceptionReasonText,
  type ExceptionListContext,
  type UnifiedExceptionRow,
} from "../../exceptions-shared";

function ShareBreakdown({ row, ctx }: { row: UnifiedExceptionRow; ctx: ExceptionListContext }) {
  if (row.type !== "share") return null;
  const ch = String(row.raw.channel_name || "").trim();
  const gm = String(row.raw.game_name || "").trim();
  const qs = new URLSearchParams();
  if (ch) qs.set("channel", ch);
  if (gm) qs.set("game", gm);
  qs.set("ex_type", String(ctx.typeFilter));
  qs.set("ex_status", String(ctx.statusQuery));
  qs.set("ex_range", rangeToQuery(ctx.range));
  const q = qs.toString();
  return (
    <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
      <Typography.Text strong>渠道：{String(row.raw.channel_name || "-")}</Typography.Text>
      <Typography.Text strong>游戏：{String(row.raw.game_name || "-")}</Typography.Text>
      <Typography.Text>渠道费（映射口径）：{formatRatioPercent(row.raw.channel_share)}</Typography.Text>
      <Typography.Text>税点：{formatRatioPercent(row.raw.tax_rate)}</Typography.Text>
      <Typography.Text>研发分成（映射口径）：{formatRatioPercent(row.raw.rd_share)}</Typography.Text>
      <Typography.Text>私点：{formatRatioPercent(row.raw.private_share)}</Typography.Text>
      <Typography.Text>发行分成（推算）：{formatRatioPercent(row.raw.publisher_share)}</Typography.Text>
      <Typography.Text>合计比例：{formatRatioPercent(row.raw.total_ratio)}</Typography.Text>
      <Typography.Text type="warning">异常原因：{shareExceptionReasonText(row.raw)}</Typography.Text>
      <Space wrap>
        <Button type="link" href={`/billing-rules?${q}`} target="_blank" rel="noopener noreferrer">
          规则配置（新标签）
        </Button>
        <Button type="link" href={`/channel-game-map?${q}`} target="_blank" rel="noopener noreferrer">
          渠道-游戏映射（新标签）
        </Button>
      </Space>
    </Space>
  );
}

export default function ExceptionHandlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const listCtx = useMemo(() => listContextFromSearchParams(searchParams), [searchParams]);

  const rawKey =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? (params.id[0] ?? "") : "";

  const [row, setRow] = useState<UnifiedExceptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErrorText("");
      let key: string;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        setErrorText("无效的链接");
        setLoading(false);
        return;
      }
      const parsed = parseExceptionRouteKey(key);
      if (!parsed) {
        setErrorText("无效的异常标识");
        setLoading(false);
        return;
      }

      const tryFind = async (type: "all" | ExceptionType, range: ExceptionRange, status: "all" | ExceptionStatus) => {
        const data = await getExceptionsOverview({ type, range, status });
        const rows = flattenOverviewToRows(data);
        return rows.find((r) => r.key === key) ?? null;
      };

      try {
        const found =
          (await tryFind(parsed.type, rangeToQuery(listCtx.range), listCtx.statusQuery)) || (await tryFind("all", "90d", "all"));
        if (cancelled) return;
        if (!found) {
          setErrorText("未找到该异常（可能已不在当前数据范围内）");
          setRow(null);
        } else {
          setRow(found);
        }
      } catch (e) {
        if (!cancelled) setErrorText((e as Error).message || "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawKey, listCtx.range, listCtx.statusQuery]);

  const backQuery = exceptionHandleQuery(listCtx);
  const backHref = `/exceptions?${backQuery}`;

  const quickUrl = row ? buildQuickNavigationUrl(row, listCtx) : "";
  const gamesUrl = row ? buildGamesManagementUrl(row) : "/games";
  const mapUrl = row ? buildChannelGameMapHubUrl(row, listCtx) : "/channel-game-map";
  const rulesUrl = row ? buildBillingRulesHubUrl(row, listCtx) : "/billing-rules";

  const openQuickNewTab = () => {
    if (!quickUrl) return;
    window.open(quickUrl, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <Card>
        <Spin style={{ margin: 48 }} />
      </Card>
    );
  }

  if (errorText || !row) {
    return (
      <Result
        status="warning"
        title={errorText || "未找到异常"}
        extra={
          <Button type="primary" onClick={() => router.push(backHref)}>
            返回异常中心
          </Button>
        }
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="异常处理"
        extra={
          <Space wrap>
            <Button onClick={() => router.push(backHref)}>返回异常中心</Button>
          </Space>
        }
      >
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="异常类型">{row.typeLabel}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_COLOR[row.status]}>{row.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="来源">{row.sourceLabel}</Descriptions.Item>
          <Descriptions.Item label="来源批次">{row.batchName || (row.taskId ? `task-${row.taskId}` : "—")}</Descriptions.Item>
          <Descriptions.Item label="账期">{row.period || "—"}</Descriptions.Item>
          <Descriptions.Item label="检测时间">
            {row.detectedAt ? dayjs(row.detectedAt).format("YYYY-MM-DD HH:mm:ss") : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="明细描述">{row.detail}</Descriptions.Item>
          <Descriptions.Item label="建议处理路径">
            <Typography.Paragraph style={{ marginBottom: 0 }}>{getSuggestedHandlingText(row)}</Typography.Paragraph>
          </Descriptions.Item>
        </Descriptions>

        <ShareBreakdown row={row} ctx={listCtx} />

        <Typography.Title level={5} style={{ marginTop: 24 }}>
          快捷跳转
        </Typography.Title>
        <Space wrap>
          <Button type="primary" onClick={() => router.push(quickUrl)}>
            快捷处理（同列表）
          </Button>
          <Button onClick={openQuickNewTab}>快捷处理（新标签）</Button>
          <Button onClick={() => router.push(gamesUrl)}>去游戏管理</Button>
          <Button onClick={() => router.push(mapUrl)}>去渠道-游戏映射</Button>
          <Button onClick={() => router.push(rulesUrl)}>去规则配置</Button>
          <Button onClick={() => router.push(IMPORT_DATA_CENTER_PATH)}>去导入数据中心</Button>
        </Space>
      </Card>
    </Space>
  );
}
