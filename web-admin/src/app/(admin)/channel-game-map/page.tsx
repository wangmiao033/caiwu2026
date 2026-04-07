"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import { buildExportFilename, exportRowsToXlsx } from "@/lib/export";

type Channel = { id: number; name: string };
type Game = { id: number; name: string };
type Row = {
  id: number;
  channel: string;
  game: string;
  revenue_share_ratio: number;
  rd_settlement_ratio: number;
};
type BulkInputItem = { channel_name: string; game_name: string };
type BulkPreviewRow = { key: string; channel_name: string; game_name: string; status: string; reason: string };

export default function ChannelGameMapPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [qChannel, setQChannel] = useState("");
  const [qGame, setQGame] = useState("");
  const [open, setOpen] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
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
  const exportCurrent = () => {
    exportRowsToXlsx(
      filtered.map((x) => ({
        映射ID: x.id,
        渠道: x.channel,
        游戏: x.game,
        渠道分成: x.revenue_share_ratio,
        研发分成: x.rd_settlement_ratio,
      })),
      buildExportFilename("channel_game_map", "xlsx")
    );
    message.success("导出成功");
  };
  const parseBulk = () => {
    const channelSet = new Set(channels.map((x) => x.name));
    const gameSet = new Set(games.map((x) => x.name));
    const existsSet = new Set(rows.map((x) => `${x.channel}::${x.game}`));
    const seen = new Set<string>();
    const preview: BulkPreviewRow[] = [];
    const lines = bulkText.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const cols = line.split(/[\t,\uff0c]+/).map((x) => x.trim()).filter(Boolean);
      if (cols.length < 2) {
        preview.push({ key: `line-${i}`, channel_name: cols[0] || "", game_name: cols[1] || "", status: "格式错误", reason: "格式错误" });
        continue;
      }
      const channel_name = cols[0];
      const game_name = cols[1];
      const key = `${channel_name}::${game_name}`;
      if (seen.has(key)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "重复输入", reason: "重复输入" });
        continue;
      }
      seen.add(key);
      if (!channelSet.has(channel_name)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "渠道不存在", reason: "渠道不存在" });
        continue;
      }
      if (!gameSet.has(game_name)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "游戏不存在", reason: "游戏不存在" });
        continue;
      }
      if (existsSet.has(key)) {
        preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "映射已存在", reason: "映射已存在" });
        continue;
      }
      preview.push({ key: `${key}-${i}`, channel_name, game_name, status: "可新增", reason: "" });
    }
    setBulkPreview(preview);
  };
  const submitBulk = async () => {
    const items: BulkInputItem[] = bulkPreview.filter((x) => x.status === "可新增").map((x) => ({ channel_name: x.channel_name, game_name: x.game_name }));
    if (items.length === 0) {
      message.warning("没有可新增映射");
      return;
    }
    setBulkLoading(true);
    message.loading({ content: "正在批量创建映射...", key: "bulk_map" });
    try {
      const resp = await apiRequest<{ success_count: number; failed_count: number; failed_items: Array<{ channel_name: string; game_name: string; reason: string }> }>(
        "/channel-game-map/bulk-create",
        "POST",
        { items }
      );
      message.success({ content: `成功 ${resp.success_count} 条，跳过 ${resp.failed_count} 条`, key: "bulk_map" });
      setOpenBulk(false);
      setBulkText("");
      setBulkPreview([]);
      await load();
    } catch (e) {
      message.error({ content: (e as Error).message, key: "bulk_map" });
    } finally {
      setBulkLoading(false);
    }
  };
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
          <Button onClick={exportCurrent}>导出当前筛选</Button>
          <Button onClick={() => setOpenBulk(true)}>批量导入</Button>
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
      <Modal
        open={openBulk}
        title="批量添加渠道游戏映射"
        onCancel={() => setOpenBulk(false)}
        onOk={submitBulk}
        okText="确认导入"
        confirmLoading={bulkLoading}
        width={860}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"支持格式（每行一组）：\n4399,雷鸣三国\n百度,浮光幻想\n也支持从 Excel 两列复制（Tab 分隔）"}
          />
          <Button onClick={parseBulk}>解析</Button>
          <Table
            rowKey="key"
            size="small"
            pagination={{ pageSize: 8 }}
            dataSource={bulkPreview}
            columns={[
              { title: "渠道", dataIndex: "channel_name" },
              { title: "游戏", dataIndex: "game_name" },
              {
                title: "状态",
                dataIndex: "status",
                render: (v: string) => <Tag color={v === "可新增" ? "green" : "red"}>{v}</Tag>,
              },
              { title: "原因", dataIndex: "reason", render: (v: string) => v || "-" },
            ]}
          />
        </Space>
      </Modal>
    </Card>
  );
}
