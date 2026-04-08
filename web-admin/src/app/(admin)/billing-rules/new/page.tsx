"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Form, Space, Spin, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  BillingRuleFormFields,
  type BillingRuleFormShape,
  type GameItem,
  type MapRow,
  defaultRule,
  getRulesFromStorageOrMaps,
  mergeRuleIntoRules,
  ratioToPercent,
  rdRatioForGameName,
  rdPercentForGameName,
  saveRulesToStorage,
  type SimpleItem,
} from "../billing-rules-shared";

export default function BillingRuleNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [channels, setChannels] = useState<SimpleItem[]>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [chRes, gmRes, mapRes] = await Promise.all([
          apiRequest<SimpleItem[]>("/channels"),
          apiRequest<GameItem[]>("/games"),
          apiRequest<MapRow[]>("/channel-game-map"),
        ]);
        if (cancelled) return;
        setChannels(chRes);
        setGames(gmRes);
        setMaps(mapRes);
      } catch {
        if (!cancelled) {
          apiRequest<SimpleItem[]>("/channels").then(setChannels).catch(() => {});
          apiRequest<GameItem[]>("/games").then(setGames).catch(() => {});
          apiRequest<MapRow[]>("/channel-game-map")
            .then((data) => {
              if (!cancelled) setMaps(data);
            })
            .catch(() => {});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!channels.length || !games.length) return;
    const ch = (searchParams.get("channel") || "").trim();
    const gm = (searchParams.get("game") || "").trim();
    const dr = defaultRule();
    const gameName = gm || maps[0]?.game || "";
    form.setFieldsValue({
      ...dr,
      channel: ch || maps[0]?.channel,
      game: gameName || undefined,
      channelFee: ratioToPercent(dr.channelFee),
      taxRate: ratioToPercent(dr.taxRate),
      rdShare: gameName ? rdPercentForGameName(games, gameName) : ratioToPercent(dr.rdShare),
      privateRate: ratioToPercent(dr.privateRate),
    });
  }, [channels, games, maps, searchParams, form]);

  const submit = async () => {
    const values = (await form.validateFields()) as BillingRuleFormShape;
    const rules = getRulesFromStorageOrMaps(maps, games);
    const next = mergeRuleIntoRules(values, games, null, rules);
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
        title="新增规则"
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
