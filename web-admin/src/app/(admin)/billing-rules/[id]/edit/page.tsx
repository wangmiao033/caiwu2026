"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Form, Space, Spin, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  BillingRuleFormFields,
  type BillingRuleFormShape,
  type GameItem,
  getRulesFromStorageOrMaps,
  mergeRuleIntoRules,
  type MapRow,
  ratioToPercent,
  rdRatioForGameName,
  rdPercentForGameName,
  saveRulesToStorage,
  type SimpleItem,
} from "../../billing-rules-shared";

export default function BillingRuleEditPage() {
  const params = useParams();
  const router = useRouter();
  const key = typeof params.id === "string" ? params.id : "";
  const [form] = Form.useForm();
  const [channels, setChannels] = useState<SimpleItem[]>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!key) {
      message.error("无效的规则标识");
      router.push("/billing-rules");
      return;
    }
    setLoading(true);
    try {
      const [chRes, gmRes, mapRes] = await Promise.all([
        apiRequest<SimpleItem[]>("/channels"),
        apiRequest<GameItem[]>("/games"),
        apiRequest<MapRow[]>("/channel-game-map"),
      ]);
      setChannels(chRes);
      setGames(gmRes);
      setMaps(mapRes);
      const rules = getRulesFromStorageOrMaps(mapRes, gmRes);
      const row = rules.find((x) => x.key === key);
      if (!row) {
        message.error("未找到该规则");
        router.push("/billing-rules");
        return;
      }
      setEditingKey(row.key);
      const rdPct = rdPercentForGameName(gmRes, row.game) || ratioToPercent(row.rdShare);
      form.setFieldsValue({
        ...row,
        channelFee: ratioToPercent(row.channelFee),
        taxRate: ratioToPercent(row.taxRate),
        rdShare: rdPct,
        privateRate: ratioToPercent(row.privateRate),
      });
    } catch (e) {
      message.error((e as Error).message);
      router.push("/billing-rules");
    } finally {
      setLoading(false);
    }
  }, [key, form, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!editingKey) return;
    const values = (await form.validateFields()) as BillingRuleFormShape;
    const rules = getRulesFromStorageOrMaps(maps, games);
    const next = mergeRuleIntoRules(values, games, editingKey, rules);
    saveRulesToStorage(next);
    setSaving(true);
    try {
      await apiRequest("/billing/rules", "POST", {
        name: `${values.channel}-${values.game}-rule`,
        bill_type: "channel",
        default_ratio: rdRatioForGameName(games, values.game),
      });
      message.success("规则已保存（并同步基础比例到后端）");
    } catch (e) {
      message.warning(`本地已保存，后端同步失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
    router.push("/billing-rules");
  };

  return (
    <RoleGuard allow={["admin", "finance_manager"]}>
      <Card
        title="编辑规则"
        extra={<Button onClick={() => router.push("/billing-rules")}>返回列表</Button>}
      >
        {loading ? (
          <Spin style={{ margin: 24 }} />
        ) : (
          <div style={{ maxWidth: 560 }}>
            <BillingRuleFormFields form={form} channels={channels} games={games} />
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                保存
              </Button>
              <Button onClick={() => router.push("/billing-rules")}>取消</Button>
            </Space>
          </div>
        )}
      </Card>
    </RoleGuard>
  );
}
