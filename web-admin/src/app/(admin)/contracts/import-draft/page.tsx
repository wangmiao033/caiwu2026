"use client";

import { Button, Card, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import RoleGuard from "@/components/RoleGuard";

/**
 * 预留：PDF / 扫描件识别后填充合同草稿（v1 仅占位，后续可接 OCR 与字段映射）。
 */
export default function ContractImportDraftPlaceholderPage() {
  const router = useRouter();

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech", "ops_manager"]}>
      <Card title="合同草稿导入（预留）">
        <Typography.Paragraph>
          此路由预留给「渠道合同」的 PDF / 扫描件自动识别与草稿生成；当前版本不执行识别与解析。请在{" "}
          <Typography.Link onClick={() => router.push("/contracts/new")}>新建合同</Typography.Link>{" "}
          中手工录入，或使用列表页的编辑页维护。
        </Typography.Paragraph>
        <Space>
          <Button type="primary" onClick={() => router.push("/contracts/new")}>
            去新建合同
          </Button>
          <Button onClick={() => router.push("/contracts")}>返回合同列表</Button>
        </Space>
      </Card>
    </RoleGuard>
  );
}
