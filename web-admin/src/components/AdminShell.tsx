"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppstoreOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Breadcrumb, Button, Grid, Layout, Menu, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  defaultOpenKeys,
  getBreadcrumbs,
  getVisibleMenuGroups,
  groupsToAntdMenuItems,
  readStoredOpenKeys,
  resolveNavigatePath,
  resolveSelectedMenuKey,
  writeStoredOpenKeys,
} from "@/config/adminMenu";
import { getCurrentRole } from "@/lib/rbac";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

function filterValidGroupKeys(keys: string[], allowed: Set<string>): string[] {
  return keys.filter((k) => allowed.has(k));
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = getCurrentRole();
  const screens = useBreakpoint();

  const visibleGroups = useMemo(() => getVisibleMenuGroups(role), [role]);
  const groupKeySet = useMemo(() => new Set(visibleGroups.map((g) => g.key)), [visibleGroups]);

  const antdMenuItems = useMemo<MenuProps["items"]>(
    () => groupsToAntdMenuItems(visibleGroups),
    [visibleGroups]
  );

  const selectedKey = useMemo(
    () => resolveSelectedMenuKey(pathname, visibleGroups),
    [pathname, visibleGroups]
  );

  const breadcrumbItems = useMemo(
    () => getBreadcrumbs(pathname, visibleGroups),
    [pathname, visibleGroups]
  );

  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [siderCollapsed, setSiderCollapsed] = useState(true);

  const narrow = screens.md === false;

  useEffect(() => {
    const stored = readStoredOpenKeys();
    const fallback = defaultOpenKeys(pathname, visibleGroups);
    const merged = stored?.length
      ? [...new Set([...filterValidGroupKeys(stored, groupKeySet), ...fallback])]
      : fallback;
    setOpenKeys(merged);
  }, [pathname, visibleGroups, groupKeySet]);

  useEffect(() => {
    if (narrow) setSiderCollapsed(true);
    else setSiderCollapsed(false);
  }, [narrow]);

  const onOpenChange = (keys: string[]) => {
    const valid = filterValidGroupKeys(keys, groupKeySet);
    setOpenKeys(valid);
    writeStoredOpenKeys(valid);
  };

  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    const target = resolveNavigatePath(String(key), visibleGroups);
    if (target) {
      router.push(target);
      if (narrow) setSiderCollapsed(true);
    }
  };

  const xUser = typeof window !== "undefined" ? localStorage.getItem("x_user") || "finance_user" : "finance_user";

  const breadcrumbAntdItems = breadcrumbItems.map((b, i) => {
    const isLast = i === breadcrumbItems.length - 1;
    return {
      title:
        b.path && !isLast ? (
          <span
            role="link"
            tabIndex={0}
            onClick={() => router.push(b.path!)}
            onKeyDown={(e) => e.key === "Enter" && router.push(b.path!)}
            style={{ cursor: "pointer", color: "var(--ant-color-primary)" }}
          >
            {b.title}
          </span>
        ) : (
          b.title
        ),
    };
  });

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={220}
        theme="light"
        collapsed={narrow ? siderCollapsed : false}
        collapsedWidth={0}
        trigger={null}
        style={{
          position: narrow ? "fixed" : "relative",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: narrow ? 1000 : undefined,
          height: "100vh",
          overflow: "auto",
        }}
      >
        <div style={{ padding: 16, fontWeight: 600 }}>
          <Space>
            <AppstoreOutlined />
            {!narrow && <span>公司对账后台</span>}
          </Space>
        </div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={selectedKey ? [selectedKey] : []}
          openKeys={openKeys}
          onOpenChange={onOpenChange}
          items={antdMenuItems}
          onClick={onMenuClick}
        />
      </Sider>
      {narrow && !siderCollapsed ? (
        <button
          type="button"
          aria-label="关闭菜单"
          onClick={() => setSiderCollapsed(true)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(0,0,0,0.45)",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        />
      ) : null}
      <Layout style={{ flex: 1, minWidth: 0 }}>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Space size="middle" style={{ flex: 1, minWidth: 0 }}>
            {narrow ? (
              <Button
                type="text"
                icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSiderCollapsed((c) => !c)}
                aria-label="菜单"
              />
            ) : null}
            <Breadcrumb style={{ minWidth: 0 }} items={breadcrumbAntdItems} />
          </Space>
          <Space>
            <Typography.Text type="secondary" ellipsis>
              {xUser}
            </Typography.Text>
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
        <Content style={{ margin: narrow ? 12 : 16 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
