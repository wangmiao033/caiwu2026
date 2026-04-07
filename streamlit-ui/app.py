import io
from typing import Tuple

import pandas as pd
import requests
import streamlit as st


st.set_page_config(page_title="财务对账前端", layout="wide")

DEFAULT_API_BASE = "http://127.0.0.1:8000"


def api_headers() -> dict:
    return {
        "X-Role": st.session_state.get("x_role", "finance"),
        "X-User": st.session_state.get("x_user", "finance_user"),
    }


def parse_upload(file_bytes: bytes, filename: str) -> pd.DataFrame:
    if filename.lower().endswith(".csv"):
        return pd.read_csv(io.BytesIO(file_bytes))
    return pd.read_excel(io.BytesIO(file_bytes))


def validate_df(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    must_cols = ["channel_name", "game_name", "gross_amount"]
    view_df = df.copy()
    for c in must_cols:
        if c not in view_df.columns:
            view_df[c] = None
    gross_numeric = pd.to_numeric(view_df["gross_amount"], errors="coerce")
    invalid_mask = (
        view_df["channel_name"].astype(str).str.strip().eq("")
        | view_df["game_name"].astype(str).str.strip().eq("")
        | gross_numeric.isna()
    )
    view_df["校验状态"] = invalid_mask.map({True: "异常", False: "正常"})
    return view_df, invalid_mask


def request_json(method: str, url: str, **kwargs):
    try:
        resp = requests.request(method, url, timeout=30, **kwargs)
    except requests.RequestException as exc:
        st.error(f"请求失败: {exc}")
        return None, None
    if resp.status_code >= 400:
        st.error(f"接口错误 {resp.status_code}: {resp.text}")
        return resp.status_code, None
    if not resp.text:
        return resp.status_code, {}
    return resp.status_code, resp.json()


def page_import(api_base: str):
    st.header("页面1：Excel导入")
    period = st.text_input("账期（例如 2026-03）", value="2026-03")
    up = st.file_uploader("上传渠道数据（Excel/CSV）", type=["xlsx", "xls", "csv"])

    if up is not None:
        raw = up.read()
        try:
            df = parse_upload(raw, up.name)
            checked_df, invalid_mask = validate_df(df)
            st.subheader("本地预校验（异常高亮）")

            def mark_row(row):
                if row["校验状态"] == "异常":
                    return ["background-color: #ffe6e6"] * len(row)
                return [""] * len(row)

            st.dataframe(checked_df.style.apply(mark_row, axis=1), use_container_width=True)
            st.info(f"本地预校验: 共 {len(checked_df)} 行，异常 {int(invalid_mask.sum())} 行")
        except Exception as exc:
            st.error(f"文件解析失败: {exc}")
            return

        if st.button("上传并调用 /recon/import", type="primary"):
            files = {"file": (up.name, raw, up.type or "application/octet-stream")}
            status, data = request_json(
                "POST",
                f"{api_base}/recon/import",
                params={"period": period},
                files=files,
                headers=api_headers(),
            )
            if data is not None:
                st.success("上传成功")
                st.json(data)
                st.session_state["latest_recon_task_id"] = data.get("recon_task_id")

    st.divider()
    st.subheader("核对任务列表")
    if st.button("刷新任务状态"):
        _, tasks = request_json("GET", f"{api_base}/recon/tasks", headers=api_headers())
        if tasks is not None:
            task_df = pd.DataFrame(tasks)
            if not task_df.empty and "status" in task_df.columns:
                st.dataframe(
                    task_df.style.apply(
                        lambda row: ["background-color: #ffe6e6"] * len(row) if row.get("status") == "异常待处理" else [""] * len(row),
                        axis=1,
                    ),
                    use_container_width=True,
                )
            else:
                st.dataframe(task_df, use_container_width=True)


def page_billing(api_base: str):
    st.header("页面2：账单管理")
    period = st.text_input("生成账单账期", value="2026-03", key="bill_period")
    force_new = st.checkbox("强制生成新版本", value=False)
    if st.button("调用 /billing/generate", type="primary"):
        _, data = request_json(
            "POST",
            f"{api_base}/billing/generate",
            params={"period": period, "force_new_version": force_new},
            headers=api_headers(),
        )
        if data is not None:
            st.success("账单生成完成")
            st.json(data)

    st.divider()
    st.subheader("账单列表")
    col1, col2 = st.columns(2)
    with col1:
        q_period = st.text_input("筛选账期", value="", key="q_period")
    with col2:
        q_type = st.selectbox("账单类型", options=["", "channel", "rd"], index=0)

    if st.button("查询 /billing/bills"):
        params = {}
        if q_period.strip():
            params["period"] = q_period.strip()
        if q_type:
            params["bill_type"] = q_type
        _, bills = request_json("GET", f"{api_base}/billing/bills", params=params, headers=api_headers())
        if bills is not None:
            df = pd.DataFrame(bills)
            st.session_state["bills_df"] = df
            st.dataframe(df, use_container_width=True)

    st.divider()
    st.subheader("发送账单 / 更新状态")
    bill_id = st.number_input("账单ID", min_value=1, step=1)
    new_status = st.selectbox("状态", options=["待发送", "已发送", "对方确认", "有异议"])
    note = st.text_input("备注", value="")
    if st.button("调用 /billing/{bill_id}/send"):
        _, data = request_json(
            "POST",
            f"{api_base}/billing/{int(bill_id)}/send",
            json={"status": new_status, "note": note},
            headers=api_headers(),
        )
        if data is not None:
            st.success("账单状态更新成功")
            st.json(data)


def page_dashboard(api_base: str):
    st.header("页面3：财务看板")
    if st.button("刷新 /dashboard/finance", type="primary"):
        _, data = request_json("GET", f"{api_base}/dashboard/finance", headers=api_headers())
        if data is None:
            return
        receivable = float(data.get("total_receivable", 0) or 0)
        received = float(data.get("total_received", 0) or 0)
        outstanding = float(data.get("outstanding", receivable - received) or 0)

        c1, c2, c3 = st.columns(3)
        c1.metric("应收", f"{receivable:,.2f}")
        c2.metric("已收", f"{received:,.2f}")
        c3.metric("未收", f"{outstanding:,.2f}")

        st.subheader("回款状态分布")
        status_breakdown = data.get("status_breakdown", {})
        if status_breakdown:
            bd_df = pd.DataFrame(
                [{"状态": k, "数量": v} for k, v in status_breakdown.items()]
            )
            st.bar_chart(bd_df.set_index("状态"))
        st.json(data)


def main():
    st.sidebar.title("对账系统")
    api_base = st.sidebar.text_input("后端地址", value=DEFAULT_API_BASE)
    st.session_state["x_role"] = st.sidebar.selectbox("角色", options=["finance", "admin", "biz", "ops"], index=0)
    st.session_state["x_user"] = st.sidebar.text_input("操作人", value="finance_user")

    menu = st.sidebar.radio("页面切换", options=["Excel导入", "账单管理", "财务看板"])
    if menu == "Excel导入":
        page_import(api_base)
    elif menu == "账单管理":
        page_billing(api_base)
    else:
        page_dashboard(api_base)


if __name__ == "__main__":
    main()
