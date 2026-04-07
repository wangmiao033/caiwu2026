"use client";

import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Modal, Space, Switch, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";

type Project = {
  id: number;
  name: string;
  status: string;
  remark: string;
  created_at: string;
};

export default function ProjectsPage() {
  const [rows, setRows] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setRows(await apiRequest<Project[]>("/projects"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name as string,
      status: values.status ? "active" : "paused",
      remark: (values.remark as string) || "",
    };
    try {
      if (editing) {
        await apiRequest(`/projects/${editing.id}`, "PUT", payload);
      } else {
        await apiRequest("/projects", "POST", payload);
      }
      setOpen(false);
      setEditing(null);
      form.resetFields();
      message.success(editing ? "已保存" : "已创建");
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const toggleStatus = async (r: Project, checked: boolean) => {
    try {
      await apiRequest(`/projects/${r.id}/status`, "PATCH", { status: checked ? "active" : "paused" });
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="项目管理"
      extra={
        <Space>
          <Button onClick={load}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ name: "", status: true, remark: "" });
              setOpen(true);
            }}
          >
            新增项目
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 72 },
          { title: "项目名称", dataIndex: "name" },
          {
            title: "状态",
            dataIndex: "status",
            render: (v: string) => <Tag color={v === "active" ? "green" : "default"}>{v === "active" ? "启用" : "暂停"}</Tag>,
          },
          {
            title: "启用",
            width: 100,
            render: (_, r) => <Switch checked={r.status === "active"} onChange={(c) => toggleStatus(r, c)} />,
          },
          { title: "备注", dataIndex: "remark", ellipsis: true },
          { title: "创建时间", dataIndex: "created_at" },
          {
            title: "操作",
            width: 100,
            render: (_, r) => (
              <Button
                size="small"
                onClick={() => {
                  setEditing(r);
                  form.setFieldsValue({
                    name: r.name,
                    status: r.status === "active",
                    remark: r.remark,
                  });
                  setOpen(true);
                }}
              >
                编辑
              </Button>
            ),
          },
        ]}
      />
      <Modal open={open} title={editing ? "编辑项目" : "新增项目"} onCancel={() => setOpen(false)} onOk={submit} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="项目名称" />
          </Form.Item>
          <Form.Item name="status" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
