"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Form, Space, Spin, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  ChannelGameMapFormFields,
  buildChannelGameMapApiPayload,
  type Channel,
  type ChannelGameMapFormValues,
  type Game,
  type MapRow,
  toPercent,
} from "../../channel-game-map-shared";

export default function ChannelGameMapEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [form] = Form.useForm();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      message.error("无效的映射 ID");
      router.push("/channel-game-map");
      return;
    }
    setLoading(true);
    try {
      const [c, g, rows] = await Promise.all([
        apiRequest<Channel[]>("/channels"),
        apiRequest<Game[]>("/games"),
        apiRequest<MapRow[]>("/channel-game-map"),
      ]);
      setChannels(c);
      setGames(g);
      const r = (rows || []).find((x) => x.id === id);
      if (!r) {
        message.error("未找到该映射");
        router.push("/channel-game-map");
        return;
      }
      const channel = c.find((x) => x.name === r.channel);
      const game = g.find((x) => x.name === r.game);
      if (!channel || !game) {
        message.error("渠道或游戏数据异常");
        router.push("/channel-game-map");
        return;
      }
      form.setFieldsValue({
        channel_id: channel.id,
        game_id: game.id,
        revenue_share_ratio: toPercent(r.revenue_share_ratio),
        rd_settlement_ratio: typeof game.rd_share_percent === "number" ? game.rd_share_percent : toPercent(r.rd_settlement_ratio),
      });
    } catch (e) {
      message.error((e as Error).message);
      router.push("/channel-game-map");
    } finally {
      setLoading(false);
    }
  }, [id, form, router]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await apiRequest(`/channel-game-map/${id}`, "PUT", payload);
      message.success("已保存");
      router.push("/channel-game-map");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Card
        title="编辑映射"
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
