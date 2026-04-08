"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Input, Modal, Select, Space, Statistic, Switch, Table, Tag, Upload, message } from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";
import * as XLSX from "xlsx";
import RoleGuard from "@/components/RoleGuard";
import {
  defaultRule,
  formatRatioAsPercent,
  getRulesFromStorageOrMaps,
  percentToRatio,
  rdRatioForGameName,
  type GameItem,
  type MapRow,
  type RuleRow,
  saveRulesToStorage,
  type SimpleItem,
} from "./billing-rules-shared";

export default function BillingRulesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [channels, setChannels] = useState<SimpleItem[]>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [qChannel, setQChannel] = useState<string>("");
  const [qGame, setQGame] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<RuleRow[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEffect(() => {
    const ch = searchParams.get("channel");
    const gm = searchParams.get("game");
    if (ch) setQChannel(ch);
    if (gm) setQGame(gm);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chRes, gmRes, mapRes] = await Promise.all([
          apiRequest<SimpleItem[]>("/channels"),
          apiRequest<GameItem[]>("/games"),
          apiRequest<MapRow[]>("/channel-game-map"),
        ]);
        if (cancelled) return;
        setChannels(chRes);
        setGames(gmRes);
        setRules(getRulesFromStorageOrMaps(mapRes, gmRes));
      } catch {
        if (!cancelled) {
          apiRequest<SimpleItem[]>("/channels").then(setChannels).catch(() => {});
          apiRequest<GameItem[]>("/games").then(setGames).catch(() => {});
          apiRequest<MapRow[]>("/channel-game-map")
            .then((data) => {
              const cache = localStorage.getItem("billing_rules_local");
              if (cache) {
                setRules(JSON.parse(cache));
              } else {
                setRules(
                  data.map((x) => ({
                    key: `${x.channel}-${x.game}`,
                    channel: x.channel,
                    game: x.game,
                    ...defaultRule(),
                    rdShare: Number(x.rd_settlement_ratio ?? 0.5),
                  }))
                );
              }
            })
            .catch(() => {});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLocal = (next: RuleRow[]) => {
    setRules(next);
    saveRulesToStorage(next);
  };

  const filtered = useMemo(
    () => rules.filter((r) => (!qChannel || r.channel === qChannel) && (!qGame || r.game === qGame)),
    [rules, qChannel, qGame]
  );

  const goNew = () => {
    const sp = new URLSearchParams();
    if (qChannel) sp.set("channel", qChannel);
    if (qGame) sp.set("game", qGame);
    router.push(sp.toString() ? `/billing-rules/new?${sp.toString()}` : "/billing-rules/new");
  };

  const downloadTemplate = () => {
    exportRowsToXlsx(
      [
        {
          游戏: "游戏A",
          渠道: "渠道A",
          折扣类型: "无",
          通道费: 0,
          税点: 0,
          研发分成: 50,
          私点: 0,
          IP授权: 0,
          超凡与渠道: 0,
          超凡与研发: 0,
          状态: "启用",
          备注: "",
        },
      ],
      buildExportFilename("billing_rules_template", "xlsx")
    );
  };

  const parseImport = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const parsed = rows.map((r, idx) => {
      const channel = String(r["渠道"] || "").trim();
      const game = String(r["游戏"] || "").trim();
      const discountType = (String(r["折扣类型"] || "无").trim() || "无") as RuleRow["discountType"];
      const enabled = String(r["状态"] || "启用").includes("启");
      const errs: string[] = [];
      if (!game) errs.push("游戏为空");
      if (!channel) errs.push("渠道为空");
      if (!["无", "0.1折", "0.05折"].includes(discountType)) errs.push("折扣类型非法");
      const cFeePercent = Number(r["通道费"] || 0);
      const tRatePercent = Number(r["税点"] || 0);
      const pRatePercent = Number(r["私点"] || 0);
      const cFee = percentToRatio(cFeePercent);
      const tRate = percentToRatio(tRatePercent);
      const rdRatio = rdRatioForGameName(games, game);
      const pRate = percentToRatio(pRatePercent);
      if (Number.isNaN(cFeePercent)) errs.push("通道费格式非法");
      if (Number.isNaN(tRatePercent)) errs.push("税点格式非法");
      if (Number.isNaN(pRatePercent)) errs.push("私点格式非法");
      const row: RuleRow = {
        key: `${channel}-${game}-${idx}`,
        row_no: idx + 2,
        channel,
        game,
        discountType,
        channelFee: cFee,
        taxRate: tRate,
        rdShare: rdRatio,
        privateRate: pRate,
        ipLicense: Number(r["IP授权"] || 0),
        chaofanChannel: Number(r["超凡与渠道"] || 0),
        chaofanRd: Number(r["超凡与研发"] || 0),
        enabled,
        remark: String(r["备注"] || ""),
        error_message: errs.join("；"),
        error_fields: [],
      };
      return row;
    });
    try {
      const resp = await apiRequest<{ error_details: Array<{ row_no: number; error_fields: string[]; error_message: string }> }>(
        "/billing/rules/bulk-validate",
        "POST",
        {
          rows: parsed.map((x) => ({
            row_no: x.row_no,
            game: x.game,
            channel: x.channel,
            discount_type: x.discountType,
            channel_fee: x.channelFee,
            tax_rate: x.taxRate,
            rd_share: x.rdShare,
            private_rate: x.privateRate,
            ip_license: x.ipLicense,
            chaofan_channel: x.chaofanChannel,
            chaofan_rd: x.chaofanRd,
            status: x.enabled ? "启用" : "停用",
            remark: x.remark || "",
          })),
        }
      );
      const errorByRow = new Map(resp.error_details.map((e) => [e.row_no, e]));
      setImportRows(
        parsed.map((x) => {
          const hit = errorByRow.get(x.row_no || -1);
          if (!hit) return x;
          return { ...x, error_message: hit.error_message, error_fields: hit.error_fields || [] };
        })
      );
    } catch {
      setImportRows(parsed);
    }
    setImportOpen(true);
  };

  const importErrCount = importRows.filter((x) => !!x.error_message).length;
  const importOkCount = importRows.length - importErrCount;
  const previewRows = onlyErrors ? importRows.filter((x) => !!x.error_message) : importRows;
  const fieldErr = (row: RuleRow, ky: string) => !!row.error_fields?.includes(ky);
  const markCell = (value: unknown, row: RuleRow, ky: string) => (
    <span style={{ background: fieldErr(row, ky) ? "#fff1f0" : undefined, padding: "2px 6px", borderRadius: 4 }}>{String(value ?? "")}</span>
  );
  const exportErrors = () => {
    const errs = importRows.filter((x) => !!x.error_message);
    exportRowsToXlsx(errs as unknown as Record<string, unknown>[], buildExportFilename("billing_rules_import_errors", "xlsx"));
    message.success("导出成功");
  };
  const confirmImport = async () => {
    const valid = importRows.filter((x) => !x.error_message);
    Modal.confirm({
      title: "确认导入规则",
      content: `本次将导入 ${valid.length} 条有效规则，可能覆盖同渠道同游戏的历史规则。确认继续吗？`,
      onOk: async () => {
        message.loading({ content: "正在导入规则...", key: "rule_import" });
        try {
          const summary = await apiRequest<{ created_count: number; updated_count: number; failed_count: number }>(
            "/billing/rules/bulk-import",
            "POST",
            {
              rows: valid.map((x) => ({
                game: x.game,
                channel: x.channel,
                discount_type: x.discountType,
                channel_fee: x.channelFee,
                tax_rate: x.taxRate,
                rd_share: x.rdShare,
                private_rate: x.privateRate,
                ip_license: x.ipLicense,
                chaofan_channel: x.chaofanChannel,
                chaofan_rd: x.chaofanRd,
                status: x.enabled ? "启用" : "停用",
                remark: x.remark || "",
              })),
            }
          );
          saveLocal([...valid, ...rules.filter((x) => !valid.some((v) => `${v.channel}-${v.game}` === `${x.channel}-${x.game}`))]);
          message.success({ content: `导入完成: 新增${summary.created_count} 更新${summary.updated_count} 失败${summary.failed_count}`, key: "rule_import" });
          setImportOpen(false);
        } catch (e) {
          message.error({ content: (e as Error).message, key: "rule_import" });
        }
      },
    });
  };

  const exportCurrent = () => {
    exportRowsToXlsx(filtered as unknown as Record<string, unknown>[], buildExportFilename("billing_rules", "xlsx"));
    message.success("导出成功");
  };
  const exportAll = () => {
    exportRowsToXlsx(rules as unknown as Record<string, unknown>[], buildExportFilename("billing_rules_all", "xlsx"));
    message.success("导出成功");
  };

  const qpCh = (searchParams.get("channel") || "").trim();
  const qpGm = (searchParams.get("game") || "").trim();
  const fromExceptionJump = Boolean(qpCh || qpGm);
  const fromImportPrecheckPair = Boolean(qpCh && qpGm);

  return (
    <RoleGuard allow={["admin", "finance_manager"]}>
      <Card
        title="规则配置（游戏 + 渠道）"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="筛选渠道"
              style={{ width: 160 }}
              options={channels.map((x) => ({ label: x.name, value: x.name }))}
              value={qChannel || undefined}
              onChange={(v) => setQChannel(v || "")}
            />
            <Select
              allowClear
              placeholder="筛选游戏"
              style={{ width: 160 }}
              options={games.map((x) => ({ label: x.name, value: x.name }))}
              value={qGame || undefined}
              onChange={(v) => setQGame(v || "")}
            />
            <Button type="primary" onClick={goNew}>
              新增规则
            </Button>
            <Button onClick={downloadTemplate}>模板下载</Button>
            <Upload beforeUpload={(file) => { parseImport(file); return false; }} showUploadList={false}>
              <Button>导入规则</Button>
            </Upload>
            <Button onClick={exportCurrent}>导出当前筛选</Button>
            <Button onClick={exportAll}>导出全部</Button>
          </Space>
        }
      >
        {fromExceptionJump ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              fromImportPrecheckPair
                ? "导入预检：研发分成来自游戏主数据，请勿在本页修改研发分成"
                : "处理分成异常时请先核对主数据与映射"
            }
            description={
              fromImportPrecheckPair
                ? "请在下方表格中定位该渠道与游戏，补齐通道费、税点、私点等计费字段并保存。研发分成请前往「游戏管理」维护。"
                : "研发分成以「游戏管理」中的研发分成(%)为准；渠道侧分成请在「渠道-游戏映射」中维护。本页规则中的研发分成仅展示游戏主数据，不可在此修改。"
            }
          />
        ) : null}
        <Table
          rowKey="key"
          dataSource={filtered}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "渠道", dataIndex: "channel" },
            { title: "游戏", dataIndex: "game" },
            { title: "折扣", dataIndex: "discountType" },
            { title: "通道费", dataIndex: "channelFee", render: (v: number) => formatRatioAsPercent(v) },
            { title: "税点", dataIndex: "taxRate", render: (v: number) => formatRatioAsPercent(v) },
            {
              title: "研发分成",
              dataIndex: "rdShare",
              render: (_: number, r: RuleRow) => formatRatioAsPercent(rdRatioForGameName(games, r.game)),
            },
            { title: "私点", dataIndex: "privateRate", render: (v: number) => formatRatioAsPercent(v) },
            {
              title: "状态",
              dataIndex: "enabled",
              render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
            },
            {
              title: "操作",
              render: (_, r) => (
                <Button type="link" onClick={() => router.push(`/billing-rules/${encodeURIComponent(r.key)}/edit`)}>
                  编辑
                </Button>
              ),
            },
          ]}
        />

        <Modal
          open={importOpen}
          width={980}
          title="规则导入预览"
          onCancel={() => setImportOpen(false)}
          onOk={confirmImport}
          okText="确认导入"
        >
          <Space size={24} style={{ marginBottom: 12 }}>
            <Statistic title="总行数" value={importRows.length} />
            <Statistic title="正常行数" value={importOkCount} />
            <Statistic title="异常行数" value={importErrCount} valueStyle={{ color: importErrCount ? "#cf1322" : undefined }} />
          </Space>
          <Space style={{ marginBottom: 8 }}>
            <Button size="small" type={!onlyErrors ? "primary" : "default"} onClick={() => setOnlyErrors(false)}>
              预览全部
            </Button>
            <Button size="small" type={onlyErrors ? "primary" : "default"} onClick={() => setOnlyErrors(true)}>
              仅查看异常行
            </Button>
            <Button size="small" onClick={exportErrors}>
              导出异常
            </Button>
          </Space>
          <Table
            rowKey="key"
            dataSource={previewRows}
            pagination={{ pageSize: 8 }}
            rowClassName={(r) => (r.error_message ? "row-error" : "")}
            columns={[
              { title: "Excel行号", dataIndex: "row_no", width: 100 },
              { title: "渠道", dataIndex: "channel", render: (v, r) => markCell(v, r, "channel") },
              { title: "游戏", dataIndex: "game", render: (v, r) => markCell(v, r, "game") },
              { title: "折扣类型", dataIndex: "discountType", render: (v, r) => markCell(v, r, "discount_type") },
              { title: "通道费", dataIndex: "channelFee", render: (v, r) => markCell(formatRatioAsPercent(Number(v || 0)), r, "channel_fee") },
              { title: "税点", dataIndex: "taxRate", render: (v, r) => markCell(formatRatioAsPercent(Number(v || 0)), r, "tax_rate") },
              { title: "研发分成", dataIndex: "rdShare", render: (v, r) => markCell(formatRatioAsPercent(Number(v || 0)), r, "rd_share") },
              { title: "私点", dataIndex: "privateRate", render: (v, r) => markCell(formatRatioAsPercent(Number(v || 0)), r, "private_rate") },
              { title: "状态", dataIndex: "enabled", render: (v, r) => markCell(v ? "启用" : "停用", r, "status") },
              {
                title: "异常原因",
                dataIndex: "error_message",
                render: (v: string) => v || "-",
              },
            ]}
          />
        </Modal>
        <style jsx global>{`
          .row-error td {
            background: #fff1f0 !important;
          }
        `}</style>
      </Card>
    </RoleGuard>
  );
}
