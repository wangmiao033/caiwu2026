"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Space, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  GameVariantFormFields,
  buildGameVariantPayload,
  defaultFormValues,
  type GameVariantFormValues,
  type Project,
} from "../game-variant-shared";

export default function GameVariantNewPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await apiRequest<Project[]>("/projects");
        setProjects(list);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  useEffect(() => {
    form.setFieldsValue({ ...defaultFormValues });
  }, [form]);

  const submit = async () => {
    const values = (await form.validateFields()) as GameVariantFormValues;
    const payload = buildGameVariantPayload(values);
    setSaving(true);
    try {
      await apiRequest("/game-variants", "POST", payload);
      message.success("已创建");
      router.push("/game-variants");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Card
        title="新增版本"
        extra={
          <Button onClick={() => router.push("/game-variants")}>返回列表</Button>
        }
      >
        <div style={{ maxWidth: 560 }}>
          <GameVariantFormFields form={form} projects={projects} />
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              保存
            </Button>
            <Button onClick={() => router.push("/game-variants")}>取消</Button>
          </Space>
        </div>
      </Card>
    </RoleGuard>
  );
}
