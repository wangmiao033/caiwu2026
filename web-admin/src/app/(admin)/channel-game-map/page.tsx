"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { getCachedJson, invalidateCachedJson, SHORT_LIST_TTL_MS } from "@/lib/shortLivedApiCache";
import RoleGuard from "@/components/RoleGuard";
import {
  calcPublishRatio,
  isTotalValid,
  type Channel,
  type Game,
  type MapRow,
  toPercent,
  toRatio,
} from "./channel-game-map-shared";

const ChannelGameMapBulkImport = dynamic(() => import("./ChannelGameMapBulkImport"), { ssr: false, loading: () => null });

const CACHE_CH = "api:GET:/channels";
const CACHE_GM = "api:GET:/games";
const CACHE_MAP = "api:GET:/channel-game-map";

export default function ChannelGameMapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<MapRow[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [qChannel, setQChannel] = useState("");
  const [qGame, setQGame] = useState("");
  const [openBulk, setOpenBulk] = useState(false);

  const load = useCallback(async (forceRefresh = false) => {
    try {
      const [c, g, m] = await Promise.all([
        getCachedJson(CACHE_CH, SHORT_LIST_TTL_MS, () => apiRequest<Channel[]>("/channels"), forceRefresh),
        getCachedJson(CACHE_GM, SHORT_LIST_TTL_MS, () => apiRequest<Game[]>("/games"), forceRefresh),
        getCachedJson(CACHE_MAP, SHORT_LIST_TTL_MS, () => apiRequest<MapRow[]>("/channel-game-map"), forceRefresh),
      ]);
      setChannels(c);
      setGames(g);
      setRows(m);
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  const remove = useCallback(
    (id: number) =>
      Modal.confirm({
        title: "确认删除映射",
        onOk: async () => {
          try {
            await apiRequest(`/channel-game-map/${id}`, "DELETE");
            invalidateCachedJson(CACHE_MAP);
            await load(false);
          } catch (e) {
            message.error((e as Error).message);
          }
        },
      }),
    [load]
  );

  const filtered = useMemo(
    () => rows.filter((x) => (!qChannel || x.channel === qChannel) && (!qGame || x.game === qGame)),
    [rows, qChannel, qGame]
  );

  const exportCurrent = useCallback(() => {
    void (async () => {
      const { buildExportFilename, exportRowsToXlsx } = await import("@/lib/export");
      exportRowsToXlsx(
        filtered.map((x) => ({
          映射ID: x.id,
          渠道: x.channel,
          游戏: x.game,
          渠道分成: `${toPercent(x.revenue_share_ratio)}%`,
          研发分成: `${toPercent(x.rd_settlement_ratio)}%`,
          发行分成: `${toPercent(calcPublishRatio(x.revenue_share_ratio, x.rd_settlement_ratio))}%`,
        })),
        buildExportFilename("channel_game_map", "xlsx")
      );
      message.success("导出成功");
    })();
  }, [filtered]);

  const mappingTemplateRows = useMemo(
    () => [
      { channel_name: "4399", game_name: "雷鸣三国" },
      { channel_name: "百度", game_name: "浮光幻想" },
      { channel_name: "小米", game_name: "剑影传说" },
    ],
    []
  );

  const downloadMappingTemplateCsv = useCallback(() => {
    void (async () => {
      const { buildExportFilename, exportRowsToCsv } = await import("@/lib/export");
      exportRowsToCsv(mappingTemplateRows, buildExportFilename("channel_game_map_template", "csv"));
      message.success("CSV 模板已下载");
    })();
  }, [mappingTemplateRows]);

  const downloadMappingTemplateXlsx = useCallback(() => {
    void (async () => {
      const { buildExportFilename, exportRowsToXlsx } = await import("@/lib/export");
      exportRowsToXlsx(mappingTemplateRows, buildExportFilename("channel_game_map_template", "xlsx"));
      message.success("XLSX 模板已下载");
    })();
  }, [mappingTemplateRows]);

  const gameByName = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.name, g));
    return m;
  }, [games]);

  const tableColumns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", width: 90 },
      { title: "渠道", dataIndex: "channel" },
      { title: "游戏", dataIndex: "game" },
      { title: "渠道分成", dataIndex: "revenue_share_ratio", render: (v: number) => `${toPercent(v)}%` },
      {
        title: "研发分成",
        render: (_: unknown, r: MapRow) => {
          const g = gameByName.get(r.game);
          const fromGame = g && typeof g.rd_share_percent === "number";
          const rdRatio = fromGame ? toRatio(g.rd_share_percent as number) : r.rd_settlement_ratio;
          return (
            <Space size={6}>
              <span>{`${toPercent(rdRatio)}%`}</span>
              {fromGame ? <Tag color="blue">来自游戏</Tag> : null}
            </Space>
          );
        },
      },
      {
        title: "发行分成",
        render: (_: unknown, r: MapRow) => {
          const g = gameByName.get(r.game);
          const rdRatio = g && typeof g.rd_share_percent === "number" ? toRatio(g.rd_share_percent) : r.rd_settlement_ratio;
          return `${toPercent(calcPublishRatio(r.revenue_share_ratio, rdRatio))}%`;
        },
      },
      {
        title: "合计",
        render: (_: unknown, r: MapRow) => {
          const g = gameByName.get(r.game);
          const rdRatio = g && typeof g.rd_share_percent === "number" ? toRatio(g.rd_share_percent) : r.rd_settlement_ratio;
          const publishRatio = calcPublishRatio(r.revenue_share_ratio, rdRatio);
          return `${toPercent(r.revenue_share_ratio + rdRatio + publishRatio)}%`;
        },
      },
      {
        title: "校验状态",
        render: (_: unknown, r: MapRow) => {
          const g = gameByName.get(r.game);
          const rdRatio = g && typeof g.rd_share_percent === "number" ? toRatio(g.rd_share_percent) : r.rd_settlement_ratio;
          const publishRatio = calcPublishRatio(r.revenue_share_ratio, rdRatio);
          const ok = isTotalValid(r.revenue_share_ratio, rdRatio, publishRatio);
          return <Tag color={ok ? "green" : "red"}>{ok ? "正常" : "异常"}</Tag>;
        },
      },
      {
        title: "操作",
        render: (_: unknown, r: MapRow) => (
          <Space>
            <Button size="small" onClick={() => router.push(`/channel-game-map/${r.id}/edit`)}>
              编辑
            </Button>
            <Button size="small" danger onClick={() => remove(r.id)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [gameByName, router, remove]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (searchParams.get("add") === "1") return;
    const chName = (searchParams.get("channel") || "").trim();
    const gmName = (searchParams.get("game") || "").trim();
    if (chName) setQChannel(chName);
    if (gmName) setQGame(gmName);
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("add") !== "1") return;
    if (!channels.length || !games.length) return;
    const chName = (searchParams.get("channel") || "").trim();
    const gmName = (searchParams.get("game") || "").trim();
    const sp = new URLSearchParams();
    if (chName) sp.set("channel", chName);
    if (gmName) sp.set("game", gmName);
    if (searchParams.get("return") === "import") sp.set("return", "import");
    const qs = sp.toString();
    router.replace(qs ? `/channel-game-map/new?${qs}` : "/channel-game-map/new", { scroll: false });
  }, [channels, games, searchParams, router]);

  const onBulkCompleted = useCallback(async () => {
    invalidateCachedJson(CACHE_MAP);
    await load(false);
  }, [load]);

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Card
        title="渠道-游戏映射"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="按渠道筛选"
              style={{ width: 160 }}
              options={channels.map((x) => ({ label: x.name, value: x.name }))}
              value={qChannel || undefined}
              onChange={(v) => setQChannel(v || "")}
            />
            <Select
              allowClear
              placeholder="按游戏筛选"
              style={{ width: 160 }}
              options={games.map((x) => ({ label: x.name, value: x.name }))}
              value={qGame || undefined}
              onChange={(v) => setQGame(v || "")}
            />
            <Button onClick={() => void load(true)}>刷新</Button>
            <Button onClick={exportCurrent}>导出当前筛选</Button>
            <Button onClick={downloadMappingTemplateCsv}>下载映射模板(CSV)</Button>
            <Button onClick={downloadMappingTemplateXlsx}>下载映射模板(XLSX)</Button>
            <Button onClick={() => setOpenBulk(true)}>批量导入</Button>
            <Button type="primary" onClick={() => router.push("/channel-game-map/new")}>
              新增映射
            </Button>
          </Space>
        }
      >
        <Table rowKey="id" dataSource={filtered} pagination={{ pageSize: 10 }} columns={tableColumns} />
        <ChannelGameMapBulkImport
          open={openBulk}
          onClose={() => setOpenBulk(false)}
          channels={channels}
          games={games}
          rows={rows}
          onCompleted={onBulkCompleted}
        />
      </Card>
    </RoleGuard>
  );
}
