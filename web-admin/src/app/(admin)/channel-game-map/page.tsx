"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, InputNumber, Modal, Select, Space, Table, message } from "antd";
import { apiRequest } from "@/lib/api";

type Channel = { id: number; name: string };
type Game = { id: number; name: string };
type Row = {
  id: number;
  channel: string;
  game: string;
  revenue_share_ratio: number;
  rd_settlement_ratio: number;
};

export default function ChannelGameMapPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [qChannel, setQChannel] = useState("");
  const [qGame, setQGame] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const loadMeta = async () => {
    const [c, g] = await Promise.all([apiRequest<Channel[]>("/channels"), apiRequest<Game[]>("/games")]);
    setChannels(c);
    setGames(g);
  };
  const load = async () => {
    try {
      await loadMeta();
      setRows(await apiRequest<Row[]>("/channel-game-map"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await apiRequest(`/channel-game-map/${editing.id}`, "PUT", values);
      } else {
        await apiRequest("/channel-game-map", "POST", values);
      }
      setOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = (id: number) =>
    Modal.confirm({
      title: "确认删除映射",
      onOk: async () => {
        try {
          await apiRequest(`/channel-game-map/${id}`, "DELETE");
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const filtered = useMemo(
    () => rows.filter((x) => (!qChannel || x.channel === qChannel) && (!qGame || x.game === qGame)),
    [rows, qChannel, qGame]
  );
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="渠道-游戏映射"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="按渠道筛选"
            style={{ width: 160 }}
            options={channels.map((x) => ({ label: x.name, value: x.name }))}
            value={qChannel || undefined}
            onChange={(v) => setQChannel(v || "")}
          />
          <Select
            allowClear
            placeholder="按游戏筛选"
            style={{ width: 160 }}
            options={games.map((x) => ({ label: x.name, value: x.name }))}
            value={qGame || undefined}
            onChange={(v) => setQGame(v || "")}
          />
          <Button onClick={load}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增映射
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 90 },
          { title: "渠道", dataIndex: "channel" },
          { title: "游戏", dataIndex: "game" },
          { title: "渠道分成", dataIndex: "revenue_share_ratio" },
          { title: "研发分成", dataIndex: "rd_settlement_ratio" },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    const channel = channels.find((x) => x.name === r.channel);
                    const game = games.find((x) => x.name === r.game);
                    if (!channel || !game) return;
                    setEditing(r);
                    form.setFieldsValue({
                      channel_id: channel.id,
                      game_id: game.id,
                      revenue_share_ratio: r.revenue_share_ratio,
                      rd_settlement_ratio: r.rd_settlement_ratio,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Button size="small" danger onClick={() => remove(r.id)}>
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title={editing ? "编辑映射" : "新增映射"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item name="channel_id" label="渠道" rules={[{ required: true }]}>
            <Select options={channels.map((x) => ({ label: x.name, value: x.id }))} />
          </Form.Item>
          <Form.Item name="game_id" label="游戏" rules={[{ required: true }]}>
            <Select options={games.map((x) => ({ label: x.name, value: x.id }))} />
          </Form.Item>
          <Form.Item name="revenue_share_ratio" label="渠道分成" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="rd_settlement_ratio" label="研发分成" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
