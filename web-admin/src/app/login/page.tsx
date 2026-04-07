"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Input, Select, Space, Typography } from "antd";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("fake_token");
    if (token) {
      router.replace("/home");
    }
  }, [router]);

  const onFinish = (values: { username: string; role: string }) => {
    setLoading(true);
    localStorage.setItem("fake_token", "ok");
    localStorage.setItem("x_user", values.username);
    localStorage.setItem("x_role", values.role);
    setTimeout(() => {
      router.replace("/home");
    }, 200);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa" }}>
      <Card title="公司内部对账后台" style={{ width: 420 }}>
        <Typography.Paragraph type="secondary">演示阶段：假登录，不接真实认证系统</Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="finance_user" />
          </Form.Item>
          <Form.Item label="角色" name="role" initialValue="finance">
            <Select
              options={[
                { label: "财务 finance", value: "finance" },
                { label: "管理员 admin", value: "admin" },
                { label: "商务 biz", value: "biz" },
                { label: "运营 ops", value: "ops" },
              ]}
            />
          </Form.Item>
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button htmlType="submit" type="primary" loading={loading}>
              登录
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
