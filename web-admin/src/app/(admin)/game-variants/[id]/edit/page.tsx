"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Form, Space, Spin, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import {
  GameVariantFormFields,
  buildGameVariantPayload,
  variantToFormValues,
  type GameVariant,
  type GameVariantFormValues,
  type Project,
} from "../../game-variant-shared";

export default function GameVariantEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [form] = Form.useForm();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      message.error("无效的版本 ID");
      router.push("/game-variants");
      return;
    }
    setLoading(true);
    try {
      const [plist, variants] = await Promise.all([
        apiRequest<Project[]>("/projects"),
        apiRequest<GameVariant[]>(`/game-variants`),
      ]);
      setProjects(plist);
      const row = (variants || []).find((v) => v.id === id);
      if (!row) {
        message.error("未找到该版本");
        router.push("/game-variants");
        return;
      }
      form.setFieldsValue(variantToFormValues(row));
    } catch (e) {
      message.error((e as Error).message);
      router.push("/game-variants");
    } finally {
      setLoading(false);
    }
  }, [id, form, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const values = (await form.validateFields()) as GameVariantFormValues;
    const payload = buildGameVariantPayload(values);
    setSaving(true);
    try {
      await apiRequest(`/game-variants/${id}`, "PUT", payload);
      message.success("已保存");
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
        title="编辑版本"
        extra={<Button onClick={() => router.push("/game-variants")}>返回列表</Button>}
      >
        {loading ? (
          <Spin />
        ) : (
          <div style={{ maxWidth: 560 }}>
            <GameVariantFormFields form={form} projects={projects} />
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                保存
              </Button>
              <Button onClick={() => router.push("/game-variants")}>取消</Button>
            </Space>
          </div>
        )}
      </Card>
    </RoleGuard>
  );
}
