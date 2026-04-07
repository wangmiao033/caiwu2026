"use client";

import { useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import RoleGuard from "@/components/RoleGuard";
import { apiRequest } from "@/lib/api";

type ResetPasswordResp = {
  ok: boolean;
  message: string;
};

type FormValues = {
  email: string;
  new_password: string;
};

function validatePassword(password: string): string | null {
  const raw = (password || "").trim();
  if (!raw) return "新密码不能为空";
  if (raw.length < 8) return "新密码至少 8 位";
  const hasLetter = /[A-Za-z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  if (!hasLetter || !hasNumber) return "新密码需包含字母和数字";
  return null;
}

export default function UserManagementPage() {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: FormValues) => {
    const email = (values.email || "").trim().toLowerCase();
    const passwordError = validatePassword(values.new_password);
    if (passwordError) {
      message.error(passwordError);
      return;
    }
    setSubmitting(true);
    try {
      const resp = await apiRequest<ResetPasswordResp>("/auth/admin/reset-password", "POST", {
        email,
        new_password: values.new_password,
      });
      if (resp.ok) {
        message.success(resp.message || "密码已重置");
      } else {
        message.success("密码已重置");
      }
      form.setFieldsValue({ new_password: "" });
    } catch (e) {
      const msg = (e as Error).message || "重置失败";
      message.error(msg);
      form.setFieldsValue({ new_password: "" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RoleGuard allow={["admin"]}>
      <Card title="用户管理 - 管理员重置密码" style={{ maxWidth: 640 }}>
        <Typography.Paragraph type="secondary">
          仅管理员可操作。请输入用户邮箱与新密码，系统将直接重置该 Supabase 账号登录密码。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item
            label="用户邮箱"
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "请输入合法邮箱地址" },
            ]}
          >
            <Input autoComplete="off" placeholder="例如：caiwu@dxyx6888.com" />
          </Form.Item>
          <Form.Item label="新密码" name="new_password" rules={[{ required: true, message: "请输入新密码" }]}>
            <Input.Password autoComplete="new-password" placeholder="至少8位，包含字母和数字" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting}>
            重置密码
          </Button>
        </Form>
      </Card>
    </RoleGuard>
  );
}
