"use client";

import { apiRequest } from "@/lib/api";

export type DashboardRange = "7d" | "30d";

export type DashboardOverview = {
  summary: {
    monthly_gross_revenue: number;
    monthly_channel_receipts: number;
    monthly_rd_payable: number;
    monthly_gross_profit: number;
    unsettled_amount: number;
    exception_bill_count: number;
  };
  summary_compare: {
    monthly_gross_revenue: number;
    monthly_channel_receipts: number;
    monthly_rd_payable: number;
    monthly_gross_profit: number;
    unsettled_amount: number;
    exception_bill_count: number;
  };
  trends: Array<{ date: string; type: "流水" | "回款" | "利润"; amount: number }>;
  exceptions: {
    total: number;
    share: number;
    channel: number;
    game: number;
    import: number;
    overdue: number;
  };
  recent_activities: Array<{
    id: number;
    operator: string;
    action_type: string;
    detail: string;
    created_at: string;
  }>;
};

export async function getDashboardOverview(range: DashboardRange): Promise<DashboardOverview> {
  return apiRequest<DashboardOverview>(`/dashboard/overview?range=${range}`);
}
