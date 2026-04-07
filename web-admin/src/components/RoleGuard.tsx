"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Result } from "antd";
import { AppRole, canAccessPage } from "@/lib/rbac";

type RoleGuardProps = {
  allow: AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
};

function DefaultForbidden() {
  const router = useRouter();
  return (
    <Result
      status="403"
      title="无权限访问"
      subTitle="你当前角色无权访问该页面"
      extra={
        <Button type="primary" onClick={() => router.push("/home")}>
          返回首页
        </Button>
      }
    />
  );
}

export default function RoleGuard({ allow, children, fallback }: RoleGuardProps) {
  if (!canAccessPage(allow)) {
    return <>{fallback || <DefaultForbidden />}</>;
  }
  return <>{children}</>;
}
