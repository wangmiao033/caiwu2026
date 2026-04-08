"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { TableColumnsType, UploadProps } from "antd";
import { ArrowLeftOutlined, FileExcelOutlined, UploadOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";

type PreviewRow = {
  excel_row: number;
  contract_no: string;
  contract_name: string;
  channel_name: string;
  developer_party_name: string;
  platform_party_name: string;
  start_date: string | null;
  end_date: string | null;
  attachment_preview: string;
  remark: string;
  status: string;
  issues: string[];
  duplicate_hint: boolean;
};

type PreviewOut = { rows: PreviewRow[]; file_label: string };

type CommitOut = {
  created: number;
  skipped: number;
  created_ids: number[];
  skip_reasons: string[];
};

const rowKey = (r: PreviewRow) => `${r.excel_row}-${r.contract_no}`;

export default function ContractImportExcelPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [fileLabel, setFileLabel] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  const onPreviewLoaded = useCallback((data: PreviewOut) => {
    setPreview(data.rows || []);
    setFileLabel(data.file_label || "");
    const auto = (data.rows || []).filter((r) => r.status === "ready").map((r) => rowKey(r));
    setSelectedKeys(auto);
  }, []);

  const uploadProps: UploadProps = {
    accept: ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv",
    maxCount: 1,
    showUploadList: true,
    disabled: loadingPreview,
    beforeUpload: (file) => {
      void (async () => {
        const name = (file.name || "").toLowerCase();
        if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
          message.error("仅支持 .xlsx 或 .csv");
          return;
        }
        setLoadingPreview(true);
        try {
          const fd = new FormData();
          fd.append("file", file);
          const data = await apiRequest<PreviewOut>("/contracts/import-excel/preview", "POST", fd, true);
          onPreviewLoaded(data);
          message.success("已生成导入预览，请核对后勾选确认导入");
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setLoadingPreview(false);
        }
      })();
      return false;
    },
  };

  const commit = async () => {
    if (!preview.length) {
      message.warning("请先上传台账文件");
      return;
    }
    const selected = new Set(selectedKeys);
    const items = preview
      .filter((r) => selected.has(rowKey(r)) && r.status !== "skip")
      .map((r) => ({
        contract_no: r.contract_no,
        contract_name: r.contract_name,
        channel_name: r.channel_name,
        developer_party_name: r.developer_party_name || "",
        platform_party_name: r.platform_party_name || "广州熊动科技有限公司",
        platform_party_address: "",
        developer_party_address: "",
        start_date: r.start_date || "",
        end_date: r.end_date || "",
        remark: r.remark || "",
      }))
      .filter((x) => x.contract_no && x.contract_name && x.channel_name && x.start_date && x.end_date);

    if (!items.length) {
      message.warning("没有可导入的行（已跳过或勾选为空）");
      return;
    }

    setCommitting(true);
    try {
      const res = await apiRequest<CommitOut>("/contracts/import-excel/commit", "POST", { items });
      message.success(`成功导入 ${res.created} 条；跳过 ${res.skipped} 条`);
      if (res.skip_reasons?.length) {
        message.info(res.skip_reasons.slice(0, 5).join("；") + (res.skip_reasons.length > 5 ? "…" : ""));
      }
      router.push("/contracts");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const columns: TableColumnsType<PreviewRow> = useMemo(
    () => [
      { title: "行号", dataIndex: "excel_row", width: 72 },
      { title: "合同名称", dataIndex: "contract_name", ellipsis: true },
      { title: "对方/渠道", dataIndex: "channel_name", width: 140, ellipsis: true },
      {
        title: "开始日期",
        dataIndex: "start_date",
        width: 110,
        render: (v: string | null) => v || "—",
      },
      {
        title: "结束日期",
        dataIndex: "end_date",
        width: 110,
        render: (v: string | null) => v || "—",
      },
      {
        title: "附件摘要",
        dataIndex: "attachment_preview",
        ellipsis: true,
        width: 120,
        render: (v: string) => v || "—",
      },
      {
        title: "导入状态",
        width: 100,
        render: (_, r) => {
          if (r.status === "skip") return <Tag color="red">跳过</Tag>;
          if (r.status === "warn") return <Tag color="orange">待确认</Tag>;
          return <Tag color="green">可导入</Tag>;
        },
      },
      {
        title: "问题说明",
        ellipsis: true,
        render: (_, r) => (r.issues?.length ? r.issues.join("；") : r.duplicate_hint ? "疑似重复" : "—"),
      },
    ],
    []
  );

  const rowSelection = {
    selectedRowKeys: selectedKeys,
    onChange: (keys: React.Key[]) => setSelectedKeys(keys),
    getCheckboxProps: (r: PreviewRow) => ({
      disabled: r.status === "skip",
    }),
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/contracts")}>
            返回合同列表
          </Button>
          <Button type="primary" icon={<FileExcelOutlined />} loading={committing} onClick={() => void commit()}>
            确认导入所选行
          </Button>
        </Space>

        <Typography.Title level={4} style={{ margin: 0 }}>
          Excel 合同台账导入（草稿）
        </Typography.Title>
        <Alert
          type="info"
          showIcon
          message="说明"
          description={
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              <li>导入结果默认写入为「草稿」合同主档，不会自动生成合同明细。</li>
              <li>分成比例、渠道费、税点等若 Excel 未完整提供，仅写入备注，需后续在合同编辑页补录。</li>
              <li>缺少合同名称、对方/签约方或无法解析终止日期的行将标记为跳过。</li>
              <li>「待确认」行为疑似重复（本表或系统中已有同名同渠道同终止日），请人工核对后仍可勾选导入。</li>
            </ul>
          }
        />

        <Card title="上传台账（单文件）" size="small">
          <Typography.Paragraph type="secondary">
            表头示例：合同名称、合同签约方、渠道简称、签约日期、终止日期、合同类型、账款类型、合同附件、分成比例等（支持常见别名）。
          </Typography.Paragraph>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />} loading={loadingPreview}>
              选择 .xlsx / .csv
            </Button>
          </Upload>
          {fileLabel ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              当前文件：{fileLabel}
            </Typography.Text>
          ) : null}
        </Card>

        <Card title="导入预览" size="small">
          <Table<PreviewRow>
            rowKey={rowKey}
            size="small"
            loading={loadingPreview}
            columns={columns}
            dataSource={preview}
            pagination={{ pageSize: 20 }}
            rowSelection={rowSelection}
          />
        </Card>
      </Space>
    </RoleGuard>
  );
}
