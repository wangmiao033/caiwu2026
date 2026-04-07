"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Modal, Space, Table, message } from "antd";
import { apiRequest } from "@/lib/api";

type Row = { id: number; name: string; rd_company: string };

export default function GamesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setRows(await apiRequest<Row[]>("/games"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await apiRequest(`/games/${editing.id}`, "PUT", values);
      } else {
        await apiRequest("/games", "POST", values);
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
      title: "确认删除游戏",
      onOk: async () => {
        try {
          await apiRequest(`/games/${id}`, "DELETE");
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const filtered = useMemo(() => rows.filter((x) => `${x.name}${x.rd_company}`.includes(keyword)), [rows, keyword]);
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="游戏管理"
      extra={
        <Space>
          <Input placeholder="搜索游戏" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={load}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增游戏
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={filtered}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 100 },
          { title: "游戏名称", dataIndex: "name" },
          { title: "研发主体", dataIndex: "rd_company" },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue(r);
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
      <Modal open={open} title={editing ? "编辑游戏" : "新增游戏"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="游戏名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="研发主体" name="rd_company" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
