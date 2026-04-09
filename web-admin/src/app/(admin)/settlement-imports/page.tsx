"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Space, Table, Typography, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

type ChannelOption = { id: number; name: string };

type ImportBatch = {
  id: number;
  batch_name: string;
  source_file_name: string;
  settlement_month: string;
  channel_id: number;
  channel_name: string;
  import_type: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  import_status: string;
  error_summary: string;
  created_by: string;
  created_at: string;
};

function normalizePeriodYm(raw: string): string | null {
  const t = raw.trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const monthNum = parseInt(m[2], 10);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${m[1]}-${String(monthNum).padStart(2, "0")}`;
}

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function SettlementImportsPage() {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [month, setMonth] = useState(defaultMonth);
  const [channelId, setChannelId] = useState<number | undefined>();
  const [batchName, setBatchName] = useState("");
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [items, setItems] = useState<ImportBatch[]>([]);
  const [total, setTotal] = useState(0);

  const canWrite = hasRole(["admin", "finance_manager", "ops_manager"]);

  const channelOpts = useMemo(() => channels.map((c) => ({ label: c.name, value: c.id })), [channels]);

  const loadChannels = async () => {
    try {
      const data = await apiRequest<ChannelOption[]>("/channels");
      setChannels(data || []);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const q = new URLSearchParams();
      if (month.trim()) {
        const m = normalizePeriodYm(month.trim());
        if (m) q.set("settlement_month", m);
      }
      if (channelId) q.set("channel_id", String(channelId));
      q.set("page_size", "50");
      const data = await apiRequest<{ items: ImportBatch[]; total: number }>(`/settlement-imports?${q.toString()}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setListLoading(false);
    }
  }, [month, channelId]);

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const downloadTemplate = async () => {
    const token = localStorage.getItem("access_token") || "";
    const xRole = localStorage.getItem("x_role") || "";
    const xUser = localStorage.getItem("x_user") || "";
    const resp = await fetch("/api/proxy/settlement-imports/template", {
      headers: {
        authorization: token ? `Bearer ${token}` : "",
        "x-role": xRole,
        "x-user": xUser,
      },
    });
    if (!resp.ok) {
      message.error("模板下载失败");
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "settlement_import_template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadProps = {
    maxCount: 1,
    showUploadList: true,
    beforeUpload: (file: File) => {
      void doUpload(file);
      return false;
    },
  };

  const doUpload = async (file: File) => {
    if (!canWrite) {
      message.warning("当前角色无导入权限");
      return;
    }
    const m = normalizePeriodYm(month.trim());
    if (!m) {
      message.warning("账期格式应为 YYYY-MM");
      return;
    }
    if (!channelId) {
      message.warning("请选择渠道");
      return;
    }
    setLoading(true);
    try {
      const q = new URLSearchParams({
        settlement_month: m,
        channel_id: String(channelId),
        batch_name: batchName.trim() || file.name,
      });
      const token = localStorage.getItem("access_token") || "";
      const xRole = localStorage.getItem("x_role") || "";
      const xUser = localStorage.getItem("x_user") || "";
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`/api/proxy/settlement-imports/upload?${q.toString()}`, {
        method: "POST",
        headers: {
          authorization: token ? `Bearer ${token}` : "",
          "x-role": xRole,
          "x-user": xUser,
        },
        body: fd,
      });
      const text = await resp.text();
      if (!resp.ok) {
        let detail = text || "导入失败";
        try {
          const j = JSON.parse(text) as { detail?: string };
          if (j.detail) detail = String(j.detail);
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const r = JSON.parse(text) as {
        success_rows: number;
        failed_rows: number;
        import_status: string;
        error_summary: string;
      };
      message.success(`导入完成：成功 ${r.success_rows}，失败 ${r.failed_rows}（${r.import_status}）`);
      if (r.error_summary) {
        message.warning(r.error_summary.slice(0, 500));
      }
      await loadList();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<ImportBatch> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "批次名", dataIndex: "batch_name", ellipsis: true },
    { title: "文件", dataIndex: "source_file_name", ellipsis: true, width: 160 },
    { title: "账期", dataIndex: "settlement_month", width: 100 },
    { title: "渠道", dataIndex: "channel_name", width: 120, ellipsis: true },
    { title: "类型", dataIndex: "import_type", width: 72 },
    { title: "总行", dataIndex: "total_rows", width: 72 },
    { title: "成功", dataIndex: "success_rows", width: 64 },
    { title: "失败", dataIndex: "failed_rows", width: 64 },
    { title: "状态", dataIndex: "import_status", width: 96 },
    { title: "操作人", dataIndex: "created_by", width: 100, ellipsis: true },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="结算明细导入"
        description="上传 Excel/CSV，渠道与游戏名称须与系统中 /channels、/games 一致；分成比例为空时在 channel_game_contracts（/settlement-contracts）有效期内读取。"
      />
      <Card title="上传" size="small">
        <Space wrap align="center">
          <Input placeholder="账期 YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 130 }} />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择渠道"
            style={{ width: 220 }}
            value={channelId}
            onChange={(v) => setChannelId(v)}
            options={channelOpts}
            allowClear
          />
          <Input placeholder="批次名称（可空，默认文件名）" value={batchName} onChange={(e) => setBatchName(e.target.value)} style={{ width: 240 }} />
          <Button icon={<DownloadOutlined />} onClick={() => void downloadTemplate()}>
            下载模板
          </Button>
          {canWrite && (
            <Upload {...uploadProps}>
              <Button type="primary" icon={<UploadOutlined />} loading={loading}>
                选择文件并导入
              </Button>
            </Upload>
          )}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          必填列：channel_name、game_name、gross_revenue；可选 test_fee、coupon_fee、revenue_share_ratio、channel_fee_ratio、remark。文件中渠道名须与所选渠道一致。
        </Typography.Paragraph>
      </Card>
      <Card title={`导入历史（${total}）`} size="small">
        <Space style={{ marginBottom: 12 }} wrap>
          <Button onClick={() => void loadList()} loading={listLoading}>
            刷新
          </Button>
        </Space>
        <Table<ImportBatch>
          rowKey="id"
          loading={listLoading}
          dataSource={items}
          columns={columns}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
    </Space>
  );
}
