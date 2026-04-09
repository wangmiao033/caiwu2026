"use client";

import { useEffect, useMemo, useState } from "react";
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
  FileProtectOutlined,
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
import type { MenuProps } from "antd";
import { Button, Layout, Menu, Space, Typography } from "antd";
import { getCurrentRole } from "@/lib/rbac";

const { Header, Sider, Content } = Layout;

const allMenuItems: MenuProps["items"] = [
  { key: "/home", icon: <HomeOutlined />, label: "首页看板" },
  { key: "/channels", icon: <ShopOutlined />, label: "渠道管理" },
  { key: "/games", icon: <GiftOutlined />, label: "游戏管理" },
  { key: "/projects", icon: <FolderOpenOutlined />, label: "项目管理" },
  { key: "/game-variants", icon: <ApartmentOutlined />, label: "版本管理" },
  { key: "/channel-game-map", icon: <ClusterOutlined />, label: "渠道游戏映射" },
  { key: "/import", icon: <FileExcelOutlined />, label: "Excel导入" },
  { key: "/recon-tasks", icon: <CheckCircleOutlined />, label: "导入数据中心" },
  { key: "/billing", icon: <ReconciliationOutlined />, label: "账单管理" },
  { key: "/billing-rules", icon: <SettingOutlined />, label: "规则配置" },
  { key: "/contracts", icon: <FileProtectOutlined />, label: "合同管理" },
  {
    key: "grp-monthly-settlement",
    icon: <FileExcelOutlined />,
    label: "渠道月度结算对账单",
    children: [
      { key: "/settlement-imports", label: "导入管理" },
      { key: "/settlement-details", label: "结算明细" },
      { key: "/settlement-statements", label: "月度账单" },
    ],
  },
  { key: "/channel-settlement-statements", icon: <ReconciliationOutlined />, label: "渠道结算对账单" },
  { key: "/exceptions", icon: <AlertOutlined />, label: "异常中心" },
  { key: "/invoices", icon: <FileTextOutlined />, label: "发票管理" },
  { key: "/receipts", icon: <MoneyCollectOutlined />, label: "回款管理" },
  { key: "/finance", icon: <DollarOutlined />, label: "财务看板" },
  { key: "/user-management", icon: <SettingOutlined />, label: "用户管理" },
  { key: "/audit-logs", icon: <AuditOutlined />, label: "审计日志" },
];

function filterMenuByRole(items: MenuProps["items"], role: string): MenuProps["items"] {
  const out: MenuProps["items"] = [];
  for (const raw of items || []) {
    if (!raw) continue;
    if ("children" in raw && raw.children) {
      const children = filterMenuByRole(raw.children, role);
      if (children?.length) {
        out.push({ ...raw, children });
      }
      continue;
    }
    const key = "key" in raw ? String(raw.key) : "";
    if (key === "/user-management" && role !== "admin") continue;
    if (key === "/channel-settlement-statements" && role === "tech") continue;
    if (role === "ops_manager" && key === "/import") continue;
    if (role === "tech" && key === "/billing-rules") continue;
    out.push(raw);
  }
  return out;
}

function resolveMenuSelectedKey(pathname: string, items: MenuProps["items"]): string {
  let best = "";
  for (const raw of items || []) {
    if (!raw) continue;
    if ("children" in raw && raw.children) {
      const sub = resolveMenuSelectedKey(pathname, raw.children);
      if (sub.length > best.length) best = sub;
    } else if ("key" in raw) {
      const k = String(raw.key);
      if (pathname === k || pathname.startsWith(`${k}/`)) {
        if (k.length > best.length) best = k;
      }
    }
  }
  return best;
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = getCurrentRole();
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const visibleMenuItems = useMemo(() => filterMenuByRole(allMenuItems, role), [role]);

  const selectedKey = useMemo(
    () => resolveMenuSelectedKey(pathname, visibleMenuItems) || "/home",
    [pathname, visibleMenuItems]
  );

  useEffect(() => {
    if (
      pathname.startsWith("/settlement-imports") ||
      pathname.startsWith("/settlement-details") ||
      pathname.startsWith("/settlement-statements")
    ) {
      setOpenKeys(["grp-monthly-settlement"]);
    }
  }, [pathname]);

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
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          items={visibleMenuItems}
          onClick={(e) => router.push(e.key)}
        />
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
                localStorage.removeItem("x_role");
                localStorage.removeItem("x_user");
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
