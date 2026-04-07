"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import { apiRequest, apiRequestDirect } from "@/lib/api";

type PreviewRow = {
  key: number;
  channel_name: string;
  game_name: string;
  gross_amount: string | number;
  status: "正常" | "异常";
};

type OptionItem = {
  id: number;
  name: string;
};

type MappingItem = {
  id: number;
  channel: string;
  game: string;
};

type ManualRow = {
  key: number;
  channel_name?: string;
  game_name?: string;
  gross_amount?: number;
};

type ImportHistoryRow = {
  key: number;
  fileName: string;
  period: string;
  importedAt: string;
  issueCount: number;
  status: string;
};

type ExtractRow = {
  __rowNum__: number;
  game_name: string;
  channel_name: string;
  gross_amount_raw: string;
  gross_amount?: number;
  error?: string;
};

export default function ImportPage() {
  const router = useRouter();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [period, setPeriod] = useState("2026-03");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [channels, setChannels] = useState<OptionItem[]>([]);
  const [games, setGames] = useState<OptionItem[]>([]);
  const [maps, setMaps] = useState<MappingItem[]>([]);
  const [manualRows, setManualRows] = useState<ManualRow[]>([{ key: 1 }]);
  const [history, setHistory] = useState<ImportHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [extractSheets, setExtractSheets] = useState<string[]>([]);
  const [extractSheet, setExtractSheet] = useState<string>("");
  const [titleRow, setTitleRow] = useState<number>(1);
  const [rawHeader, setRawHeader] = useState<string[]>([]);
  const [rawBody, setRawBody] = useState<(string | number | null)[][]>([]);
  const [gameCol, setGameCol] = useState<string>("");
  const [channelCol, setChannelCol] = useState<string>("");
  const [amountCol, setAmountCol] = useState<string>("");
  const [extractRows, setExtractRows] = useState<ExtractRow[]>([]);
  const [onlyShowExtractErrors, setOnlyShowExtractErrors] = useState(false);

  useEffect(() => {
    apiRequest<OptionItem[]>("/channels")
      .then(setChannels)
      .catch(() => {});
    apiRequest<OptionItem[]>("/games")
      .then(setGames)
      .catch(() => {});
    apiRequest<{ channel: string; game: string }[]>("/channel-game-map")
      .then((data) => setMaps(data.map((x, idx) => ({ id: idx + 1, channel: x.channel, game: x.game }))))
      .catch(() => {});
    const saved = localStorage.getItem("import_history");
    if (saved) {
      setHistory(JSON.parse(saved));
    }
    const manualDraft = localStorage.getItem("manual_import_draft");
    if (manualDraft) {
      try {
        const draftRows = JSON.parse(manualDraft) as ManualRow[];
        if (Array.isArray(draftRows) && draftRows.length > 0) {
          setManualRows(draftRows);
        }
      } catch {}
    }
    const mappingDraft = localStorage.getItem("extract_mapping_draft");
    if (mappingDraft) {
      try {
        const draft = JSON.parse(mappingDraft) as { gameCol?: string; channelCol?: string; amountCol?: string; titleRow?: number };
        if (draft.gameCol) setGameCol(draft.gameCol);
        if (draft.channelCol) setChannelCol(draft.channelCol);
        if (draft.amountCol) setAmountCol(draft.amountCol);
        if (typeof draft.titleRow === "number") setTitleRow(draft.titleRow);
      } catch {}
    }
  }, []);

  const parseFile = async (f: File) => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const data = rows.map((r, idx) => {
      const channel = String(r.channel_name || "").trim();
      const game = String(r.game_name || "").trim();
      const amount = r.gross_amount as string | number;
      const ok = channel && game && amount !== undefined && amount !== null && amount !== "";
      return {
        key: idx + 1,
        channel_name: channel,
        game_name: game,
        gross_amount: amount,
        status: ok ? "正常" : "异常",
      } as PreviewRow;
    });
    setPreview(data);
  };

  const pushHistory = (row: Omit<ImportHistoryRow, "key">) => {
    const next = [{ key: Date.now(), ...row }, ...history].slice(0, 20);
    setHistory(next);
    localStorage.setItem("import_history", JSON.stringify(next));
  };

  const upload = async () => {
    if (!fileList[0]?.originFileObj) {
      message.warning("请先选择文件");
      return;
    }
    Modal.confirm({
      title: "确认导入",
      content: `确认将文件导入账期 ${period} 吗？`,
      onOk: async () => {
        const formData = new FormData();
        formData.append("file", fileList[0].originFileObj as File);
        try {
          const data = await apiRequest<Record<string, unknown>>(`/recon/import?period=${encodeURIComponent(period)}`, "POST", formData, true);
          setResult(data);
          pushHistory({
            fileName: fileList[0].name || "unknown.xlsx",
            period,
            importedAt: new Date().toLocaleString(),
            issueCount: Number(data.issue_count || 0),
            status: Number(data.issue_count || 0) > 0 ? "异常待处理" : "待确认",
          });
          message.success("导入完成");
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const checkedManualRows = useMemo(
    () =>
      manualRows.map((r) => {
        const valid = !!r.channel_name && !!r.game_name && typeof r.gross_amount === "number" && !Number.isNaN(r.gross_amount);
        return { ...r, status: valid ? "正常" : "异常" as "正常" | "异常" };
      }),
    [manualRows]
  );

  const addRow = () => setManualRows((prev) => [...prev, { key: Date.now() }]);
  const deleteRow = (key: number) => setManualRows((prev) => prev.filter((r) => r.key !== key));
  const updateRow = (key: number, patch: Partial<ManualRow>) =>
    setManualRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submitManual = async () => {
    const invalid = checkedManualRows.filter((r) => r.status === "异常");
    if (checkedManualRows.length === 0) {
      message.warning("请先录入数据");
      return;
    }
    if (invalid.length > 0) {
      message.error(`存在 ${invalid.length} 行异常，请先修正`);
      return;
    }
    Modal.confirm({
      title: "确认导入",
      content: "确认提交手动录入数据？",
      onOk: async () => {
        try {
          const data = await apiRequestDirect<Record<string, unknown>>("/api/recon/manual", "POST", {
            period,
            rows: checkedManualRows.map((r) => ({
              channel_name: r.channel_name,
              game_name: r.game_name,
              gross_amount: r.gross_amount,
            })),
          });
          setResult(data);
          pushHistory({
            fileName: "manual-input",
            period,
            importedAt: new Date().toLocaleString(),
            issueCount: Number(data.issue_count || 0),
            status: Number(data.issue_count || 0) > 0 ? "异常待处理" : "待确认",
          });
          message.success("手动数据提交成功");
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const pasteBatch = (text: string) => {
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const parts = line.split(/\t|,/);
        return {
          key: Date.now() + idx,
          game_name: parts[0]?.trim(),
          channel_name: parts[1]?.trim(),
          gross_amount: Number((parts[2] || "").replace(/,/g, "")),
        } as ManualRow;
      });
    setManualRows(rows);
  };
  const clearManualRows = () => {
    setManualRows([{ key: Date.now() }]);
    localStorage.removeItem("manual_import_draft");
  };
  const saveManualDraft = () => {
    localStorage.setItem("manual_import_draft", JSON.stringify(manualRows));
    message.success("草稿已保存");
  };

  const downloadTemplate = () => {
    const csv = "channel_name,game_name,gross_amount\n渠道A,游戏X,100000\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExceptions = () => {
    const bad = preview.filter((x) => x.status === "异常");
    if (!bad.length) {
      message.info("当前无异常数据");
      return;
    }
    const csv = ["channel_name,game_name,gross_amount,status", ...bad.map((x) => `${x.channel_name},${x.game_name},${x.gross_amount},${x.status}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_exceptions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExtractFile = async (file: File) => {
    setExtractFile(file);
    setExtractRows([]);
    setRawBody([]);
    setRawHeader([]);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("action", "sheets");
    try {
      setLoading(true);
      const data = await apiRequestDirect<{ sheets: string[] }>("/api/recon/preview", "POST", fd, true);
      setExtractSheets(data.sheets || []);
      setExtractSheet((data.sheets || [])[0] || "");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadRawPreview = async () => {
    if (!extractFile || !extractSheet) return;
    const fd = new FormData();
    fd.append("file", extractFile);
    fd.append("action", "tablePreview");
    fd.append("sheetName", extractSheet);
    fd.append("titleRow", String(titleRow));
    try {
      setLoading(true);
      const data = await apiRequestDirect<{ header: string[]; body: (string | number | null)[][] }>("/api/recon/preview", "POST", fd, true);
      const header = (data.header || []).map((x) => String(x || "").trim());
      setRawHeader(header);
      setRawBody(data.body || []);
      if (!gameCol) setGameCol(header[0] || "");
      if (!channelCol) setChannelCol(header[1] || "");
      if (!amountCol) setAmountCol(header[2] || "");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadNormalizedPreview = async () => {
    if (!extractFile || !extractSheet) return;
    const fd = new FormData();
    fd.append("file", extractFile);
    fd.append("action", "normalizePreview");
    fd.append("sheetName", extractSheet);
    fd.append("titleRow", String(titleRow));
    fd.append("gameCol", gameCol);
    fd.append("channelCol", channelCol);
    fd.append("amountCol", amountCol);
    try {
      setLoading(true);
      const data = await apiRequestDirect<{ rows: ExtractRow[] }>("/api/recon/preview", "POST", fd, true);
      setExtractRows(data.rows || []);
      localStorage.setItem(
        "extract_mapping_draft",
        JSON.stringify({ gameCol, channelCol, amountCol, titleRow })
      );
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const confirmExtractImport = async () => {
    const validRows = extractRows.filter((x) => !x.error && typeof x.gross_amount === "number");
    if (!validRows.length) {
      message.warning("没有可导入的有效数据");
      return;
    }
    Modal.confirm({
      title: "确认导入",
      content: `将导入 ${validRows.length} 行有效数据，是否继续？`,
      onOk: async () => {
        try {
          const data = await apiRequestDirect<Record<string, unknown>>("/api/recon/extract", "POST", { period, rows: validRows });
          setResult(data);
          pushHistory({
            fileName: extractFile?.name || "extract-import.xlsx",
            period,
            importedAt: new Date().toLocaleString(),
            issueCount: Number(data.issue_count || 0),
            status: Number(data.issue_count || 0) > 0 ? "异常待处理" : "待确认",
          });
          message.success("原表提取导入成功");
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const manualTotalAmount = checkedManualRows.reduce((sum, r) => sum + (typeof r.gross_amount === "number" ? r.gross_amount : 0), 0);
  const manualErrCount = checkedManualRows.filter((r) => r.status === "异常").length;
  const extractTotal = extractRows.reduce((sum, x) => sum + (x.gross_amount || 0), 0);
  const extractErr = extractRows.filter((x) => !!x.error).length;
  const extractOk = extractRows.length - extractErr;
  const extractRowsShown = onlyShowExtractErrors ? extractRows.filter((x) => !!x.error) : extractRows;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="数据导入">
        <Form layout="inline">
          <Form.Item label="账期">
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Form.Item>
        </Form>
        <Tabs
          style={{ marginTop: 12 }}
          items={[
            {
              key: "excel",
              label: "Excel导入",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space wrap>
                    <Upload
                      beforeUpload={(file) => {
                        setFileList([file]);
                        parseFile(file);
                        return false;
                      }}
                      fileList={fileList}
                      onRemove={() => {
                        setFileList([]);
                        setPreview([]);
                      }}
                    >
                      <Button icon={<UploadOutlined />}>选择文件</Button>
                    </Upload>
                    <Button type="primary" onClick={upload}>
                      上传并导入
                    </Button>
                    <Button onClick={downloadTemplate}>模板下载</Button>
                    <Button onClick={exportExceptions}>异常导出</Button>
                    <Button onClick={() => router.push("/recon-tasks")}>去核对任务页</Button>
                  </Space>
                  <Table
                    rowKey="key"
                    dataSource={preview}
                    pagination={{ pageSize: 10 }}
                    rowClassName={(r) => (r.status === "异常" ? "row-error" : "")}
                    columns={[
                      { title: "渠道", dataIndex: "channel_name" },
                      { title: "游戏", dataIndex: "game_name" },
                      { title: "流水", dataIndex: "gross_amount" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (v: string) => <Tag color={v === "异常" ? "red" : "green"}>{v}</Tag>,
                      },
                    ]}
                  />
                  <Card title="导入历史" size="small">
                    <Table
                      size="small"
                      rowKey="key"
                      dataSource={history}
                      locale={{ emptyText: <Empty description="暂无导入历史" /> }}
                      pagination={{ pageSize: 5 }}
                      columns={[
                        { title: "文件名", dataIndex: "fileName" },
                        { title: "账期", dataIndex: "period" },
                        { title: "导入时间", dataIndex: "importedAt" },
                        { title: "issue_count", dataIndex: "issueCount" },
                        {
                          title: "状态",
                          dataIndex: "status",
                          render: (v: string) => <Tag color={v === "异常待处理" ? "red" : "blue"}>{v}</Tag>,
                        },
                      ]}
                    />
                  </Card>
                </Space>
              ),
            },
            {
              key: "manual",
              label: "手动录入",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Input.TextArea
                    rows={4}
                    placeholder="支持批量粘贴：游戏,渠道,流水（可用制表符或逗号分隔）"
                    onBlur={(e) => {
                      if (e.target.value.trim()) {
                        pasteBatch(e.target.value);
                      }
                    }}
                  />
                  <RowStats total={checkedManualRows.length} errors={manualErrCount} amount={manualTotalAmount} />
                  <Space wrap>
                    <Button icon={<PlusOutlined />} onClick={addRow}>
                      新增行
                    </Button>
                    <Button onClick={clearManualRows}>清空当前录入</Button>
                    <Button onClick={saveManualDraft}>保存草稿到本地</Button>
                    <Button type="primary" onClick={submitManual}>
                      提交数据
                    </Button>
                    <Button onClick={() => router.push("/recon-tasks")}>提交后去核对任务页</Button>
                  </Space>
                  <Table
                    rowKey="key"
                    dataSource={checkedManualRows}
                    pagination={{ pageSize: 10 }}
                    rowClassName={(r) => (r.status === "异常" ? "row-error" : "")}
                    columns={[
                      {
                        title: "渠道",
                        render: (_, r) => (
                          <Select
                            style={{ width: "100%" }}
                            placeholder="请选择渠道"
                            options={channels.map((x) => ({ label: x.name, value: x.name }))}
                            value={r.channel_name}
                            onChange={(v) => updateRow(r.key, { channel_name: v })}
                          />
                        ),
                      },
                      {
                        title: "游戏",
                        render: (_, r) => (
                          <Select
                            style={{ width: "100%" }}
                            placeholder="请选择游戏"
                            options={games
                              .filter((g) => !r.channel_name || maps.some((m) => m.channel === r.channel_name && m.game === g.name))
                              .map((x) => ({ label: x.name, value: x.name }))}
                            value={r.game_name}
                            onChange={(v) => updateRow(r.key, { game_name: v })}
                          />
                        ),
                      },
                      {
                        title: "流水",
                        render: (_, r) => (
                          <InputNumber
                            style={{ width: "100%" }}
                            placeholder="请输入数字"
                            value={r.gross_amount}
                            onChange={(v) => updateRow(r.key, { gross_amount: typeof v === "number" ? v : undefined })}
                          />
                        ),
                      },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (v: string) => <Tag color={v === "异常" ? "red" : "green"}>{v}</Tag>,
                      },
                      {
                        title: "操作",
                        width: 80,
                        render: (_, r) => (
                          <Button danger type="link" icon={<DeleteOutlined />} onClick={() => deleteRow(r.key)} />
                        ),
                      },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: "extract",
              label: "原表提取导入",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Space wrap>
                    <Upload
                      maxCount={1}
                      beforeUpload={(file) => {
                        handleExtractFile(file);
                        return false;
                      }}
                      onRemove={() => {
                        setExtractFile(null);
                        setExtractRows([]);
                        setRawBody([]);
                        setRawHeader([]);
                      }}
                    >
                      <Button icon={<UploadOutlined />}>上传原始Excel</Button>
                    </Upload>
                    <Select
                      placeholder="选择Sheet"
                      style={{ width: 180 }}
                      options={extractSheets.map((x) => ({ label: x, value: x }))}
                      value={extractSheet || undefined}
                      onChange={setExtractSheet}
                    />
                    <InputNumber min={1} value={titleRow} onChange={(v) => setTitleRow(Number(v) || 1)} placeholder="标题行号" />
                    <Button onClick={loadRawPreview}>读取预览</Button>
                  </Space>
                  {loading && <Spin />}
                  {!!rawHeader.length && (
                    <Card size="small" title="字段映射">
                      <Space wrap>
                        <Select style={{ width: 180 }} placeholder="游戏列" value={gameCol} onChange={setGameCol} options={rawHeader.map((h) => ({ label: h, value: h }))} />
                        <Select style={{ width: 180 }} placeholder="渠道列" value={channelCol} onChange={setChannelCol} options={rawHeader.map((h) => ({ label: h, value: h }))} />
                        <Select style={{ width: 180 }} placeholder="流水列" value={amountCol} onChange={setAmountCol} options={rawHeader.map((h) => ({ label: h, value: h }))} />
                        <Button type="primary" onClick={loadNormalizedPreview}>
                          标准化预览
                        </Button>
                      </Space>
                    </Card>
                  )}
                  {!!rawBody.length && (
                    <Card size="small" title="原表预览（前20行）">
                      <Table
                        rowKey={(_, idx) => String(idx)}
                        size="small"
                        dataSource={rawBody.map((r, i) => ({ key: i, ...Object.fromEntries(rawHeader.map((h, idx) => [h || `列${idx + 1}`, r[idx]])) }))}
                        pagination={false}
                        columns={rawHeader.map((h, idx) => ({ title: h || `列${idx + 1}`, dataIndex: h || `列${idx + 1}` }))}
                      />
                    </Card>
                  )}
                  {!!extractRows.length && (
                    <Card size="small" title="标准化结果预览">
                      <RowStats total={extractRows.length} errors={extractErr} amount={extractTotal} />
                      <div style={{ marginBottom: 8 }}>
                        正常行数：{extractOk} 行
                      </div>
                      <Space style={{ marginBottom: 8 }}>
                        <Button size="small" onClick={() => setOnlyShowExtractErrors(false)} type={!onlyShowExtractErrors ? "primary" : "default"}>
                          预览全部
                        </Button>
                        <Button size="small" onClick={() => setOnlyShowExtractErrors(true)} type={onlyShowExtractErrors ? "primary" : "default"}>
                          仅预览异常行
                        </Button>
                      </Space>
                      <Table
                        rowKey={(r) => `${r.__rowNum__}-${r.game_name}-${r.channel_name}`}
                        dataSource={extractRowsShown}
                        rowClassName={(r) => (r.error ? "row-error" : "")}
                        pagination={{ pageSize: 10 }}
                        columns={[
                          { title: "原始行号", dataIndex: "__rowNum__" },
                          { title: "游戏", dataIndex: "game_name" },
                          { title: "渠道", dataIndex: "channel_name" },
                          { title: "流水", dataIndex: "gross_amount" },
                          { title: "异常", dataIndex: "error", render: (v: string) => (v ? <Tag color="red">{v}</Tag> : <Tag color="green">正常</Tag>) },
                        ]}
                      />
                      <Space style={{ marginTop: 8 }}>
                        <Button type="primary" onClick={confirmExtractImport}>
                          确认导入
                        </Button>
                        <Button onClick={() => router.push("/recon-tasks")}>去核对任务页</Button>
                      </Space>
                    </Card>
                  )}
                </Space>
              ),
            },
          ]}
        />
        {result && <div style={{ marginTop: 12 }}>提交结果：{JSON.stringify(result)}</div>}
      </Card>
      <style jsx global>{`
        .row-error td {
          background: #fff1f0 !important;
        }
      `}</style>
    </Space>
  );
}

function RowStats({ total, errors, amount }: { total: number; errors: number; amount: number }) {
  return (
    <Space size={24}>
      <Statistic title="总行数" value={total} />
      <Statistic title="异常行数" value={errors} valueStyle={{ color: errors > 0 ? "#cf1322" : undefined }} />
      <Statistic title="流水合计" value={amount} precision={2} />
    </Space>
  );
}
