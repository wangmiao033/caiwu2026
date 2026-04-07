"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Switch, Table, Tag, Upload, message } from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";
import * as XLSX from "xlsx";

type SimpleItem = { id: number; name: string };
type MapRow = { id: number; channel: string; game: string; revenue_share_ratio: number; rd_settlement_ratio: number };
type RuleRow = {
  key: string;
  row_no?: number;
  channel: string;
  game: string;
  discountType: "无" | "0.1折" | "0.05折";
  channelFee: number;
  taxRate: number;
  rdShare: number;
  privateRate: number;
  ipLicense: number;
  chaofanChannel: number;
  chaofanRd: number;
  enabled: boolean;
  remark?: string;
  error_message?: string;
  error_fields?: string[];
};

const defaultRule = (): Omit<RuleRow, "key" | "channel" | "game"> => ({
  discountType: "无",
  channelFee: 0,
  taxRate: 0,
  rdShare: 0.5,
  privateRate: 0,
  ipLicense: 0,
  chaofanChannel: 0,
  chaofanRd: 0,
  enabled: true,
  remark: "",
});

export default function BillingRulesPage() {
  const [channels, setChannels] = useState<SimpleItem[]>([]);
  const [games, setGames] = useState<SimpleItem[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [qChannel, setQChannel] = useState<string>("");
  const [qGame, setQGame] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<RuleRow[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    apiRequest<SimpleItem[]>("/channels").then(setChannels).catch(() => {});
    apiRequest<SimpleItem[]>("/games").then(setGames).catch(() => {});
    apiRequest<MapRow[]>("/channel-game-map")
      .then((data) => {
        setMaps(data);
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
  }, []);

  const saveLocal = (next: RuleRow[]) => {
    setRules(next);
    localStorage.setItem("billing_rules_local", JSON.stringify(next));
  };

  const filtered = useMemo(
    () => rules.filter((r) => (!qChannel || r.channel === qChannel) && (!qGame || r.game === qGame)),
    [rules, qChannel, qGame]
  );

  const onAdd = () => {
    setEditingKey(null);
    form.resetFields();
    setOpen(true);
  };

  const onEdit = (row: RuleRow) => {
    setEditingKey(row.key);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const channel = values.channel as string;
    const game = values.game as string;
    const key = `${channel}-${game}`;
    const item: RuleRow = { key, channel, game, ...values };
    const next = editingKey ? rules.map((x) => (x.key === editingKey ? item : x)) : [item, ...rules.filter((x) => x.key !== key)];
    saveLocal(next);

    try {
      await apiRequest("/billing/rules", "POST", {
        name: `${channel}-${game}-rule`,
        bill_type: "channel",
        default_ratio: Number(values.rdShare || 0.5),
      });
      message.success("规则已保存（并同步基础比例到后端）");
    } catch (e) {
      message.warning(`本地已保存，后端同步失败：${(e as Error).message}`);
    }
    setOpen(false);
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
          研发分成: 0.5,
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
      const cFee = Number(r["通道费"] || 0);
      const tRate = Number(r["税点"] || 0);
      const rd = Number(r["研发分成"] || 0.5);
      const pRate = Number(r["私点"] || 0);
      if (Number.isNaN(cFee)) errs.push("通道费格式非法");
      if (Number.isNaN(tRate)) errs.push("税点格式非法");
      if (Number.isNaN(rd)) errs.push("研发分成格式非法");
      if (Number.isNaN(pRate)) errs.push("私点格式非法");
      const row: RuleRow = {
        key: `${channel}-${game}-${idx}`,
        row_no: idx + 2,
        channel,
        game,
        discountType,
        channelFee: cFee,
        taxRate: tRate,
        rdShare: rd,
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
  const fieldErr = (row: RuleRow, key: string) => !!row.error_fields?.includes(key);
  const markCell = (value: unknown, row: RuleRow, key: string) => (
    <span style={{ background: fieldErr(row, key) ? "#fff1f0" : undefined, padding: "2px 6px", borderRadius: 4 }}>{String(value ?? "")}</span>
  );
  const exportErrors = () => {
    const errs = importRows.filter((x) => !!x.error_message);
    exportRowsToXlsx(errs as unknown as Record<string, unknown>[], buildExportFilename("billing_rules_import_errors", "xlsx"));
    message.success("导出成功");
  };
  const confirmImport = async () => {
    const valid = importRows.filter((x) => !x.error_message);
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
      message.success(`导入完成: 新增${summary.created_count} 更新${summary.updated_count} 失败${summary.failed_count}`);
      setImportOpen(false);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const exportCurrent = () => {
    exportRowsToXlsx(filtered as unknown as Record<string, unknown>[], buildExportFilename("billing_rules", "xlsx"));
    message.success("导出成功");
  };
  const exportAll = () => {
    exportRowsToXlsx(rules as unknown as Record<string, unknown>[], buildExportFilename("billing_rules_all", "xlsx"));
    message.success("导出成功");
  };

  return (
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
          <Button type="primary" onClick={onAdd}>
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
      <Table
        rowKey="key"
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "渠道", dataIndex: "channel" },
          { title: "游戏", dataIndex: "game" },
          { title: "折扣", dataIndex: "discountType" },
          { title: "通道费", dataIndex: "channelFee" },
          { title: "税点", dataIndex: "taxRate" },
          { title: "研发分成", dataIndex: "rdShare" },
          { title: "私点", dataIndex: "privateRate" },
          {
            title: "状态",
            dataIndex: "enabled",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>,
          },
          { title: "操作", render: (_, r) => <Button type="link" onClick={() => onEdit(r)}>编辑</Button> },
        ]}
      />

      <Modal open={open} title={editingKey ? "编辑规则" : "新增规则"} onCancel={() => setOpen(false)} onOk={onSubmit}>
        <Form form={form} layout="vertical" initialValues={{ ...defaultRule(), channel: maps[0]?.channel, game: maps[0]?.game }}>
          <Form.Item label="渠道" name="channel" rules={[{ required: true }]}>
            <Select options={channels.map((x) => ({ label: x.name, value: x.name }))} />
          </Form.Item>
          <Form.Item label="游戏" name="game" rules={[{ required: true }]}>
            <Select options={games.map((x) => ({ label: x.name, value: x.name }))} />
          </Form.Item>
          <Form.Item label="折扣类型" name="discountType">
            <Select options={[{ label: "无", value: "无" }, { label: "0.1折", value: "0.1折" }, { label: "0.05折", value: "0.05折" }]} />
          </Form.Item>
          <Form.Item label="通道费" name="channelFee"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="税点" name="taxRate"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="研发分成" name="rdShare"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="私点" name="privateRate"><InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="IP授权（预留）" name="ipLicense"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="超凡与渠道（预留）" name="chaofanChannel"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="超凡与研发（预留）" name="chaofanRd"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item label="备注" name="remark"><Input /></Form.Item>
        </Form>
      </Modal>
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
            { title: "通道费", dataIndex: "channelFee", render: (v, r) => markCell(v, r, "channel_fee") },
            { title: "税点", dataIndex: "taxRate", render: (v, r) => markCell(v, r, "tax_rate") },
            { title: "研发分成", dataIndex: "rdShare", render: (v, r) => markCell(v, r, "rd_share") },
            { title: "私点", dataIndex: "privateRate", render: (v, r) => markCell(v, r, "private_rate") },
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
  );
}
