"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { apiRequest } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token) {
      router.replace("/home");
    }
  }, [router]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const data = await apiRequest<{ access_token: string; token_type: string }>("/login", "POST", values);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("x_user", values.username);
      router.replace("/home");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa" }}>
      <Card title="公司内部对账后台" style={{ width: 420 }}>
        <Typography.Paragraph type="secondary">公司内部登录（当前为简化账号体系）</Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password placeholder="123456" />
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
