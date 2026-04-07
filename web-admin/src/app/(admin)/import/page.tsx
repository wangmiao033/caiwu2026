"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Drawer,
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
  Timeline,
  Tooltip,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { RcFile } from "antd/es/upload";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import { apiRequest, apiRequestDirect } from "@/lib/api";

type PreviewRow = {
  key: number;
  channel_name: string;
  game_name: string;
  gross_amount: string | number;
  status: "正常" | "异常";
  project_name?: string;
  variant_name?: string;
  variant_match_status?: "已匹配版本" | "未匹配版本";
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
  id: number;
  import_type: string;
  period: string;
  file_name: string;
  task_id: number;
  total_count: number;
  valid_count: number;
  invalid_count: number;
  amount_sum: number;
  status: string;
  summary: string;
  created_at: string;
  created_by: string;
  matched_variant_count?: number;
  unmatched_variant_count?: number;
  unresolved_issue_count?: number;
  resolved_issue_count?: number;
};

type ImportHistoryListResp = {
  items: ImportHistoryRow[];
  total: number;
  page: number;
  page_size: number;
};

type ImportHistoryFilter = {
  fileName: string;
  period: string;
  import_type: string;
  status: string;
};

type ExtractRow = {
  __rowNum__: number;
  game_name: string;
  channel_name: string;
  gross_amount_raw: string;
  gross_amount?: number;
  error?: string;
  project_name?: string;
  variant_name?: string;
  variant_match_status?: "已匹配版本" | "未匹配版本";
};

export default function ImportPage() {
  const router = useRouter();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [period, setPeriod] = useState("2026-03");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [channels, setChannels] = useState<OptionItem[]>([]);
  const [games, setGames] = useState<OptionItem[]>([]);
  const [maps, setMaps] = useState<MappingItem[]>([]);
  const [manualRows, setManualRows] = useState<ManualRow[]>([{ key: 1 }]);
  const [history, setHistory] = useState<ImportHistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<ImportHistoryFilter>({ fileName: "", period: "", import_type: "", status: "" });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDetail, setHistoryDetail] = useState<ImportHistoryRow | null>(null);
  const [historyIssues, setHistoryIssues] = useState<
    Array<{
      issue_id: number;
      issue_type: string;
      message: string;
      status: string;
      row_no?: number;
      raw_data?: unknown;
      remark?: string;
      updated_at?: string;
      latest_operator?: string;
      latest_updated_at?: string;
    }>
  >([]);
  const [issueStatusFilter, setIssueStatusFilter] = useState("");
  const [selectedIssueIds, setSelectedIssueIds] = useState<number[]>([]);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveRemark, setResolveRemark] = useState("");
  const [resolveTargetIds, setResolveTargetIds] = useState<number[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineIssueId, setTimelineIssueId] = useState<number | null>(null);
  const [timelineRows, setTimelineRows] = useState<
    Array<{ id: number; issue_id: number; action: string; from_status: string; to_status: string; remark: string; operator: string; created_at: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showVariantColumns, setShowVariantColumns] = useState(false);
  const [variantInfoMap, setVariantInfoMap] = useState<Record<string, { project_name: string; variant_name: string }>>({});

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
    Promise.all([apiRequest<Array<{ id: number; name: string }>>("/projects"), apiRequest<Array<{ project_id: number; raw_game_name: string; variant_name: string }>>("/game-variants")])
      .then(([projectsData, variantsData]) => {
        const projectNameMap = new Map<number, string>();
        projectsData.forEach((p) => projectNameMap.set(p.id, p.name));
        const map: Record<string, { project_name: string; variant_name: string }> = {};
        variantsData.forEach((v) => {
          map[v.raw_game_name] = {
            project_name: projectNameMap.get(v.project_id) || "",
            variant_name: v.variant_name || "",
          };
        });
        setVariantInfoMap(map);
      })
      .catch(() => {});
    loadHistory(1);
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
      const matched = variantInfoMap[game];
      return {
        key: idx + 1,
        channel_name: channel,
        game_name: game,
        gross_amount: amount,
        status: ok ? "正常" : "异常",
        project_name: matched?.project_name || "",
        variant_name: matched?.variant_name || "",
        variant_match_status: matched ? "已匹配版本" : "未匹配版本",
      } as PreviewRow;
    });
    setPreview(data);
  };

  const isSupportedTemplateFile = (file: File) => {
    const name = (file.name || "").toLowerCase();
    return name.endsWith(".csv") || name.endsWith(".xlsx");
  };

  const clearTemplateFileState = () => {
    setSelectedFile(null);
    setSelectedFileName("");
    setFileList([]);
    setPreview([]);
  };

  const handleTemplateFileSelect = async (file: RcFile) => {
    if (!isSupportedTemplateFile(file)) {
      message.error("仅支持 CSV / XLSX 文件");
      clearTemplateFileState();
      return false;
    }
    setSelectedFile(file);
    setSelectedFileName(file.name);
    console.debug("[import/template] selectedFile set", { name: file.name, size: file.size });
    setFileList([
      {
        uid: file.uid,
        name: file.name,
        status: "done",
        size: file.size,
        type: file.type,
        originFileObj: file,
      },
    ]);
    try {
      await parseFile(file);
    } catch {
      setPreview([]);
      message.error("文件解析失败，请检查模板格式");
    }
    return false;
  };

  const loadHistory = async (page = historyPage) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", "10");
    if (historyFilter.period) params.set("period", historyFilter.period);
    if (historyFilter.import_type) params.set("import_type", historyFilter.import_type);
    if (historyFilter.status) params.set("status", historyFilter.status);
    if (historyFilter.fileName) params.set("keyword", historyFilter.fileName);
    try {
      const data = await apiRequest<ImportHistoryListResp>(`/imports/history?${params.toString()}`);
      setHistory(data.items || []);
      setHistoryTotal(data.total || 0);
      setHistoryPage(page);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const loadHistoryIssues = async (historyId: number) => {
    try {
      const data = await apiRequest<
        Array<{
          issue_id: number;
          issue_type: string;
          message: string;
          status: string;
          row_no?: number;
          raw_data?: unknown;
          remark?: string;
          updated_at?: string;
          latest_operator?: string;
          latest_updated_at?: string;
        }>
      >(
        `/imports/history/${historyId}/issues`
      );
      setHistoryIssues(data);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const openTimeline = async (issueId: number) => {
    setTimelineIssueId(issueId);
    setTimelineOpen(true);
    setTimelineLoading(true);
    try {
      const data = await apiRequest<
        Array<{ id: number; issue_id: number; action: string; from_status: string; to_status: string; remark: string; operator: string; created_at: string }>
      >(`/recon/issues/${issueId}/timeline`);
      setTimelineRows(data || []);
    } catch (e) {
      message.error((e as Error).message);
      setTimelineRows([]);
    } finally {
      setTimelineLoading(false);
    }
  };
  const loadHistoryDetail = async (historyId: number) => {
    try {
      const detail = await apiRequest<ImportHistoryRow>(`/imports/history/${historyId}`);
      setHistoryDetail(detail);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const openResolveModal = (ids: number[]) => {
    if (!ids.length) {
      message.warning("请先选择要处理的异常");
      return;
    }
    setResolveTargetIds(ids);
    setResolveRemark("");
    setResolveOpen(true);
  };
  const submitResolve = async () => {
    try {
      if (resolveTargetIds.length === 1) {
        await apiRequest(`/recon/issues/${resolveTargetIds[0]}/resolve`, "POST", { status: "已处理", remark: resolveRemark });
        message.success("异常已标记处理");
      } else {
        const resp = await apiRequest<{ success_count: number; failed_count: number; failed_ids: number[] }>(
          "/recon/issues/bulk-resolve",
          "POST",
          { issue_ids: resolveTargetIds, remark: resolveRemark }
        );
        if (resp.failed_count > 0) {
          message.warning(`批量处理完成，成功${resp.success_count}，失败${resp.failed_count}`);
        } else {
          message.success(`批量处理成功 ${resp.success_count} 条`);
        }
      }
      setResolveOpen(false);
      setSelectedIssueIds([]);
      if (historyDetail) {
        await Promise.all([loadHistoryIssues(historyDetail.id), loadHistoryDetail(historyDetail.id), loadHistory(historyPage)]);
      }
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const upload = async () => {
    if (!selectedFile) {
      message.warning("请先选择文件");
      return;
    }
    console.debug("[import/template] upload clicked", { selectedFileName: selectedFile.name, size: selectedFile.size });
    Modal.confirm({
      title: "确认导入",
      content: `确认将文件 ${selectedFileName || selectedFile.name} 导入账期 ${period} 吗？`,
      onOk: async () => {
        const hide = message.loading("正在上传并导入...", 0);
        const formData = new FormData();
        formData.append("file", selectedFile);
        try {
          setUploading(true);
          const data = await apiRequest<Record<string, unknown>>(`/recon/import?period=${encodeURIComponent(period)}&import_type=template`, "POST", formData, true);
          setResult(data);
          await loadHistory(1);
          message.success("导入成功");
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setUploading(false);
          hide();
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
          await loadHistory(1);
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

  const downloadTemplateCsv = () => {
    const csv = "channel_name,game_name,gross_amount\n渠道A,游戏X,100000\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadTemplateXlsx = () => {
    const rows = [{ channel_name: "渠道A", game_name: "游戏X", gross_amount: 100000 }];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "import_template.xlsx");
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
      const enriched = (data.rows || []).map((row) => {
        const matched = variantInfoMap[row.game_name];
        return {
          ...row,
          project_name: matched?.project_name || "",
          variant_name: matched?.variant_name || "",
          variant_match_status: (matched ? "已匹配版本" : "未匹配版本") as "已匹配版本" | "未匹配版本",
        };
      });
      setExtractRows(enriched);
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
          await loadHistory(1);
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
                    <Tag color="blue">支持 CSV / XLSX 模板导入</Tag>
                    <Upload
                      maxCount={1}
                      accept=".csv,.xlsx"
                      beforeUpload={handleTemplateFileSelect}
                      fileList={fileList}
                      onRemove={() => {
                        clearTemplateFileState();
                      }}
                    >
                      <Button icon={<UploadOutlined />}>选择文件</Button>
                    </Upload>
                    <Button type="primary" onClick={upload} loading={uploading}>
                      上传并导入
                    </Button>
                    <Button onClick={downloadTemplateCsv}>下载 CSV 模板</Button>
                    <Button onClick={downloadTemplateXlsx}>下载 XLSX 模板</Button>
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
                      ...(showVariantColumns
                        ? [
                            { title: "项目", dataIndex: "project_name", render: (v: string) => v || "-" },
                            { title: "版本", dataIndex: "variant_name", render: (v: string) => v || "-" },
                            {
                              title: "版本匹配状态",
                              dataIndex: "variant_match_status",
                              render: (v: string) => <Tag color={v === "已匹配版本" ? "green" : "orange"}>{v || "未匹配版本"}</Tag>,
                            },
                          ]
                        : []),
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (v: string) => <Tag color={v === "异常" ? "red" : "green"}>{v}</Tag>,
                      },
                    ]}
                  />
                  <Card title="导入历史" size="small">
                    <Space style={{ marginBottom: 8 }} wrap>
                      <Button size="small" onClick={() => setShowVariantColumns((v) => !v)}>
                        {showVariantColumns ? "隐藏版本信息列" : "显示版本信息列"}
                      </Button>
                      <Input
                        placeholder="关键字"
                        value={historyFilter.fileName}
                        onChange={(e) => setHistoryFilter((s) => ({ ...s, fileName: e.target.value }))}
                      />
                      <Input
                        placeholder="账期"
                        value={historyFilter.period}
                        onChange={(e) => setHistoryFilter((s) => ({ ...s, period: e.target.value }))}
                      />
                      <Select
                        allowClear
                        placeholder="导入类型"
                        style={{ width: 140 }}
                        options={[
                          { label: "template", value: "template" },
                          { label: "manual", value: "manual" },
                          { label: "extract", value: "extract" },
                        ]}
                        value={historyFilter.import_type || undefined}
                        onChange={(v) => setHistoryFilter((s) => ({ ...s, import_type: v || "" }))}
                      />
                      <Select
                        allowClear
                        placeholder="状态"
                        style={{ width: 140 }}
                        options={[
                          { label: "待确认", value: "待确认" },
                          { label: "异常待处理", value: "异常待处理" },
                        ]}
                        value={historyFilter.status || undefined}
                        onChange={(v) => setHistoryFilter((s) => ({ ...s, status: v || "" }))}
                      />
                      <Button onClick={() => loadHistory(1)}>查询</Button>
                    </Space>
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={history}
                      locale={{ emptyText: <Empty description="暂无导入历史" /> }}
                      pagination={{
                        pageSize: 10,
                        total: historyTotal,
                        current: historyPage,
                        onChange: (p) => loadHistory(p),
                      }}
                      columns={[
                        { title: "导入时间", dataIndex: "created_at" },
                        { title: "导入类型", dataIndex: "import_type" },
                        { title: "文件名", dataIndex: "file_name" },
                        { title: "账期", dataIndex: "period" },
                        { title: "task_id", dataIndex: "task_id" },
                        { title: "总行数", dataIndex: "total_count" },
                        { title: "正常行数", dataIndex: "valid_count" },
                        { title: "异常行数", dataIndex: "invalid_count" },
                        { title: "已匹配版本", dataIndex: "matched_variant_count", render: (v: number) => v ?? 0 },
                        { title: "未匹配版本", dataIndex: "unmatched_variant_count", render: (v: number) => v ?? 0 },
                        { title: "流水合计", dataIndex: "amount_sum" },
                        {
                          title: "状态",
                          dataIndex: "status",
                          render: (v: string) => <Tag color={v === "异常待处理" ? "red" : "blue"}>{v}</Tag>,
                        },
                        {
                          title: "操作",
                          render: (_, r) => (
                            <Button
                              size="small"
                              onClick={() => {
                                setHistoryDetail(r);
                                setIssueStatusFilter("");
                                setSelectedIssueIds([]);
                                loadHistoryIssues(r.id);
                                loadHistoryDetail(r.id);
                              }}
                            >
                              详情
                            </Button>
                          ),
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
      <Drawer open={!!historyDetail} title={`导入历史详情 #${historyDetail?.id || ""}`} onClose={() => setHistoryDetail(null)} width={680}>
        {historyDetail && (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Table
              pagination={false}
              rowKey="k"
              dataSource={[
                { k: "导入类型", v: historyDetail.import_type },
                { k: "账期", v: historyDetail.period },
                { k: "文件名", v: historyDetail.file_name },
                { k: "任务ID", v: historyDetail.task_id },
                { k: "总行数", v: historyDetail.total_count },
                { k: "正常行数", v: historyDetail.valid_count },
                { k: "异常行数", v: historyDetail.invalid_count },
                { k: "已匹配版本数", v: historyDetail.matched_variant_count ?? 0 },
                { k: "未匹配版本数", v: historyDetail.unmatched_variant_count ?? 0 },
                { k: "已处理异常数", v: historyDetail.resolved_issue_count ?? 0 },
                { k: "未处理异常数", v: historyDetail.unresolved_issue_count ?? 0 },
                { k: "流水合计", v: historyDetail.amount_sum },
                { k: "状态", v: historyDetail.status },
                { k: "摘要", v: historyDetail.summary },
                { k: "创建人", v: historyDetail.created_by },
                { k: "创建时间", v: historyDetail.created_at },
              ]}
              columns={[
                { title: "字段", dataIndex: "k", width: 180 },
                { title: "值", dataIndex: "v" },
              ]}
            />
            {(historyDetail.unmatched_variant_count ?? 0) > 0 && <Tag color="orange">部分数据未匹配到版本，后续统计可能不完整</Tag>}
            <Card
              size="small"
              title="异常明细"
              extra={
                <Space>
                  <Select
                    style={{ width: 140 }}
                    allowClear
                    placeholder="状态筛选"
                    options={[
                      { label: "全部", value: "" },
                      { label: "未处理", value: "未处理" },
                      { label: "已处理", value: "已处理" },
                    ]}
                    value={issueStatusFilter || undefined}
                    onChange={(v) => setIssueStatusFilter(v || "")}
                  />
                  <Button onClick={() => router.push(`/recon-tasks?task_id=${historyDetail.task_id}`)}>去核对任务</Button>
                  <Button type="primary" disabled={selectedIssueIds.length === 0} onClick={() => openResolveModal(selectedIssueIds)}>
                    批量标记已处理
                  </Button>
                </Space>
              }
            >
              {historyIssues.length === 0 ? (
                <Empty description="该次导入无异常" />
              ) : (
                <Table
                  size="small"
                  rowKey="issue_id"
                  dataSource={historyIssues.filter((x) => !issueStatusFilter || x.status === issueStatusFilter)}
                  rowSelection={{
                    selectedRowKeys: selectedIssueIds,
                    onChange: (keys) => setSelectedIssueIds(keys as number[]),
                    getCheckboxProps: (record) => ({ disabled: record.status === "已处理" }),
                  }}
                  pagination={{ pageSize: 6 }}
                  columns={[
                    { title: "异常类型", dataIndex: "issue_type", width: 120 },
                    { title: "异常描述", dataIndex: "message" },
                    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => <Tag color={v === "已处理" ? "green" : "red"}>{v}</Tag> },
                    { title: "原始行号", dataIndex: "row_no", width: 100, render: (v: number) => v ?? "-" },
                    {
                      title: "原始数据",
                      dataIndex: "raw_data",
                      render: (v: unknown) =>
                        v ? (
                          <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 2)}</pre>}>
                            <span>查看</span>
                          </Tooltip>
                        ) : (
                          "-"
                        ),
                    },
                    { title: "处理备注", dataIndex: "remark", render: (v: string) => v || "-" },
                    { title: "更新时间", dataIndex: "updated_at", render: (v: string) => v || "-" },
                    { title: "最新处理人", dataIndex: "latest_operator", width: 120, render: (v: string) => v || "-" },
                    { title: "最新处理时间", dataIndex: "latest_updated_at", width: 180, render: (v: string) => v || "-" },
                    {
                      title: "操作",
                      render: (_, r) =>
                        (
                          <Space>
                            {r.status === "未处理" ? (
                              <Button size="small" onClick={() => openResolveModal([r.issue_id])}>
                                标记已处理
                              </Button>
                            ) : (
                              <Tag color="green">已处理</Tag>
                            )}
                            <Button size="small" onClick={() => openTimeline(r.issue_id)}>
                              查看轨迹
                            </Button>
                          </Space>
                        ),
                    },
                  ]}
                />
              )}
              {(historyDetail.unresolved_issue_count ?? 0) === 0 && historyIssues.length > 0 && <Tag color="green">该次导入异常已全部处理</Tag>}
            </Card>
          </Space>
        )}
      </Drawer>
      <Modal open={resolveOpen} title="标记异常已处理" onCancel={() => setResolveOpen(false)} onOk={submitResolve} okText="确认处理">
        <Input.TextArea
          rows={3}
          placeholder="可选：填写处理备注"
          value={resolveRemark}
          onChange={(e) => setResolveRemark(e.target.value)}
        />
      </Modal>
      <Drawer open={timelineOpen} title={`异常处理轨迹 #${timelineIssueId || ""}`} width={560} onClose={() => setTimelineOpen(false)}>
        <Spin spinning={timelineLoading}>
          {timelineRows.length === 0 ? (
            <Empty description="暂无处理轨迹" />
          ) : (
            <Timeline
              items={timelineRows.map((x) => ({
                children: (
                  <Space direction="vertical" size={2}>
                    <div>
                      <b>{x.operator || "system"}</b> · {x.created_at || "-"}
                    </div>
                    <div>动作：{x.action}</div>
                    <div>
                      状态：{x.from_status || "-"} -&gt; {x.to_status || "-"}
                    </div>
                    <div>备注：{x.remark || "-"}</div>
                  </Space>
                ),
              }))}
            />
          )}
        </Spin>
      </Drawer>
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
