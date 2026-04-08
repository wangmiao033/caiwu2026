import AdminShell from "@/components/AdminShell";
import AuthGuard from "@/components/AuthGuard";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ConfigProvider locale={zhCN}>
        <AdminShell>{children}</AdminShell>
      </ConfigProvider>
    </AuthGuard>
  );
}
