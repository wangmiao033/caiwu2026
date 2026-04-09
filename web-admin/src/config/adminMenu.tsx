import type { ReactNode } from "react";
import {
  AlertOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  AuditOutlined,
  ClusterOutlined,
  CloudUploadOutlined,
  DollarOutlined,
  FileExcelOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GiftOutlined,
  HomeOutlined,
  InboxOutlined,
  MoneyCollectOutlined,
  ReconciliationOutlined,
  SettingOutlined,
  ShopOutlined,
  AccountBookOutlined,
} from "@ant-design/icons";

/** 与 localStorage、折叠状态关联的分组 key */
export type AdminMenuGroupKey = string;

export type AdminMenuLeafConfig = {
  /** 菜单项唯一 key（Ant Design Menu，需全局唯一） */
  menuKey: string;
  label: string;
  /** 路由 path，与现有 (admin) 下页面一致 */
  path: string;
  icon?: ReactNode;
  /** 不在侧边栏展示（仅用于面包屑/高亮兼容） */
  hidden?: boolean;
  /** 历史或其它 URL 映射到本项：高亮与面包屑一致 */
  aliasPaths?: string[];
};

export type AdminMenuGroupConfig = {
  key: AdminMenuGroupKey;
  label: string;
  icon?: ReactNode;
  children: AdminMenuLeafConfig[];
};

export const ADMIN_MENU_OPEN_KEYS_STORAGE = "admin_menu_open_keys";

/** 全量菜单分组（中文）；路由 path 不改 */
export const ADMIN_MENU_GROUPS: AdminMenuGroupConfig[] = [
  {
    key: "grp-overview",
    label: "总览看板",
    icon: <AppstoreOutlined />,
    children: [
      { menuKey: "/home", path: "/home", label: "首页看板", icon: <HomeOutlined /> },
      { menuKey: "/finance", path: "/finance", label: "财务看板", icon: <DollarOutlined /> },
    ],
  },
  {
    key: "grp-master",
    label: "基础资料",
    icon: <FolderOpenOutlined />,
    children: [
      { menuKey: "/channels", path: "/channels", label: "渠道管理", icon: <ShopOutlined /> },
      { menuKey: "/games", path: "/games", label: "游戏管理", icon: <GiftOutlined /> },
      { menuKey: "/projects", path: "/projects", label: "项目管理", icon: <FolderOpenOutlined /> },
      { menuKey: "/game-variants", path: "/game-variants", label: "版本管理", icon: <ApartmentOutlined /> },
      { menuKey: "/channel-game-map", path: "/channel-game-map", label: "渠道游戏映射", icon: <ClusterOutlined /> },
      { menuKey: "/contracts", path: "/contracts", label: "合同管理", icon: <FileProtectOutlined /> },
    ],
  },
  {
    key: "grp-import",
    label: "导入中心",
    icon: <CloudUploadOutlined />,
    children: [
      { menuKey: "/import", path: "/import", label: "Excel导入", icon: <FileExcelOutlined /> },
      {
        menuKey: "/settlement-imports",
        path: "/settlement-imports",
        label: "导入管理",
        icon: <InboxOutlined />,
        aliasPaths: ["/recon-tasks"],
      },
      {
        menuKey: "import-alias-datacenter",
        path: "/settlement-imports",
        label: "导入数据中心",
        icon: <InboxOutlined />,
      },
    ],
  },
  {
    key: "grp-billing",
    label: "账单结算",
    icon: <AccountBookOutlined />,
    children: [
      { menuKey: "/billing", path: "/billing", label: "月度账单", icon: <ReconciliationOutlined /> },
      { menuKey: "/settlement-details", path: "/settlement-details", label: "结算明细", icon: <ReconciliationOutlined /> },
      {
        menuKey: "/settlement-statements",
        path: "/settlement-statements",
        label: "渠道月度结算对账单",
        icon: <FileExcelOutlined />,
      },
      {
        menuKey: "/channel-settlement-statements",
        path: "/channel-settlement-statements",
        label: "渠道结算对账单",
        icon: <ReconciliationOutlined />,
      },
    ],
  },
  {
    key: "grp-tickets",
    label: "资金票据",
    icon: <FileTextOutlined />,
    children: [
      { menuKey: "/invoices", path: "/invoices", label: "发票管理", icon: <FileTextOutlined /> },
      { menuKey: "/receipts", path: "/receipts", label: "回款管理", icon: <MoneyCollectOutlined /> },
    ],
  },
  {
    key: "grp-rules",
    label: "规则与异常",
    icon: <SettingOutlined />,
    children: [
      { menuKey: "/billing-rules", path: "/billing-rules", label: "规则配置", icon: <SettingOutlined /> },
      { menuKey: "/exceptions", path: "/exceptions", label: "异常中心", icon: <AlertOutlined /> },
    ],
  },
  {
    key: "grp-system",
    label: "系统管理",
    icon: <SettingOutlined />,
    children: [
      { menuKey: "/user-management", path: "/user-management", label: "用户管理", icon: <SettingOutlined /> },
      { menuKey: "/audit-logs", path: "/audit-logs", label: "审计日志", icon: <AuditOutlined /> },
    ],
  },
];

function leafAllowed(path: string, role: string): boolean {
  if (path === "/user-management" && role !== "admin") return false;
  if (path === "/channel-settlement-statements" && role === "tech") return false;
  if (role === "ops_manager" && path === "/import") return false;
  if (role === "tech" && path === "/billing-rules") return false;
  return true;
}

/** 按角色过滤后的分组（空分组剔除） */
export function getVisibleMenuGroups(role: string): AdminMenuGroupConfig[] {
  const out: AdminMenuGroupConfig[] = [];
  for (const g of ADMIN_MENU_GROUPS) {
    const children = g.children.filter((c) => !c.hidden && leafAllowed(c.path, role));
    if (children.length) {
      out.push({ ...g, children });
    }
  }
  return out;
}

/** 路径是否匹配叶子（含 alias） */
function pathMatchesLeaf(pathname: string, leaf: AdminMenuLeafConfig): boolean {
  const primary = leaf.path === pathname || pathname.startsWith(`${leaf.path}/`);
  if (primary) return true;
  for (const alias of leaf.aliasPaths || []) {
    if (pathname === alias || pathname.startsWith(`${alias}/`)) return true;
  }
  return false;
}

/** 当前应高亮的菜单项 menuKey（最长 path / alias 优先） */
export function resolveSelectedMenuKey(pathname: string, groups: AdminMenuGroupConfig[]): string {
  let bestLen = -1;
  let bestKey = "";
  for (const g of groups) {
    for (const c of g.children) {
      if (!pathMatchesLeaf(pathname, c)) continue;
      const len = c.path.length;
      if (len > bestLen) {
        bestLen = len;
        bestKey = c.menuKey;
      }
    }
  }
  return bestKey;
}

/** 当前路径所属分组 key */
export function resolveOpenGroupKeyForPath(pathname: string, groups: AdminMenuGroupConfig[]): string | null {
  for (const g of groups) {
    for (const c of g.children) {
      if (pathMatchesLeaf(pathname, c)) return g.key;
    }
  }
  return null;
}

export type BreadcrumbItem = { title: string; path?: string };

/** 面包屑：[分组, 子页] */
export function getBreadcrumbs(pathname: string, groups: AdminMenuGroupConfig[]): BreadcrumbItem[] {
  for (const g of groups) {
    for (const c of g.children) {
      if (pathMatchesLeaf(pathname, c)) {
        return [
          { title: g.label },
          { title: c.label, path: c.path },
        ];
      }
    }
  }
  return [{ title: "后台" }];
}

/** 转为 Ant Design Menu props.items（仅分组 + 可见子项） */
export function groupsToAntdMenuItems(groups: AdminMenuGroupConfig[]) {
  return groups.map((g) => ({
    key: g.key,
    icon: g.icon,
    label: g.label,
    children: g.children.map((c) => ({
      key: c.menuKey,
      icon: c.icon,
      label: c.label,
    })),
  }));
}

/** 由 menuKey 或 path 找跳转 path（叶子点击） */
export function resolveNavigatePath(menuKey: string, groups: AdminMenuGroupConfig[]): string | null {
  if (!menuKey || menuKey.startsWith("grp-")) return null;
  for (const g of groups) {
    for (const c of g.children) {
      if (c.menuKey === menuKey) return c.path;
    }
  }
  if (menuKey.startsWith("/")) return menuKey;
  return null;
}

/** 默认展开：总览 + 当前分组 */
export function defaultOpenKeys(pathname: string, groups: AdminMenuGroupConfig[]): string[] {
  const keys = new Set<string>(["grp-overview"]);
  const gk = resolveOpenGroupKeyForPath(pathname, groups);
  if (gk) keys.add(gk);
  return Array.from(keys);
}

export function readStoredOpenKeys(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_MENU_OPEN_KEYS_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredOpenKeys(keys: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_MENU_OPEN_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}
