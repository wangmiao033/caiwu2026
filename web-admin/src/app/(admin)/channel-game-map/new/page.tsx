"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Form, Space, Spin, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  ChannelGameMapFormFields,
  buildChannelGameMapApiPayload,
  type Channel,
  type ChannelGameMapFormValues,
  type Game,
} from "../channel-game-map-shared";

export default function ChannelGameMapNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [c, g] = await Promise.all([apiRequest<Channel[]>("/channels"), apiRequest<Game[]>("/games")]);
        setChannels(c);
        setGames(g);
      } catch (e) {
        message.error((e as Error).message);
        setChannels([]);
        setGames([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!channels.length || !games.length) return;
    const chName = (searchParams.get("channel") || "").trim();
    const gmName = (searchParams.get("game") || "").trim();
    if (!chName && !gmName) {
      form.resetFields();
      return;
    }
    const ch = chName ? channels.find((x) => x.name === chName) : undefined;
    const gm = gmName ? games.find((x) => x.name === gmName) : undefined;
    form.setFieldsValue({
      channel_id: ch?.id,
      game_id: gm?.id,
      revenue_share_ratio: undefined,
      rd_settlement_ratio: typeof gm?.rd_share_percent === "number" ? gm.rd_share_percent : 0,
    });
  }, [channels, games, searchParams, form]);

  const submit = async () => {
    const values = (await form.validateFields()) as ChannelGameMapFormValues;
    const channelPercent = Number(values.revenue_share_ratio || 0);
    const rdPercent = Number(values.rd_settlement_ratio || 0);
    if (channelPercent + rdPercent > 100) {
      message.error("渠道分成与研发分成之和不能大于100%");
      return;
    }
    const payload = buildChannelGameMapApiPayload(values);
    setSaving(true);
    try {
      await apiRequest("/channel-game-map", "POST", payload);
      if (searchParams.get("return") === "import") {
        message.success("映射已保存，正在返回导入页");
        router.push("/import?from=mapping");
      } else {
        message.success("已创建");
        router.push("/channel-game-map");
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Card
        title="新增映射"
        extra={<Button onClick={() => router.push("/channel-game-map")}>返回列表</Button>}
      >
        {loading ? (
          <Spin />
        ) : (
          <div style={{ maxWidth: 560 }}>
            <ChannelGameMapFormFields form={form} channels={channels} games={games} />
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                保存
              </Button>
              <Button onClick={() => router.push("/channel-game-map")}>取消</Button>
            </Space>
          </div>
        )}
      </Card>
    </RoleGuard>
  );
}
