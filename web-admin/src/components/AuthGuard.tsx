"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const bootstrap = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const me = await apiRequest<{ email: string; role: string; is_active: boolean }>("/auth/me");
        localStorage.setItem("x_user", me.email);
        localStorage.setItem("x_role", me.role);
        setReady(true);
      } catch {
        localStorage.removeItem("access_token");
        localStorage.removeItem("x_role");
        localStorage.removeItem("x_user");
        router.replace("/login");
      }
    };
    bootstrap();
  }, [router]);

  if (!ready) {
    return null;
  }
  return <>{children}</>;
}
