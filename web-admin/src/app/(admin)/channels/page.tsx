"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Modal, Space, Table, message } from "antd";
import { apiRequest } from "@/lib/api";

type Row = { id: number; name: string };

export default function ChannelsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setRows(await apiRequest<Row[]>("/channels"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await apiRequest(`/channels/${editing.id}`, "PUT", values);
      } else {
        await apiRequest("/channels", "POST", values);
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
      title: "确认删除渠道",
      onOk: async () => {
        try {
          await apiRequest(`/channels/${id}`, "DELETE");
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const filtered = useMemo(() => rows.filter((x) => x.name.includes(keyword)), [rows, keyword]);
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="渠道管理"
      extra={
        <Space>
          <Input placeholder="搜索渠道" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={load}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新增渠道
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
          { title: "渠道名称", dataIndex: "name" },
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
      <Modal open={open} title={editing ? "编辑渠道" : "新增渠道"} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="渠道名称" name="name" rules={[{ required: true, message: "请输入渠道名称" }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
