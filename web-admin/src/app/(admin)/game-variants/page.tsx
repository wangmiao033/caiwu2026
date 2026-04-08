"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input, Select, Space, Spin, Switch, Table, Tag, message } from "antd";
import { apiRequest } from "@/lib/api";
import RoleGuard from "@/components/RoleGuard";
import { DISCOUNT_OPTIONS, type GameVariant, type Project } from "./game-variant-shared";

function GameVariantsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<GameVariant[]>([]);
  const [filterProjectId, setFilterProjectId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState("");

  const projectNameById = useMemo(() => {
    const m = new Map<number, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects]);

  const loadProjects = async () => {
    try {
      const list = await apiRequest<Project[]>("/projects");
      setProjects(list);
    } catch {
      setProjects([]);
    }
  };

  const loadVariants = async () => {
    try {
      const q = filterProjectId != null ? `?project_id=${filterProjectId}` : "";
      setRows(await apiRequest<GameVariant[]>(`/game-variants${q}`));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const loadAll = async () => {
    await loadProjects();
    await loadVariants();
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const k = (searchParams.get("keyword") || "").trim();
    setKeyword(k);
  }, [searchParams]);

  useEffect(() => {
    loadVariants();
  }, [filterProjectId]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (filterProjectId != null) {
      list = list.filter((r) => r.project_id === filterProjectId);
    }
    const q = keyword.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => r.raw_game_name.toLowerCase().includes(q) || r.variant_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, filterProjectId, keyword]);

  const toggleStatus = async (r: GameVariant, checked: boolean) => {
    try {
      await apiRequest(`/game-variants/${r.id}/status`, "PATCH", { status: checked ? "active" : "paused" });
      loadVariants();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <RoleGuard allow={["admin", "finance_manager", "tech"]}>
      <Card
        title="游戏版本管理"
        extra={
          <Space wrap>
            <Input
              allowClear
              placeholder="搜索原始游戏名 / 版本名"
              style={{ width: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              placeholder="按项目筛选"
              style={{ width: 200 }}
              options={projects.map((p) => ({ label: p.name, value: p.id }))}
              value={filterProjectId}
              onChange={(v) => setFilterProjectId(v)}
            />
            <Button onClick={loadAll}>刷新</Button>
            <Button type="primary" onClick={() => router.push("/game-variants/new")}>
              新增版本
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={filteredRows}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1100 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 72 },
            {
              title: "所属项目",
              width: 140,
              render: (_, r) => projectNameById.get(r.project_id) || `#${r.project_id}`,
            },
            { title: "版本名称", dataIndex: "variant_name", width: 140 },
            { title: "原始游戏名(raw)", dataIndex: "raw_game_name", ellipsis: true },
            {
              title: "折扣类型",
              dataIndex: "discount_type",
              width: 100,
              render: (v: string) => DISCOUNT_OPTIONS.find((o) => o.value === v)?.label || v,
            },
            { title: "版本类型", dataIndex: "version_type", width: 100 },
            { title: "服类型", dataIndex: "server_type", width: 80 },
            { title: "研发主体", dataIndex: "rd_company", width: 160, ellipsis: true, render: (v: string) => v || "-" },
            { title: "发行主体", dataIndex: "publish_company", width: 180, ellipsis: true, render: (v: string) => v || "-" },
            {
              title: "研发分成",
              dataIndex: "rd_share_percent",
              width: 100,
              render: (v: number | null) => (typeof v === "number" ? `${v}%` : "-"),
            },
            {
              title: "发行分成",
              dataIndex: "publish_share_percent",
              width: 100,
              render: (v: number | null) => (typeof v === "number" ? `${v}%` : "-"),
            },
            { title: "备注", dataIndex: "remark", ellipsis: true, width: 120 },
            {
              title: "状态",
              dataIndex: "status",
              width: 88,
              render: (v: string) => <Tag color={v === "active" ? "green" : "default"}>{v === "active" ? "启用" : "暂停"}</Tag>,
            },
            {
              title: "启用",
              width: 88,
              render: (_, r) => <Switch checked={r.status === "active"} onChange={(c) => toggleStatus(r, c)} />,
            },
            {
              title: "操作",
              width: 88,
              render: (_, r) => (
                <Button size="small" onClick={() => router.push(`/game-variants/${r.id}/edit`)}>
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </RoleGuard>
  );
}

export default function GameVariantsPage() {
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <GameVariantsPageContent />
    </Suspense>
  );
}
