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

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      const data = await apiRequest<{
        access_token: string;
        token_type: string;
        user?: { email: string; role: string; is_active: boolean };
      }>("/auth/login", "POST", values);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("x_user", data.user?.email || values.email);
      localStorage.setItem("x_role", data.user?.role || "finance_manager");
      router.replace("/home");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa" }}>
      <Card title="公司内部财务后台登录" style={{ width: 420 }}>
        <Typography.Paragraph type="secondary">邮箱登录</Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
            <Input placeholder="name@example.com" />
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
