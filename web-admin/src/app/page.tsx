"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EntryPage() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem("fake_token");
    router.replace(token ? "/home" : "/login");
  }, [router]);
  return null;
}
