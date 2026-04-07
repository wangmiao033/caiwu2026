import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "公司内部对账后台",
  description: "基于 FastAPI 的财务对账管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
