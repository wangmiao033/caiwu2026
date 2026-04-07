"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppstoreOutlined,
  ApartmentOutlined,
  AlertOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  DollarOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GiftOutlined,
  HomeOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  ReconciliationOutlined,
  SettingOutlined,
  ShopOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Typography } from "antd";

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: "/home", icon: <HomeOutlined />, label: "首页看板" },
  { key: "/channels", icon: <ShopOutlined />, label: "渠道管理" },
  { key: "/games", icon: <GiftOutlined />, label: "游戏管理" },
  { key: "/projects", icon: <FolderOpenOutlined />, label: "项目管理" },
  { key: "/game-variants", icon: <ApartmentOutlined />, label: "版本管理" },
  { key: "/channel-game-map", icon: <ClusterOutlined />, label: "渠道游戏映射" },
  { key: "/import", icon: <FileExcelOutlined />, label: "Excel导入" },
  { key: "/recon-tasks", icon: <CheckCircleOutlined />, label: "核对任务" },
  { key: "/billing", icon: <ReconciliationOutlined />, label: "账单管理" },
  { key: "/billing-rules", icon: <SettingOutlined />, label: "规则配置" },
  { key: "/exceptions", icon: <AlertOutlined />, label: "异常中心" },
  { key: "/invoices", icon: <FileTextOutlined />, label: "发票管理" },
  { key: "/receipts", icon: <MoneyCollectOutlined />, label: "回款管理" },
  { key: "/finance", icon: <DollarOutlined />, label: "财务看板" },
  { key: "/audit-logs", icon: <AuditOutlined />, label: "审计日志" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = useMemo(() => menuItems.find((m) => pathname.startsWith(m.key))?.key || "/home", [pathname]);
  const xUser = typeof window !== "undefined" ? localStorage.getItem("x_user") || "finance_user" : "finance_user";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} theme="light">
        <div style={{ padding: 16, fontWeight: 600 }}>
          <Space>
            <AppstoreOutlined />
            公司对账后台
          </Space>
        </div>
        <Menu mode="inline" selectedKeys={[current]} items={menuItems} onClick={(e) => router.push(e.key)} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
          }}
        >
          <Typography.Text>财务结算管理系统</Typography.Text>
          <Space>
            <Typography.Text type="secondary">{xUser}</Typography.Text>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => {
                localStorage.removeItem("access_token");
                localStorage.removeItem("fake_token");
                router.replace("/login");
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 16 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
