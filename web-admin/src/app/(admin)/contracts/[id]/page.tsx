"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ArrowLeftOutlined, EditOutlined, SaveOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { hasRole } from "@/lib/rbac";
import ContractItemsEditor from "../ContractItemsEditor";
import {
  STATUS_LABEL,
  contractItemsCompletenessHints,
  toApiItemPayload,
  validateContractItemsForSave,
  type ContractStatus,
  type LocalContractItem,
} from "../types";

type ContractItemRow = {
  id: number;
  contract_id: number;
  game_name: string;
  channel_name?: string;
  discount_label: string;
  discount_rate: number;
  channel_share_percent: number;
  channel_fee_percent: number;
  tax_percent: number;
  private_percent: number;
  item_remark?: string;
  rd_share_note: string;
  is_active: boolean;
};

type ContractDetail = {
  id: number;
  contract_no: string;
  contract_name: string;
  channel_name: string;
  platform_party_name: string;
  platform_party_address: string;
  developer_party_name: string;
  developer_party_address: string;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  remark: string;
  items: ContractItemRow[];
};

function mapServerItemsToLocal(rows: ContractItemRow[], fallbackChannel: string): LocalContractItem[] {
  const fb = fallbackChannel.trim();
  return (rows || []).map((it) => ({
    localKey: `srv-${it.id}`,
    id: it.id,
    game_name: it.game_name,
    channel_name: (it.channel_name || "").trim() || fb,
    discount_label: it.discount_label || "",
    discount_rate: it.discount_rate ?? 0,
    channel_share_percent: it.channel_share_percent ?? 0,
    channel_fee_percent: it.channel_fee_percent ?? 0,
    tax_percent: it.tax_percent ?? 0,
    private_percent: it.private_percent ?? 0,
    item_remark: it.item_remark || "",
    rd_share_note: it.rd_share_note || "",
    is_active: !!it.is_active,
  }));
}

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LocalContractItem[]>([]);
  const [deletedServerIds, setDeletedServerIds] = useState<number[]>([]);
  const [savingItems, setSavingItems] = useState(false);
  const canMutate = hasRole(["admin", "finance_manager", "tech"]);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return;
    setLoading(true);
    try {
      const data = await apiRequest<ContractDetail>(`/contracts/${id}`);
      setDetail(data);
      setItems(mapServerItemsToLocal(data.items || [], data.channel_name || ""));
      setDeletedServerIds([]);
    } catch (e) {
      message.error((e as Error).message);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onItemsChange = useCallback((next: LocalContractItem[]) => {
    setItems((prev) => {
      const prevIds = new Set(prev.filter((r) => r.id).map((r) => r.id as number));
      const nextIds = new Set(next.filter((r) => r.id).map((r) => r.id as number));
      const removed = [...prevIds].filter((i) => !nextIds.has(i));
      if (removed.length) {
        setDeletedServerIds((d) => [...d, ...removed]);
      }
      return next;
    });
  }, []);

  const completenessHints = useMemo(() => {
    if (canMutate) return contractItemsCompletenessHints(items);
    if (!detail?.items?.length) return contractItemsCompletenessHints([]);
    return contractItemsCompletenessHints(mapServerItemsToLocal(detail.items, detail.channel_name || ""));
  }, [canMutate, items, detail]);

  const saveItemsOnly = async () => {
    if (!Number.isFinite(id) || id <= 0 || !detail) return;
    const errs = validateContractItemsForSave(items);
    if (errs.length) {
      message.error(errs[0]);
      return;
    }
    setSavingItems(true);
    try {
      const delUnique = [...new Set(deletedServerIds)];
      for (const delId of delUnique) {
        await apiRequest(`/contract-items/${delId}`, "DELETE");
      }
      for (const row of items) {
        const body = toApiItemPayload(row);
        if (!body.game_name && !body.channel_name && !row.id) continue;
        if (!body.game_name || !body.channel_name) {
          message.error("每条明细需填写游戏与渠道；可删除空白行。");
          setSavingItems(false);
          return;
        }
        if (row.id && row.id > 0) {
          await apiRequest(`/contract-items/${row.id}`, "PUT", body);
        } else {
          await apiRequest(`/contracts/${id}/items`, "POST", body);
        }
      }
      message.success("合同明细已保存");
      await load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSavingItems(false);
    }
  };

  const readonlyColumns: ColumnsType<ContractItemRow> = [
    { title: "游戏名称", dataIndex: "game_name", ellipsis: true },
    { title: "渠道名称", dataIndex: "channel_name", width: 120, ellipsis: true, render: (v: string) => v || "—" },
    { title: "折扣类型", dataIndex: "discount_label", ellipsis: true, render: (v: string) => v || "—" },
    {
      title: "折扣率%",
      dataIndex: "discount_rate",
      width: 88,
      render: (v: number) => (v != null ? Number(v).toFixed(2) : "0"),
    },
    { title: "渠道分成%", dataIndex: "channel_share_percent", width: 100 },
    { title: "通道费%", dataIndex: "channel_fee_percent", width: 92 },
    { title: "税点%", dataIndex: "tax_percent", width: 76 },
    { title: "私点%", dataIndex: "private_percent", width: 76 },
    { title: "备注", dataIndex: "item_remark", ellipsis: true, render: (v: string) => v || "—" },
    {
      title: "研发/结算说明",
      dataIndex: "rd_share_note",
      ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "启用",
      dataIndex: "is_active",
      width: 72,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "是" : "否"}</Tag>,
    },
  ];

  const st = detail ? STATUS_LABEL[detail.status] : null;

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card loading={loading}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/contracts")}>
              返回列表
            </Button>
            {detail && canMutate ? (
              <>
                <Button icon={<EditOutlined />} onClick={() => router.push(`/contracts/${detail.id}/edit`)}>
                  编辑合同主档
                </Button>
                <Button type="primary" icon={<SaveOutlined />} loading={savingItems} onClick={() => void saveItemsOnly()}>
                  保存明细
                </Button>
              </>
            ) : null}
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            合同主档请在「编辑合同主档」中维护；明细可在本页直接编辑保存。与「规则配置」「渠道-游戏映射」不自动联动。
          </Typography.Paragraph>
          {detail ? (
            <>
              <Descriptions title="合同基础信息" bordered column={2} size="small">
                <Descriptions.Item label="合同编号">{detail.contract_no}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  {st ? <Tag color={st.color}>{st.text}</Tag> : detail.status}
                </Descriptions.Item>
                <Descriptions.Item label="合同名称" span={2}>
                  {detail.contract_name}
                </Descriptions.Item>
                <Descriptions.Item label="渠道名称">{detail.channel_name}</Descriptions.Item>
                <Descriptions.Item label="有效期">
                  {detail.start_date ? dayjs(detail.start_date).format("YYYY-MM-DD") : "—"} ~{" "}
                  {detail.end_date ? dayjs(detail.end_date).format("YYYY-MM-DD") : "—"}
                </Descriptions.Item>
                <Descriptions.Item label="平台/发行主体（甲方）" span={2}>
                  {detail.platform_party_name || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="甲方地址" span={2}>
                  {detail.platform_party_address || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="研发/乙方" span={2}>
                  {detail.developer_party_name || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="乙方地址" span={2}>
                  {detail.developer_party_address || "—"}
                </Descriptions.Item>
                <Descriptions.Item label="备注 / 来源" span={2}>
                  {detail.remark || "—"}
                </Descriptions.Item>
              </Descriptions>

              <Alert
                type="info"
                showIcon
                message="明细完整度"
                description={
                  <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                    {completenessHints.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                }
              />

              {canMutate ? (
                <Card size="small" title="合同明细（可编辑）">
                  <ContractItemsEditor
                    value={items}
                    onChange={onItemsChange}
                    headerChannelName={detail.channel_name || ""}
                  />
                </Card>
              ) : (
                <Card size="small" title="合同明细（只读）">
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 1400 }}
                    columns={readonlyColumns}
                    dataSource={detail.items || []}
                  />
                </Card>
              )}
            </>
          ) : !loading ? (
            <Typography.Text type="secondary">未找到合同</Typography.Text>
          ) : null}
        </Space>
      </Card>
    </RoleGuard>
  );
}
