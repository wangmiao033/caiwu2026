"use client";

export type AppRole = "admin" | "finance_manager" | "ops_manager" | "tech";

const DEFAULT_ROLE: AppRole = "finance_manager";
const ALLOWED_ROLES: AppRole[] = ["admin", "finance_manager", "ops_manager", "tech"];

export function getCurrentRole(): AppRole {
  if (typeof window === "undefined") return DEFAULT_ROLE;
  const raw = (localStorage.getItem("x_role") || "").trim();
  if (raw === "finance") return "finance_manager";
  if (raw === "ops") return "ops_manager";
  if (raw === "biz") return "tech";
  if (ALLOWED_ROLES.includes(raw as AppRole)) return raw as AppRole;
  return DEFAULT_ROLE;
}

export function hasRole(roles: AppRole[]): boolean {
  return roles.includes(getCurrentRole());
}

export function canAccessPage(allow: AppRole[]): boolean {
  return hasRole(allow);
}
