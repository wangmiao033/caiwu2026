from __future__ import annotations

import datetime as dt
import enum
import io
import json
import os
import tempfile
from decimal import Decimal
from urllib import error as url_error
from urllib import request as url_request
from typing import Optional
from urllib.parse import urlparse

import pandas as pd
import jwt
from openpyxl import Workbook, load_workbook
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    create_engine,
    func,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


def resolve_database_url() -> str:
    db_url = os.getenv("DATABASE_URL", "").strip()
    app_env = os.getenv("APP_ENV", "").strip().lower()
    on_vercel = bool(os.getenv("VERCEL"))
    local_mode = app_env in {"local", "development", "dev"} or not on_vercel
    if db_url:
        return db_url
    if local_mode:
        return "sqlite:///./reconciliation.db"
    raise RuntimeError("DATABASE_URL is required in non-local environment.")


def normalize_database_url(db_url: str) -> str:
    # Neon/Heroku style URL may use postgres://, SQLAlchemy expects postgresql://
    if db_url.startswith("postgres://"):
        return db_url.replace("postgres://", "postgresql://", 1)
    return db_url


def is_sqlite_url(db_url: str) -> bool:
    return urlparse(db_url).scheme.startswith("sqlite")


DATABASE_URL = normalize_database_url(resolve_database_url())
engine_kwargs = {"echo": False, "future": True, "pool_pre_ping": True}
if is_sqlite_url(DATABASE_URL):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret")
JWT_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "7"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
bearer_scheme = HTTPBearer(auto_error=False)


class Base(DeclarativeBase):
    pass


class Role(str, enum.Enum):
    admin = "admin"
    finance_manager = "finance_manager"
    ops_manager = "ops_manager"
    tech = "tech"
    # 兼容历史角色值，避免老 token / 老数据直接失效
    finance = "finance"
    biz = "biz"
    ops = "ops"


class ReconStatus(str, enum.Enum):
    pending = "待确认"
    confirmed = "已确认"
    issue = "异常待处理"


class BillType(str, enum.Enum):
    channel = "channel"
    rd = "rd"


class BillStatus(str, enum.Enum):
    draft = "待发送"
    sent = "已发送"
    acknowledged = "对方确认"
    disputed = "有异议"


class InvoiceStatus(str, enum.Enum):
    pending = "待开票"
    issued = "已开票"
    voided = "已作废"


class CollectionStatus(str, enum.Enum):
    pending = "待回款"
    partial = "部分回款"
    paid = "已回款"


class ProjectStatus(str, enum.Enum):
    active = "active"
    paused = "paused"


class VariantStatus(str, enum.Enum):
    active = "active"
    paused = "paused"


class DiscountType(str, enum.Enum):
    none = "none"
    rate_01 = "0.1"
    rate_005 = "0.05"


class VersionType(str, enum.Enum):
    regular = "常规版"
    joint = "联运版"
    self_operated = "自运营版"
    discount = "折扣版"


class ServerType(str, enum.Enum):
    mixed = "混服"
    dedicated = "专服"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    role: Mapped[Role] = mapped_column(Enum(Role))


ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "123456")

LOCAL_USERS = {
    ADMIN_USERNAME: {"password": ADMIN_PASSWORD, "role": Role.admin},
    "finance_manager": {"password": "123456", "role": Role.finance_manager},
    "ops_manager": {"password": "123456", "role": Role.ops_manager},
    "tech": {"password": "123456", "role": Role.tech},
    "finance": {"password": "123456", "role": Role.finance_manager},
    "biz": {"password": "123456", "role": Role.tech},
    "ops": {"password": "123456", "role": Role.ops_manager},
}


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    active: Mapped[bool] = mapped_column(default=True)


class Game(Base):
    __tablename__ = "games"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    rd_company: Mapped[str] = mapped_column(String(150))
    # 研发分成（百分比 0~100），作为游戏级固定值；渠道-游戏映射页将优先使用该值
    rd_share_percent: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0"))
    active: Mapped[bool] = mapped_column(default=True)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    status: Mapped[ProjectStatus] = mapped_column(Enum(ProjectStatus), default=ProjectStatus.active)
    remark: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class GameVariant(Base):
    __tablename__ = "game_variants"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    variant_name: Mapped[str] = mapped_column(String(100))
    raw_game_name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    discount_type: Mapped[DiscountType] = mapped_column(Enum(DiscountType), default=DiscountType.none)
    version_type: Mapped[VersionType] = mapped_column(Enum(VersionType), default=VersionType.regular)
    server_type: Mapped[ServerType] = mapped_column(Enum(ServerType), default=ServerType.mixed)
    status: Mapped[VariantStatus] = mapped_column(Enum(VariantStatus), default=VariantStatus.active)
    remark: Mapped[str] = mapped_column(String(500), default="")
    rd_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    publish_company: Mapped[str] = mapped_column(String(200), default="广州熊动科技有限公司")
    rd_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    publish_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    settlement_remark: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    project: Mapped[Project] = relationship()


class ChannelGameMap(Base):
    __tablename__ = "channel_game_map"
    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    revenue_share_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0.3000"))
    rd_settlement_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0.5000"))
    channel: Mapped[Channel] = relationship()
    game: Mapped[Game] = relationship()


class ReconTask(Base):
    __tablename__ = "recon_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(20), index=True)
    status: Mapped[ReconStatus] = mapped_column(Enum(ReconStatus), default=ReconStatus.pending)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class RawStatement(Base):
    __tablename__ = "raw_statements"
    id: Mapped[int] = mapped_column(primary_key=True)
    recon_task_id: Mapped[int] = mapped_column(ForeignKey("recon_tasks.id"), index=True)
    channel_name: Mapped[str] = mapped_column(String(100))
    game_name: Mapped[str] = mapped_column(String(150))
    period: Mapped[str] = mapped_column(String(20), index=True)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    channel_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    game_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    mapping_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    channel_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    project_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    project_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    variant_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    variant_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rd_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    publish_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    rd_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    publish_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    match_status: Mapped[str] = mapped_column(String(20), default="未匹配")
    variant_match_status: Mapped[str] = mapped_column(String(20), default="未匹配版本")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ReconIssue(Base):
    __tablename__ = "recon_issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    recon_task_id: Mapped[int] = mapped_column(ForeignKey("recon_tasks.id"), index=True)
    issue_type: Mapped[str] = mapped_column(String(50))
    detail: Mapped[str] = mapped_column(String(300))
    resolved: Mapped[bool] = mapped_column(default=False)


class ReconIssueMeta(Base):
    __tablename__ = "recon_issue_meta"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("recon_issues.id"), unique=True, index=True)
    remark: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ReconIssueTimeline(Base):
    __tablename__ = "recon_issue_timeline"
    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("recon_issues.id"), index=True)
    action: Mapped[str] = mapped_column(String(30), default="resolve")
    from_status: Mapped[str] = mapped_column(String(30), default="未处理")
    to_status: Mapped[str] = mapped_column(String(30), default="已处理")
    remark: Mapped[str] = mapped_column(String(300), default="")
    operator: Mapped[str] = mapped_column(String(50), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ImportHistory(Base):
    __tablename__ = "import_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    import_type: Mapped[str] = mapped_column(String(20), index=True)
    period: Mapped[str] = mapped_column(String(20), index=True)
    file_name: Mapped[str] = mapped_column(String(200), default="")
    task_id: Mapped[int] = mapped_column(index=True)
    total_count: Mapped[int] = mapped_column(default=0)
    valid_count: Mapped[int] = mapped_column(default=0)
    invalid_count: Mapped[int] = mapped_column(default=0)
    amount_sum: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(30), default="待确认")
    lifecycle_status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    matched_variant_count: Mapped[int] = mapped_column(default=0)
    unmatched_variant_count: Mapped[int] = mapped_column(default=0)
    summary: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[str] = mapped_column(String(50), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class InvoiceMeta(Base):
    __tablename__ = "invoice_meta"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), unique=True, index=True)
    remark: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ReceiptMeta(Base):
    __tablename__ = "receipt_meta"
    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"), unique=True, index=True)
    remark: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class BillingRule(Base):
    __tablename__ = "billing_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    bill_type: Mapped[BillType] = mapped_column(Enum(BillType))
    default_ratio: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    active: Mapped[bool] = mapped_column(default=True)


class Bill(Base):
    __tablename__ = "bills"
    id: Mapped[int] = mapped_column(primary_key=True)
    bill_type: Mapped[BillType] = mapped_column(Enum(BillType), index=True)
    period: Mapped[str] = mapped_column(String(20), index=True)
    target_name: Mapped[str] = mapped_column(String(150), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    status: Mapped[BillStatus] = mapped_column(Enum(BillStatus), default=BillStatus.draft)
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    collection_status: Mapped[CollectionStatus] = mapped_column(Enum(CollectionStatus), default=CollectionStatus.pending)
    lifecycle_status: Mapped[str] = mapped_column(String(20), default="active", index=True)


class BillDeliveryLog(Base):
    __tablename__ = "bill_delivery_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    delivery_channel: Mapped[str] = mapped_column(String(50), default="internal")
    delivered_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    note: Mapped[str] = mapped_column(String(300), default="")


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_no: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    issue_date: Mapped[dt.date] = mapped_column(Date)
    amount_without_tax: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    status: Mapped[InvoiceStatus] = mapped_column(Enum(InvoiceStatus), default=InvoiceStatus.pending)


class Receipt(Base):
    __tablename__ = "receipts"
    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    received_at: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    bank_ref: Mapped[str] = mapped_column(String(100))
    account_name: Mapped[str] = mapped_column(String(100))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(50), index=True)
    action: Mapped[str] = mapped_column(String(100))
    target: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class SystemAuditLog(Base):
    __tablename__ = "system_audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    operator: Mapped[str] = mapped_column(String(50), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(50), index=True)
    target_id: Mapped[str] = mapped_column(String(100), default="")
    summary: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now(), index=True)


class UserProfile(Base):
    __tablename__ = "user_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # 使用 VARCHAR 存角色字符串，避免与 Postgres 上复用的旧 enum(role) 类型冲突（旧值不含 finance_manager 等）
    role: Mapped[str] = mapped_column(String(50), index=True)
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ChannelSettlementStatement(Base):
    __tablename__ = "channel_settlement_statements"
    __table_args__ = (UniqueConstraint("period", "channel_id", name="uq_settlement_period_channel"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(20), index=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"), index=True)
    total_gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total_discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total_settlement_base_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total_channel_fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    total_settlement_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    # Phase 1 固定 generated；保留字段便于后续扩展多状态
    status: Mapped[str] = mapped_column(String(20), default="generated", index=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[str] = mapped_column(String(50), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now(), index=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now(), index=True)
    channel: Mapped[Channel] = relationship()


class ChannelSettlementStatementItem(Base):
    __tablename__ = "channel_settlement_statement_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    statement_id: Mapped[int] = mapped_column(ForeignKey("channel_settlement_statements.id"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    raw_game_name_snapshot: Mapped[str] = mapped_column(String(150), default="")
    game_name_snapshot: Mapped[str] = mapped_column(String(150), default="")
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    settlement_base_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    channel_fee_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"))
    channel_fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    settlement_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())
    game: Mapped[Game] = relationship()


class ExceptionHandleStatus(str, enum.Enum):
    pending = "pending"
    ignored = "ignored"
    resolved = "resolved"


class ExceptionHandleRecord(Base):
    __tablename__ = "exception_handle_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    exception_type: Mapped[str] = mapped_column(String(20), index=True)
    exception_id: Mapped[str] = mapped_column(String(100), index=True)
    status: Mapped[ExceptionHandleStatus] = mapped_column(Enum(ExceptionHandleStatus), default=ExceptionHandleStatus.pending, index=True)
    remark: Mapped[str] = mapped_column(String(500), default="")
    updated_by: Mapped[str] = mapped_column(String(50), default="system")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now(), index=True)


class ChannelIn(BaseModel):
    name: str


class ChannelBulkCreateIn(BaseModel):
    names: list[str]


class GameBulkCreateIn(BaseModel):
    names: list[str]


class GameIn(BaseModel):
    name: str
    rd_company: str
    rd_share_percent: Decimal = Decimal("0")


class ProjectIn(BaseModel):
    name: str
    status: ProjectStatus = ProjectStatus.active
    remark: str = ""


class ProjectStatusPatch(BaseModel):
    status: ProjectStatus


class GameVariantIn(BaseModel):
    project_id: int
    variant_name: str
    raw_game_name: str
    discount_type: DiscountType = DiscountType.none
    version_type: VersionType = VersionType.regular
    server_type: ServerType = ServerType.mixed
    status: VariantStatus = VariantStatus.active
    remark: str = ""
    rd_company: Optional[str] = None
    publish_company: Optional[str] = "广州熊动科技有限公司"
    rd_share_percent: Optional[Decimal] = None
    publish_share_percent: Optional[Decimal] = None
    settlement_remark: Optional[str] = None


class VariantStatusPatch(BaseModel):
    status: VariantStatus


class MapIn(BaseModel):
    channel_id: int
    game_id: int
    revenue_share_ratio: Decimal = Field(default=Decimal("0.3000"))
    rd_settlement_ratio: Decimal = Field(default=Decimal("0.5000"))


class MapBulkCreateItem(BaseModel):
    channel_name: str
    game_name: str


class MapBulkCreateIn(BaseModel):
    items: list[MapBulkCreateItem]


class RuleIn(BaseModel):
    name: str
    bill_type: BillType
    default_ratio: Decimal


class ExceptionStatusPatchIn(BaseModel):
    type: str
    id: str
    status: ExceptionHandleStatus
    remark: str = ""


class RuleBulkRow(BaseModel):
    row_no: Optional[int] = None
    game: str
    channel: str
    discount_type: str = "无"
    channel_fee: Decimal = Decimal("0")
    tax_rate: Decimal = Decimal("0")
    rd_share: Decimal = Decimal("0.5")
    private_rate: Decimal = Decimal("0")
    ip_license: Decimal = Decimal("0")
    chaofan_channel: Decimal = Decimal("0")
    chaofan_rd: Decimal = Decimal("0")
    status: str = "启用"
    remark: str = ""


class RuleBulkIn(BaseModel):
    rows: list[RuleBulkRow]


class ResolveIssueIn(BaseModel):
    status: str = "已处理"
    remark: str = ""


class BulkResolveIssuesIn(BaseModel):
    issue_ids: list[int]
    remark: str = ""


class LoginIn(BaseModel):
    username: str
    password: str


class AuthLoginIn(BaseModel):
    email: str
    password: str


class AdminResetPasswordIn(BaseModel):
    email: str
    new_password: str


class SettlementStatementGenerateIn(BaseModel):
    period: str
    channel_id: int
    overwrite: bool = False


class BillStatusIn(BaseModel):
    status: BillStatus
    note: str = ""


class CleanupDuplicateBillsIn(BaseModel):
    # 安全起见默认预览；确认无误后传 false 执行真实删除
    dry_run: bool = True


class InvoiceIn(BaseModel):
    invoice_no: str
    bill_id: int
    issue_date: dt.date
    amount_without_tax: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    status: InvoiceStatus = InvoiceStatus.issued
    remark: str = ""


class ReceiptIn(BaseModel):
    bill_id: int
    received_at: dt.date
    amount: Decimal
    bank_ref: str
    account_name: str
    remark: str = ""
    status: Optional[CollectionStatus] = None


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BillOut(Out):
    id: int
    bill_type: BillType
    period: str
    target_name: str
    amount: Decimal
    status: BillStatus
    version: int
    collection_status: CollectionStatus


def calc_bill_flow_status(
    bill_amount: Decimal,
    bill_status: BillStatus,
    has_invoice: bool,
    received_total: Decimal,
) -> str:
    if received_total >= bill_amount and bill_amount > 0:
        return "已回款"
    if received_total > 0:
        return "部分回款"
    if has_invoice:
        return "已开票"
    if bill_status == BillStatus.sent:
        return "已发送"
    if bill_status in (BillStatus.acknowledged, BillStatus.disputed):
        return "已生成"
    return "草稿"


class ImportHistoryOut(Out):
    id: int
    import_type: str
    period: str
    file_name: str
    task_id: int
    total_count: int
    valid_count: int
    invalid_count: int
    amount_sum: Decimal
    status: str
    lifecycle_status: str = "active"
    summary: str
    created_by: str
    created_at: dt.datetime
    matched_variant_count: int = 0
    unmatched_variant_count: int = 0
    unresolved_issue_count: int = 0
    resolved_issue_count: int = 0
    task_status: str = ""


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def build_token(subject: str, role: Role) -> str:
    expire_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=JWT_EXPIRE_DAYS)
    payload = {"sub": subject, "role": role.value, "exp": expire_at}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def unauthorized(message: str = "未登录或登录已过期"):
    return HTTPException(status_code=401, detail={"code": 401, "message": message})


def normalize_role(role: Role) -> Role:
    if role == Role.finance:
        return Role.finance_manager
    if role == Role.ops:
        return Role.ops_manager
    if role == Role.biz:
        return Role.tech
    return role


def write_system_audit(
    db: Session,
    operator: str,
    action: str,
    target_type: str,
    target_id: str = "",
    summary: str = "",
):
    db.add(
        SystemAuditLog(
            operator=operator or "system",
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            created_at=dt.datetime.now(),
        )
    )


def supabase_sign_in(email: str, password: str) -> dict:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase 配置缺失，请设置 SUPABASE_URL / SUPABASE_ANON_KEY")
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = url_request.Request(
        url,
        method="POST",
        data=payload,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
        },
    )
    try:
        with url_request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except url_error.HTTPError as e:
        body = e.read().decode("utf-8") if hasattr(e, "read") else ""
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {}
        if e.code in (400, 401):
            raise HTTPException(status_code=401, detail="邮箱或密码错误") from e
        raise HTTPException(status_code=502, detail=f"Supabase 登录失败: {parsed.get('error_description') or parsed.get('msg') or 'unknown'}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="认证服务连接失败") from e


def validate_new_password(password: str):
    raw = (password or "").strip()
    if len(raw) < 8:
        raise HTTPException(status_code=400, detail="新密码不符合规则：至少 8 位")
    if not any(ch.isalpha() for ch in raw) or not any(ch.isdigit() for ch in raw):
        raise HTTPException(status_code=400, detail="新密码不符合规则：需包含字母和数字")


def supabase_find_user_by_email(email: str) -> Optional[dict]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase 配置缺失，请设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    url = f"{SUPABASE_URL}/auth/v1/admin/users?email={email}"
    req = url_request.Request(
        url,
        method="GET",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with url_request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            users = payload.get("users") or []
            return users[0] if users else None
    except url_error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
        raise HTTPException(status_code=502, detail=f"Supabase 查询用户失败: {body[:200] or e.reason}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="Supabase 查询用户失败，请稍后再试") from e


def supabase_admin_reset_password(user_id: str, new_password: str):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase 配置缺失，请设置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    payload = json.dumps({"password": new_password}).encode("utf-8")
    req = url_request.Request(
        url,
        method="PUT",
        data=payload,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with url_request.urlopen(req, timeout=15):
            return
    except url_error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
        if e.code == 400:
            raise HTTPException(status_code=400, detail="新密码不符合要求") from e
        raise HTTPException(status_code=502, detail=f"Supabase 重置失败，请稍后再试: {body[:200] or e.reason}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="Supabase 重置失败，请稍后再试") from e


def require_role(roles: list[Role]):
    normalized_roles = {normalize_role(x) for x in roles}

    def checker(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
        x_user: str = Header(default="system"),
        db: Session = Depends(get_db),
    ):
        if not credentials or credentials.scheme.lower() != "bearer":
            raise unauthorized()
        try:
            payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
            current_role = normalize_role(Role(payload.get("role", "ops_manager")))
            token_user = payload.get("sub", x_user)
        except Exception as e:
            raise unauthorized() from e
        if current_role not in normalized_roles:
            raise HTTPException(status_code=403, detail="无权限")
        db.add(AuditLog(actor=token_user, action="api_call", target=f"role={current_role.value}"))
        db.commit()
        return {"user": token_user, "role": current_role}

    return checker


def require_roles(roles: list[Role]):
    # RBAC 别名，便于语义化调用
    return require_role(roles)


def parse_profile_role(value: object) -> Role:
    """将 user_profiles.role（字符串或历史 Enum 实例）解析为 Role，供 RBAC 使用。"""
    if isinstance(value, Role):
        return normalize_role(value)
    if isinstance(value, str):
        try:
            return normalize_role(Role(value))
        except ValueError as e:
            raise HTTPException(status_code=500, detail=f"用户角色配置无效: {value}") from e
    raise HTTPException(status_code=500, detail="用户角色配置无效")


def ensure_user_profiles_role_string():
    """Postgres：若 role 列为旧 enum，迁移为 VARCHAR，避免新角色值写入失败。"""
    inspector = inspect(engine)
    if "user_profiles" not in inspector.get_table_names():
        return
    if is_sqlite_url(DATABASE_URL):
        return
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'role'"
                )
            ).mappings().first()
        if not row or row["data_type"] != "USER-DEFINED":
            return
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE user_profiles ALTER COLUMN role TYPE VARCHAR(50) USING role::text"))
    except Exception:
        # 迁移失败不阻塞启动；后续插入仍可能失败，需人工处理库表
        pass


def create_default_data(db: Session):
    if db.scalar(select(func.count(User.id))) == 0:
        db.add_all(
            [
                User(username="admin", role=Role.admin),
                User(username="finance", role=Role.finance),
                User(username="ops", role=Role.ops),
                User(username="biz", role=Role.biz),
            ]
        )
    if db.scalar(select(func.count(BillingRule.id))) == 0:
        db.add_all(
            [
                BillingRule(name="默认渠道分成", bill_type=BillType.channel, default_ratio=Decimal("0.3000")),
                BillingRule(name="默认研发结算", bill_type=BillType.rd, default_ratio=Decimal("0.5000")),
            ]
        )
    if db.scalar(select(func.count(UserProfile.id))) == 0:
        db.add_all(
            [
                UserProfile(email="wangmiao@dxyx6888.com", role=Role.admin.value, is_active=True),
                UserProfile(email="caiwu@dxyx6888.com", role=Role.finance_manager.value, is_active=True),
                UserProfile(email="pingce@dxyx6888.com", role=Role.ops_manager.value, is_active=True),
                UserProfile(email="515658123@qq.com", role=Role.tech.value, is_active=True),
            ]
        )
    db.commit()


def ensure_game_variant_settlement_columns():
    inspector = inspect(engine)
    if "game_variants" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("game_variants")}
    statements: list[str] = []
    if "rd_company" not in existing:
        statements.append("ALTER TABLE game_variants ADD COLUMN rd_company VARCHAR(200)")
    if "publish_company" not in existing:
        statements.append("ALTER TABLE game_variants ADD COLUMN publish_company VARCHAR(200) DEFAULT '广州熊动科技有限公司'")
    if "rd_share_percent" not in existing:
        statements.append("ALTER TABLE game_variants ADD COLUMN rd_share_percent NUMERIC(6,2)")
    if "publish_share_percent" not in existing:
        statements.append("ALTER TABLE game_variants ADD COLUMN publish_share_percent NUMERIC(6,2)")
    if "settlement_remark" not in existing:
        statements.append("ALTER TABLE game_variants ADD COLUMN settlement_remark VARCHAR(500)")
    if not statements:
        return
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def ensure_game_share_percent_column():
    inspector = inspect(engine)
    if "games" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("games")}
    if "rd_share_percent" in existing:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE games ADD COLUMN rd_share_percent NUMERIC(6,2) DEFAULT 0"))
    except Exception:
        pass


def ensure_bill_lifecycle_status_column():
    inspector = inspect(engine)
    if "bills" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("bills")}
    if "lifecycle_status" in existing:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE bills ADD COLUMN lifecycle_status VARCHAR(20) DEFAULT 'active'"))
    except Exception:
        pass


def ensure_import_enrichment_columns():
    inspector = inspect(engine)
    if "raw_statements" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("raw_statements")}
        statements: list[str] = []
        if "channel_id" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN channel_id INTEGER")
        if "game_id" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN game_id INTEGER")
        if "mapping_id" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN mapping_id INTEGER")
        if "channel_share_percent" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN channel_share_percent NUMERIC(6,2)")
        if "project_id" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN project_id INTEGER")
        if "project_name" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN project_name VARCHAR(150)")
        if "variant_id" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN variant_id INTEGER")
        if "variant_name" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN variant_name VARCHAR(100)")
        if "rd_company" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN rd_company VARCHAR(200)")
        if "publish_company" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN publish_company VARCHAR(200)")
        if "rd_share_percent" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN rd_share_percent NUMERIC(6,2)")
        if "publish_share_percent" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN publish_share_percent NUMERIC(6,2)")
        if "match_status" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN match_status VARCHAR(20) DEFAULT '未匹配'")
        if "variant_match_status" not in existing:
            statements.append("ALTER TABLE raw_statements ADD COLUMN variant_match_status VARCHAR(20) DEFAULT '未匹配版本'")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
    if "import_history" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("import_history")}
        statements: list[str] = []
        if "matched_variant_count" not in existing:
            statements.append("ALTER TABLE import_history ADD COLUMN matched_variant_count INTEGER DEFAULT 0")
        if "unmatched_variant_count" not in existing:
            statements.append("ALTER TABLE import_history ADD COLUMN unmatched_variant_count INTEGER DEFAULT 0")
        if "lifecycle_status" not in existing:
            statements.append("ALTER TABLE import_history ADD COLUMN lifecycle_status VARCHAR(20) DEFAULT 'active'")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))


def normalize_variant_shares(payload: GameVariantIn) -> tuple[Optional[Decimal], Optional[Decimal]]:
    rd_share = payload.rd_share_percent
    publish_share = payload.publish_share_percent
    if rd_share is not None and (rd_share < 0 or rd_share > 100):
        raise HTTPException(status_code=400, detail="研发分成需在 0~100 之间")
    if publish_share is not None and (publish_share < 0 or publish_share > 100):
        raise HTTPException(status_code=400, detail="发行分成需在 0~100 之间")
    if rd_share is not None and publish_share is None:
        publish_share = Decimal("100") - rd_share
    return rd_share, publish_share


app = FastAPI(title="内部对账系统", version="1.0.0")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    ensure_user_profiles_role_string()
    ensure_game_variant_settlement_columns()
    ensure_game_share_percent_column()
    ensure_bill_lifecycle_status_column()
    ensure_import_enrichment_columns()
    with SessionLocal() as db:
        create_default_data(db)


@app.get("/")
def root():
    return {"name": "内部对账系统", "phase": "1-3 已实现基础闭环", "docs": "/docs"}


def _perform_auth_login(email: str, password: str, db: Session):
    email = (email or "").strip().lower()
    if not email or not password:
        raise HTTPException(status_code=400, detail="邮箱和密码不能为空")
    supabase_resp = supabase_sign_in(email, password)
    supabase_user = supabase_resp.get("user") or {}
    auth_email = (supabase_user.get("email") or email).strip().lower()
    profile = db.scalar(select(UserProfile).where(UserProfile.email == auth_email))
    if not profile:
        raise HTTPException(status_code=403, detail="未分配系统角色")
    if not profile.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")
    role = parse_profile_role(profile.role)
    token = build_token(auth_email, role)
    write_system_audit(db, auth_email, "login_success", "auth", auth_email, "Supabase 邮箱登录成功")
    db.commit()
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "email": auth_email,
            "role": role.value,
            "is_active": profile.is_active,
        },
    }


@app.post("/auth/login")
def auth_login(payload: AuthLoginIn, db: Session = Depends(get_db)):
    return _perform_auth_login(payload.email, payload.password, db)


@app.post("/login")
def login_compat(payload: LoginIn, db: Session = Depends(get_db)):
    # 兼容旧前端字段（username），底层统一走 Supabase 邮箱登录
    return _perform_auth_login(payload.username, payload.password, db)


@app.get("/auth/me")
def auth_me(ctx: dict = Depends(require_roles([Role.admin, Role.finance_manager, Role.ops_manager, Role.tech])), db: Session = Depends(get_db)):
    email = (ctx["user"] or "").strip().lower()
    profile = db.scalar(select(UserProfile).where(UserProfile.email == email))
    if not profile:
        raise HTTPException(status_code=403, detail="未分配系统角色")
    if not profile.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")
    role = parse_profile_role(profile.role)
    return {"email": email, "role": role.value, "is_active": profile.is_active}


@app.post("/auth/admin/reset-password")
def auth_admin_reset_password(
    payload: AdminResetPasswordIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_roles([Role.admin])),
):
    email = (payload.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="邮箱不能为空")
    validate_new_password(payload.new_password)
    user = supabase_find_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="未找到该邮箱对应的用户")
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=502, detail="Supabase 用户数据异常")
    supabase_admin_reset_password(user_id, payload.new_password)
    write_system_audit(
        db,
        ctx["user"],
        "reset_user_password",
        "auth_user",
        email,
        f"operator_role=admin; 管理员重置用户密码：{email}",
    )
    db.commit()
    return {"ok": True, "message": "密码已重置"}


@app.post("/channels")
def create_channel(payload: ChannelIn, db: Session = Depends(get_db), ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
    channel = Channel(name=payload.name)
    db.add(channel)
    db.flush()
    write_system_audit(db, ctx["user"], "create_channel", "channel", str(channel.id), f"新增渠道: {payload.name}")
    db.commit()
    return {"id": channel.id, "name": channel.name}


@app.post("/channels/bulk-create")
def bulk_create_channels(
    payload: ChannelBulkCreateIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops])),
):
    success_count = 0
    failed_names: list[str] = []
    cleaned_names: list[str] = []
    seen = set()
    for raw in payload.names:
        name = (raw or "").strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        cleaned_names.append(name)
    exists = {x.name for x in db.scalars(select(Channel).where(Channel.name.in_(cleaned_names))).all()} if cleaned_names else set()
    for name in cleaned_names:
        if name in exists:
            failed_names.append(name)
            continue
        db.add(Channel(name=name))
        success_count += 1
    write_system_audit(
        db,
        ctx["user"],
        "bulk_create_channels",
        "channel",
        "",
        f"批量新增渠道: 成功{success_count}, 跳过{len(failed_names)}",
    )
    db.commit()
    return {"success_count": success_count, "failed_count": len(failed_names), "failed_names": failed_names}


@app.get("/channels")
def list_channels(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    return db.scalars(select(Channel).order_by(Channel.id.desc())).all()


@app.put("/channels/{channel_id}")
def update_channel(channel_id: int, payload: ChannelIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
    row = db.get(Channel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    row.name = payload.name
    write_system_audit(db, _["user"], "update_channel", "channel", str(row.id), f"编辑渠道: {payload.name}")
    db.commit()
    return {"id": row.id, "name": row.name}


@app.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(Channel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    write_system_audit(db, _["user"], "delete_channel", "channel", str(row.id), f"删除渠道: {row.name}")
    db.delete(row)
    db.commit()
    return {"id": channel_id, "deleted": True}


@app.post("/games")
def create_game(payload: GameIn, db: Session = Depends(get_db), ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
    if payload.rd_share_percent < 0 or payload.rd_share_percent > 100:
        raise HTTPException(status_code=400, detail="研发分成需在 0~100 之间")
    game = Game(name=payload.name, rd_company=payload.rd_company, rd_share_percent=payload.rd_share_percent)
    db.add(game)
    db.flush()
    write_system_audit(db, ctx["user"], "create_game", "game", str(game.id), f"新增游戏: {payload.name}")
    db.commit()
    return {"id": game.id, "name": game.name}


@app.post("/games/bulk-create")
def bulk_create_games(
    payload: GameBulkCreateIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops])),
):
    success_count = 0
    failed_names: list[str] = []
    cleaned_names: list[str] = []
    seen = set()
    for raw in payload.names:
        name = (raw or "").strip()
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        cleaned_names.append(name)
    exists = {x.name for x in db.scalars(select(Game).where(Game.name.in_(cleaned_names))).all()} if cleaned_names else set()
    for name in cleaned_names:
        if name in exists:
            failed_names.append(name)
            continue
        db.add(Game(name=name, rd_company="待补充", rd_share_percent=Decimal("0")))
        success_count += 1
    write_system_audit(
        db,
        ctx["user"],
        "bulk_create_games",
        "game",
        "",
        f"批量新增游戏: 成功{success_count}, 跳过{len(failed_names)}",
    )
    db.commit()
    return {"success_count": success_count, "failed_count": len(failed_names), "failed_names": failed_names}


@app.get("/games")
def list_games(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    return db.scalars(select(Game).order_by(Game.id.desc())).all()


@app.put("/games/{game_id}")
def update_game(game_id: int, payload: GameIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
    row = db.get(Game, game_id)
    if not row:
        raise HTTPException(status_code=404, detail="游戏不存在")
    if payload.rd_share_percent < 0 or payload.rd_share_percent > 100:
        raise HTTPException(status_code=400, detail="研发分成需在 0~100 之间")
    row.name = payload.name
    row.rd_company = payload.rd_company
    row.rd_share_percent = payload.rd_share_percent
    write_system_audit(db, _["user"], "update_game", "game", str(row.id), f"编辑游戏: {payload.name}")
    db.commit()
    return {"id": row.id, "name": row.name}


@app.delete("/games/{game_id}")
def delete_game(game_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(Game, game_id)
    if not row:
        raise HTTPException(status_code=404, detail="游戏不存在")
    write_system_audit(db, _["user"], "delete_game", "game", str(row.id), f"删除游戏: {row.name}")
    db.delete(row)
    db.commit()
    return {"id": game_id, "deleted": True}


@app.get("/projects")
def list_projects(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    return db.scalars(select(Project).order_by(Project.id.desc())).all()


@app.post("/projects")
def create_project(payload: ProjectIn, db: Session = Depends(get_db), ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    dup = db.scalar(select(Project).where(Project.name == name))
    if dup:
        raise HTTPException(status_code=400, detail="项目名称已存在")
    row = Project(name=name, status=payload.status, remark=(payload.remark or "").strip())
    db.add(row)
    db.flush()
    write_system_audit(db, ctx["user"], "create_project", "project", str(row.id), f"新增项目: {name}")
    db.commit()
    return row


@app.put("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.biz])),
):
    row = db.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="项目不存在")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    dup = db.scalar(select(Project).where(Project.name == name, Project.id != project_id))
    if dup:
        raise HTTPException(status_code=400, detail="项目名称已存在")
    row.name = name
    row.status = payload.status
    row.remark = (payload.remark or "").strip()
    write_system_audit(db, ctx["user"], "update_project", "project", str(row.id), f"编辑项目: {name}")
    db.commit()
    return row


@app.patch("/projects/{project_id}/status")
def patch_project_status(
    project_id: int,
    payload: ProjectStatusPatch,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.biz])),
):
    row = db.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="项目不存在")
    row.status = payload.status
    write_system_audit(db, ctx["user"], "update_project_status", "project", str(row.id), f"项目状态: {payload.status.value}")
    db.commit()
    return row


@app.get("/game-variants")
def list_game_variants(
    project_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech])),
):
    stmt = select(GameVariant).order_by(GameVariant.id.desc())
    if project_id is not None:
        stmt = stmt.where(GameVariant.project_id == project_id)
    return db.scalars(stmt).all()


@app.post("/game-variants")
def create_game_variant(payload: GameVariantIn, db: Session = Depends(get_db), ctx: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech]))):
    if not db.get(Project, payload.project_id):
        raise HTTPException(status_code=400, detail="所属项目不存在")
    raw = (payload.raw_game_name or "").strip()
    variant = (payload.variant_name or "").strip()
    if not raw or not variant:
        raise HTTPException(status_code=400, detail="版本名称与原始游戏名不能为空")
    dup = db.scalar(select(GameVariant).where(GameVariant.raw_game_name == raw))
    if dup:
        raise HTTPException(status_code=400, detail="原始游戏名已存在")
    rd_share, publish_share = normalize_variant_shares(payload)
    row = GameVariant(
        project_id=payload.project_id,
        variant_name=variant,
        raw_game_name=raw,
        discount_type=payload.discount_type,
        version_type=payload.version_type,
        server_type=payload.server_type,
        status=payload.status,
        remark=(payload.remark or "").strip(),
        rd_company=(payload.rd_company or "").strip() or None,
        publish_company=(payload.publish_company or "广州熊动科技有限公司").strip() or "广州熊动科技有限公司",
        rd_share_percent=rd_share,
        publish_share_percent=publish_share,
        settlement_remark=(payload.settlement_remark or "").strip() or None,
    )
    db.add(row)
    db.flush()
    write_system_audit(db, ctx["user"], "create_game_variant", "game_variant", str(row.id), f"新增版本: {variant} / {raw}")
    db.commit()
    return row


@app.put("/game-variants/{variant_id}")
def update_game_variant(
    variant_id: int,
    payload: GameVariantIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech])),
):
    row = db.get(GameVariant, variant_id)
    if not row:
        raise HTTPException(status_code=404, detail="版本不存在")
    if not db.get(Project, payload.project_id):
        raise HTTPException(status_code=400, detail="所属项目不存在")
    raw = (payload.raw_game_name or "").strip()
    variant = (payload.variant_name or "").strip()
    if not raw or not variant:
        raise HTTPException(status_code=400, detail="版本名称与原始游戏名不能为空")
    dup = db.scalar(select(GameVariant).where(GameVariant.raw_game_name == raw, GameVariant.id != variant_id))
    if dup:
        raise HTTPException(status_code=400, detail="原始游戏名已存在")
    rd_share, publish_share = normalize_variant_shares(payload)
    row.project_id = payload.project_id
    row.variant_name = variant
    row.raw_game_name = raw
    row.discount_type = payload.discount_type
    row.version_type = payload.version_type
    row.server_type = payload.server_type
    row.status = payload.status
    row.remark = (payload.remark or "").strip()
    row.rd_company = (payload.rd_company or "").strip() or None
    row.publish_company = (payload.publish_company or "广州熊动科技有限公司").strip() or "广州熊动科技有限公司"
    row.rd_share_percent = rd_share
    row.publish_share_percent = publish_share
    row.settlement_remark = (payload.settlement_remark or "").strip() or None
    write_system_audit(db, ctx["user"], "update_game_variant", "game_variant", str(row.id), f"编辑版本: {variant}")
    db.commit()
    return row


@app.patch("/game-variants/{variant_id}/status")
def patch_variant_status(
    variant_id: int,
    payload: VariantStatusPatch,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech])),
):
    row = db.get(GameVariant, variant_id)
    if not row:
        raise HTTPException(status_code=404, detail="版本不存在")
    row.status = payload.status
    write_system_audit(db, ctx["user"], "update_game_variant_status", "game_variant", str(row.id), f"版本状态: {payload.status.value}")
    db.commit()
    return row


@app.post("/channel-game-map")
def create_map(payload: MapIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech]))):
    exists = db.scalar(
        select(ChannelGameMap).where(ChannelGameMap.channel_id == payload.channel_id, ChannelGameMap.game_id == payload.game_id)
    )
    if exists:
        raise HTTPException(status_code=400, detail="关系已存在")
    item = ChannelGameMap(**payload.model_dump())
    db.add(item)
    db.flush()
    write_system_audit(db, _["user"], "create_channel_game_map", "channel_game_map", str(item.id), "新增渠道游戏映射")
    db.commit()
    return {"id": item.id}


@app.post("/channel-game-map/bulk-create")
def bulk_create_map(
    payload: MapBulkCreateIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech])),
):
    success_count = 0
    failed_items = []
    seen = set()
    for raw in payload.items:
        channel_name = (raw.channel_name or "").strip()
        game_name = (raw.game_name or "").strip()
        key = f"{channel_name}::{game_name}"
        if not channel_name or not game_name:
            failed_items.append({"channel_name": channel_name, "game_name": game_name, "reason": "格式错误"})
            continue
        if key in seen:
            failed_items.append({"channel_name": channel_name, "game_name": game_name, "reason": "重复输入"})
            continue
        seen.add(key)
        channel = db.scalar(select(Channel).where(Channel.name == channel_name))
        if not channel:
            failed_items.append({"channel_name": channel_name, "game_name": game_name, "reason": "渠道不存在"})
            continue
        game = db.scalar(select(Game).where(Game.name == game_name))
        if not game:
            failed_items.append({"channel_name": channel_name, "game_name": game_name, "reason": "游戏不存在"})
            continue
        exists = db.scalar(select(ChannelGameMap).where(ChannelGameMap.channel_id == channel.id, ChannelGameMap.game_id == game.id))
        if exists:
            failed_items.append({"channel_name": channel_name, "game_name": game_name, "reason": "映射已存在"})
            continue
        db.add(ChannelGameMap(channel_id=channel.id, game_id=game.id))
        success_count += 1
    write_system_audit(
        db,
        ctx["user"],
        "bulk_create_channel_game_map",
        "channel_game_map",
        "",
        f"批量新增映射: 成功{success_count}, 跳过{len(failed_items)}",
    )
    db.commit()
    return {"success_count": success_count, "failed_count": len(failed_items), "failed_items": failed_items}


@app.get("/channel-game-map")
def list_map(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech]))):
    rows = db.scalars(select(ChannelGameMap).order_by(ChannelGameMap.id.desc())).all()
    return [
        {
            "id": x.id,
            "channel": x.channel.name,
            "game": x.game.name,
            "revenue_share_ratio": x.revenue_share_ratio,
            "rd_settlement_ratio": x.rd_settlement_ratio,
        }
        for x in rows
    ]


@app.put("/channel-game-map/{map_id}")
def update_map(map_id: int, payload: MapIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech]))):
    row = db.get(ChannelGameMap, map_id)
    if not row:
        raise HTTPException(status_code=404, detail="映射不存在")
    row.channel_id = payload.channel_id
    row.game_id = payload.game_id
    row.revenue_share_ratio = payload.revenue_share_ratio
    row.rd_settlement_ratio = payload.rd_settlement_ratio
    write_system_audit(db, _["user"], "update_channel_game_map", "channel_game_map", str(row.id), "编辑渠道游戏映射")
    db.commit()
    return {"id": row.id}


@app.delete("/channel-game-map/{map_id}")
def delete_map(map_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(ChannelGameMap, map_id)
    if not row:
        raise HTTPException(status_code=404, detail="映射不存在")
    write_system_audit(db, _["user"], "delete_channel_game_map", "channel_game_map", str(row.id), "删除渠道游戏映射")
    db.delete(row)
    db.commit()
    return {"id": map_id, "deleted": True}


@app.post("/recon/import")
async def import_statement(
    period: str = Query(..., description="账期，例如 2026-03"),
    import_type: str = Query(default="template"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.tech])),
):
    content = await file.read()
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail={"code": 400, "message": "仅支持 CSV / XLSX 文件"})
    suffix = ".csv" if filename.endswith(".csv") else ".xlsx"
    with tempfile.NamedTemporaryFile(prefix="recon_import_", suffix=suffix, dir="/tmp", delete=False) as f:
        f.write(content)
        tmp = f.name
    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(tmp)
        else:
            wb = load_workbook(tmp, data_only=True, read_only=True)
            ws = wb[wb.sheetnames[0]]
            rows_iter = ws.iter_rows(values_only=True)
            headers = [str(x).strip() if x is not None else "" for x in next(rows_iter, [])]
            rows_data = []
            for row in rows_iter:
                if row is None:
                    continue
                values = list(row)
                if all(v is None or str(v).strip() == "" for v in values):
                    continue
                rows_data.append({headers[i] if i < len(headers) else f"col_{i}": values[i] for i in range(len(values))})
            df = pd.DataFrame(rows_data)
            wb.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail={"code": 400, "message": "仅支持 CSV / XLSX 文件"}) from e
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    required = {"channel_name", "game_name", "gross_amount"}
    if not required.issubset(set(df.columns)):
        raise HTTPException(status_code=400, detail="缺少字段: channel_name, game_name, gross_amount")
    task = ReconTask(period=period, status=ReconStatus.pending)
    db.add(task)
    db.flush()
    issue_count = 0
    matched_variant_count = 0
    unmatched_variant_count = 0
    total_count = int(len(df.index))
    amount_sum = Decimal("0")
    projects = {x.id: x for x in db.scalars(select(Project)).all()}
    variants = {x.raw_game_name: x for x in db.scalars(select(GameVariant)).all()}
    for _, row in df.iterrows():
        channel_name = str(row["channel_name"]).strip()
        game_name = str(row["game_name"]).strip()
        gross_amount = Decimal(str(row["gross_amount"]))
        amount_sum += gross_amount
        matched_variant = variants.get(game_name)
        matched_project = projects.get(matched_variant.project_id) if matched_variant else None
        if matched_variant:
            matched_variant_count += 1
        else:
            unmatched_variant_count += 1
        db.add(
            RawStatement(
                recon_task_id=task.id,
                channel_name=channel_name,
                game_name=game_name,
                period=period,
                gross_amount=gross_amount,
                project_id=matched_project.id if matched_project else None,
                project_name=matched_project.name if matched_project else None,
                variant_id=matched_variant.id if matched_variant else None,
                variant_name=matched_variant.variant_name if matched_variant else None,
                rd_company=matched_variant.rd_company if matched_variant else None,
                publish_company=matched_variant.publish_company if matched_variant else None,
                rd_share_percent=matched_variant.rd_share_percent if matched_variant else None,
                publish_share_percent=matched_variant.publish_share_percent if matched_variant else None,
                variant_match_status="已匹配版本" if matched_variant else "未匹配版本",
            )
        )
        channel = db.scalar(select(Channel).where(Channel.name == channel_name))
        game = db.scalar(select(Game).where(Game.name == game_name))
        if channel is None or game is None:
            db.add(
                ReconIssue(
                    recon_task_id=task.id,
                    issue_type="master_data",
                    detail=f"渠道或游戏不存在: {channel_name}/{game_name}",
                )
            )
            issue_count += 1
            continue
        link = db.scalar(
            select(ChannelGameMap).where(ChannelGameMap.channel_id == channel.id, ChannelGameMap.game_id == game.id)
        )
        if link is None:
            db.add(
                ReconIssue(
                    recon_task_id=task.id,
                    issue_type="mapping",
                    detail=f"渠道游戏映射不存在: {channel_name}/{game_name}",
                )
            )
            issue_count += 1
    task.status = ReconStatus.issue if issue_count > 0 else ReconStatus.pending
    valid_count = max(total_count - issue_count, 0)
    summary_text = f"总行数:{total_count}, 正常:{valid_count}, 异常:{issue_count}, 流水合计:{amount_sum}"
    db.add(
        ImportHistory(
            import_type=import_type,
            period=period,
            file_name=file.filename or "",
            task_id=task.id,
            total_count=total_count,
            valid_count=valid_count,
            invalid_count=issue_count,
            amount_sum=amount_sum,
            status="异常待处理" if issue_count > 0 else "待确认",
            matched_variant_count=matched_variant_count,
            unmatched_variant_count=unmatched_variant_count,
            lifecycle_status="active",
            summary=summary_text,
            created_by=ctx.get("user", "system"),
        )
    )
    write_system_audit(db, ctx["user"], "import_data", "recon_task", str(task.id), f"导入数据: {file.filename or 'unknown'}")
    db.commit()
    return {
        "recon_task_id": task.id,
        "issue_count": issue_count,
        "summary": {
            "total_count": total_count,
            "valid_count": valid_count,
            "invalid_count": issue_count,
            "amount_sum": amount_sum,
            "matched_variant_count": matched_variant_count,
            "unmatched_variant_count": unmatched_variant_count,
        },
    }


@app.post("/recon/{task_id}/confirm")
def confirm_recon(task_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    task = db.get(ReconTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    history = db.scalar(select(ImportHistory).where(ImportHistory.task_id == task_id).order_by(ImportHistory.id.desc()).limit(1))
    if history and (history.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="该批次已作废，不能确认入账")
    unresolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == task_id, ReconIssue.resolved.is_(False)))
    if unresolved > 0:
        raise HTTPException(status_code=400, detail="仍有异常未处理")
    task.status = ReconStatus.confirmed
    write_system_audit(db, _["user"], "confirm_recon_period", "recon_task", str(task.id), f"确认账期: {task.period}")
    db.commit()
    return {"task_id": task_id, "status": task.status}


@app.post("/recon/{task_id}/revert-confirm")
def revert_confirm_recon(
    task_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance])),
):
    task = db.get(ReconTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != ReconStatus.confirmed:
        raise HTTPException(status_code=400, detail="仅已确认任务允许撤销")
    history = db.scalar(select(ImportHistory).where(ImportHistory.task_id == task_id).order_by(ImportHistory.id.desc()).limit(1))
    if history and (history.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="已作废批次不可撤销入账")

    period = task.period
    bill_cnt = int(
        db.scalar(select(func.count(Bill.id)).where(Bill.period == period, Bill.lifecycle_status == "active")) or 0
    )
    if bill_cnt > 0:
        raise HTTPException(status_code=400, detail="该账期已生成账单，禁止撤销入账")

    stmt_cnt = int(db.scalar(select(func.count(ChannelSettlementStatement.id)).where(ChannelSettlementStatement.period == period)) or 0)
    if stmt_cnt > 0:
        raise HTTPException(status_code=400, detail="该账期已生成结算单，禁止撤销入账")

    inv_cnt = int(
        db.scalar(
            select(func.count(Invoice.id))
            .select_from(Invoice)
            .join(Bill, Bill.id == Invoice.bill_id)
            .where(Bill.period == period)
        )
        or 0
    )
    if inv_cnt > 0:
        raise HTTPException(status_code=400, detail="该账期已有发票，禁止撤销入账")

    rec_cnt = int(
        db.scalar(
            select(func.count(Receipt.id))
            .select_from(Receipt)
            .join(Bill, Bill.id == Receipt.bill_id)
            .where(Bill.period == period)
        )
        or 0
    )
    if rec_cnt > 0:
        raise HTTPException(status_code=400, detail="该账期已有回款，禁止撤销入账")

    task.status = ReconStatus.pending
    if history:
        history.status = "待确认"
    write_system_audit(db, ctx["user"], "revert_confirm_recon_period", "recon_task", str(task.id), f"撤销确认账期: {task.period}")
    db.commit()
    return {"task_id": task_id, "status": task.status}


@app.post("/recon/issues/{issue_id}/resolve")
def resolve_issue(
    issue_id: int,
    payload: ResolveIssueIn,
    db: Session = Depends(get_db),
    operator_ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    issue = db.get(ReconIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="异常不存在")
    from_status = "已处理" if issue.resolved else "未处理"
    issue.resolved = payload.status in {"已处理", "resolved", "true", "1"}
    to_status = "已处理" if issue.resolved else "未处理"
    meta = db.scalar(select(ReconIssueMeta).where(ReconIssueMeta.issue_id == issue.id))
    if meta:
        meta.remark = payload.remark
        meta.updated_at = dt.datetime.now()
    else:
        db.add(ReconIssueMeta(issue_id=issue.id, remark=payload.remark, updated_at=dt.datetime.now()))
    db.add(
        ReconIssueTimeline(
            issue_id=issue.id,
            action="resolve",
            from_status=from_status,
            to_status=to_status,
            remark=payload.remark,
            operator=operator_ctx.get("user", "system"),
            created_at=dt.datetime.now(),
        )
    )
    db.commit()
    return {"issue_id": issue.id, "resolved": issue.resolved, "status": "已处理" if issue.resolved else "未处理", "remark": payload.remark}


@app.post("/recon/issues/bulk-resolve")
def bulk_resolve_issues(
    payload: BulkResolveIssuesIn,
    db: Session = Depends(get_db),
    operator_ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    success_count = 0
    failed_ids = []
    for issue_id in payload.issue_ids:
        issue = db.get(ReconIssue, issue_id)
        if not issue:
            failed_ids.append(issue_id)
            continue
        from_status = "已处理" if issue.resolved else "未处理"
        issue.resolved = True
        to_status = "已处理"
        meta = db.scalar(select(ReconIssueMeta).where(ReconIssueMeta.issue_id == issue.id))
        if meta:
            meta.remark = payload.remark
            meta.updated_at = dt.datetime.now()
        else:
            db.add(ReconIssueMeta(issue_id=issue.id, remark=payload.remark, updated_at=dt.datetime.now()))
        db.add(
            ReconIssueTimeline(
                issue_id=issue.id,
                action="bulk_resolve",
                from_status=from_status,
                to_status=to_status,
                remark=payload.remark,
                operator=operator_ctx.get("user", "system"),
                created_at=dt.datetime.now(),
            )
        )
        success_count += 1
    db.commit()
    return {"success_count": success_count, "failed_count": len(failed_ids), "failed_ids": failed_ids}


@app.get("/recon/tasks")
def list_recon(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    tasks = db.scalars(select(ReconTask).order_by(ReconTask.id.desc())).all()
    return [{"id": x.id, "period": x.period, "status": x.status} for x in tasks]


@app.get("/recon/issues")
def list_recon_issues(task_id: int = Query(...), db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops]))):
    rows = db.scalars(select(ReconIssue).where(ReconIssue.recon_task_id == task_id).order_by(ReconIssue.id.desc())).all()
    result = []
    for x in rows:
        meta = db.scalar(select(ReconIssueMeta).where(ReconIssueMeta.issue_id == x.id))
        latest_timeline = db.scalar(select(ReconIssueTimeline).where(ReconIssueTimeline.issue_id == x.id).order_by(ReconIssueTimeline.id.desc()).limit(1))
        result.append(
            {
                "issue_id": x.id,
                "task_id": x.recon_task_id,
                "issue_type": x.issue_type,
                "message": x.detail,
                "status": "已处理" if x.resolved else "未处理",
                "row_no": None,
                "raw_data": None,
                "created_at": "",
                "remark": meta.remark if meta else "",
                "updated_at": str(meta.updated_at) if meta else "",
                "latest_operator": latest_timeline.operator if latest_timeline else "",
                "latest_updated_at": str(latest_timeline.created_at) if latest_timeline else "",
            }
        )
    return result


@app.get("/recon/issues/{issue_id}/timeline")
def get_issue_timeline(
    issue_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops, Role.biz])),
):
    issue = db.get(ReconIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="异常不存在")
    rows = db.scalars(select(ReconIssueTimeline).where(ReconIssueTimeline.issue_id == issue_id).order_by(ReconIssueTimeline.id.asc())).all()
    return [
        {
            "id": x.id,
            "issue_id": x.issue_id,
            "action": x.action,
            "from_status": x.from_status,
            "to_status": x.to_status,
            "remark": x.remark,
            "operator": x.operator,
            "created_at": str(x.created_at),
        }
        for x in rows
    ]


@app.post("/billing/rules")
def create_rule(payload: RuleIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    rule = BillingRule(**payload.model_dump())
    db.add(rule)
    db.flush()
    write_system_audit(db, _["user"], "create_billing_rule", "billing_rule", str(rule.id), f"新增规则: {rule.name}")
    db.commit()
    return {"id": rule.id}


@app.get("/billing/rules")
def list_rules(
    channel: Optional[str] = None,
    game: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz])),
):
    rows = db.scalars(select(BillingRule).order_by(BillingRule.id.desc())).all()
    if channel:
        rows = [x for x in rows if channel in x.name]
    if game:
        rows = [x for x in rows if game in x.name]
    return rows


@app.put("/billing/rules/{rule_id}")
def update_rule(rule_id: int, payload: RuleIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    row = db.get(BillingRule, rule_id)
    if not row:
        raise HTTPException(status_code=404, detail="规则不存在")
    row.name = payload.name
    row.bill_type = payload.bill_type
    row.default_ratio = payload.default_ratio
    write_system_audit(db, _["user"], "update_billing_rule", "billing_rule", str(row.id), f"编辑规则: {row.name}")
    db.commit()
    return {"id": row.id}


@app.post("/billing/rules/bulk-import")
def bulk_import_rules(payload: RuleBulkIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    created_count = 0
    updated_count = 0
    failed_count = 0
    error_details = []
    channel_set = {x.name for x in db.scalars(select(Channel)).all()}
    game_set = {x.name for x in db.scalars(select(Game)).all()}
    valid_discount = {"无", "0.1折", "0.05折"}
    valid_status = {"启用", "停用", "enabled", "disabled", "true", "false", "1", "0"}
    for idx, row in enumerate(payload.rows):
        try:
            err_fields = []
            err_msgs = []
            if not row.game:
                err_fields.append("game")
                err_msgs.append("游戏为空")
            if not row.channel:
                err_fields.append("channel")
                err_msgs.append("渠道为空")
            if row.game and row.game not in game_set:
                err_fields.append("game")
                err_msgs.append("游戏不存在")
            if row.channel and row.channel not in channel_set:
                err_fields.append("channel")
                err_msgs.append("渠道不存在")
            if row.discount_type not in valid_discount:
                err_fields.append("discount_type")
                err_msgs.append("折扣类型非法")
            if row.status not in valid_status:
                err_fields.append("status")
                err_msgs.append("状态非法")
            for val, name, field_name in [
                (row.channel_fee, "通道费格式非法", "channel_fee"),
                (row.tax_rate, "税点格式非法", "tax_rate"),
                (row.rd_share, "研发分成格式非法", "rd_share"),
                (row.private_rate, "私点格式非法", "private_rate"),
            ]:
                if val is None:
                    err_fields.append(field_name)
                    err_msgs.append(name)
            if err_msgs:
                failed_count += 1
                error_details.append(
                    {
                        "row_no": row.row_no or idx + 2,
                        "raw_data": row.model_dump(),
                        "error_fields": err_fields,
                        "error_message": ";".join(err_msgs),
                    }
                )
                continue
            name = f"{row.channel}-{row.game}-rule"
            existing = db.scalar(select(BillingRule).where(BillingRule.name == name))
            if existing:
                existing.default_ratio = row.rd_share
                existing.active = row.status in {"启用", "enabled", "true", "1"}
                updated_count += 1
            else:
                db.add(
                    BillingRule(
                        name=name,
                        bill_type=BillType.channel,
                        default_ratio=row.rd_share,
                        active=row.status in {"启用", "enabled", "true", "1"},
                    )
                )
                created_count += 1
        except Exception:
            failed_count += 1
    write_system_audit(
        db,
        _["user"],
        "bulk_import_billing_rules",
        "billing_rule",
        "",
        f"规则批量导入: 新增{created_count}, 更新{updated_count}, 失败{failed_count}",
    )
    db.commit()
    return {
        "created_count": created_count,
        "updated_count": updated_count,
        "failed_count": failed_count,
        "error_details": error_details,
    }


@app.post("/billing/rules/bulk-validate")
def bulk_validate_rules(payload: RuleBulkIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    channel_set = {x.name for x in db.scalars(select(Channel)).all()}
    game_set = {x.name for x in db.scalars(select(Game)).all()}
    valid_discount = {"无", "0.1折", "0.05折"}
    valid_status = {"启用", "停用", "enabled", "disabled", "true", "false", "1", "0"}
    error_details = []
    for idx, row in enumerate(payload.rows):
        err_fields = []
        err_msgs = []
        if not row.game:
            err_fields.append("game")
            err_msgs.append("游戏为空")
        if not row.channel:
            err_fields.append("channel")
            err_msgs.append("渠道为空")
        if row.game and row.game not in game_set:
            err_fields.append("game")
            err_msgs.append("游戏不存在")
        if row.channel and row.channel not in channel_set:
            err_fields.append("channel")
            err_msgs.append("渠道不存在")
        if row.discount_type not in valid_discount:
            err_fields.append("discount_type")
            err_msgs.append("折扣类型非法")
        if row.status not in valid_status:
            err_fields.append("status")
            err_msgs.append("状态非法")
        for val, name, field_name in [
            (row.channel_fee, "通道费格式非法", "channel_fee"),
            (row.tax_rate, "税点格式非法", "tax_rate"),
            (row.rd_share, "研发分成格式非法", "rd_share"),
            (row.private_rate, "私点格式非法", "private_rate"),
        ]:
            if val is None:
                err_fields.append(field_name)
                err_msgs.append(name)
        if err_msgs:
            error_details.append(
                {
                    "row_no": row.row_no or idx + 2,
                    "raw_data": row.model_dump(),
                    "error_fields": err_fields,
                    "error_message": ";".join(err_msgs),
                }
            )
    return {
        "total_count": len(payload.rows),
        "failed_count": len(error_details),
        "valid_count": len(payload.rows) - len(error_details),
        "error_details": error_details,
    }


def _money2(value: Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _ensure_period_format(period: str):
    raw = (period or "").strip()
    try:
        dt.datetime.strptime(raw, "%Y-%m")
    except ValueError as e:
        raise HTTPException(status_code=400, detail="period 格式非法，应为 YYYY-MM") from e


def _build_settlement_snapshot(db: Session, period: str, channel_id: int) -> tuple[Channel, dict[int, dict], Decimal, Decimal, Decimal, Decimal, Decimal]:
    _ensure_period_format(period)
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="渠道不存在")
    recon_tasks = db.scalars(select(ReconTask).where(ReconTask.period == period, ReconTask.status == ReconStatus.confirmed)).all()
    if not recon_tasks:
        raise HTTPException(status_code=400, detail="该账期无已确认核对任务")
    task_ids = [x.id for x in recon_tasks]
    rows = db.scalars(
        select(RawStatement).where(
            RawStatement.recon_task_id.in_(task_ids),
            RawStatement.period == period,
            RawStatement.channel_name == channel.name,
        )
    ).all()
    if not rows:
        raise HTTPException(status_code=400, detail="该渠道该账期无可用流水")
    maps = db.scalars(select(ChannelGameMap).where(ChannelGameMap.channel_id == channel_id)).all()
    map_by_game_name = {m.game.name: m for m in maps}
    if not map_by_game_name:
        raise HTTPException(status_code=400, detail="该渠道缺少渠道游戏映射，无法生成对账单")
    unmatched_games: set[str] = set()
    items_by_game: dict[int, dict] = {}
    for row in rows:
        link = map_by_game_name.get(row.game_name)
        if not link:
            unmatched_games.add(row.game_name)
            continue
        game_id = link.game_id
        item = items_by_game.get(game_id)
        if not item:
            item = {
                "game_id": game_id,
                "raw_game_name_snapshot": row.game_name or "",
                "game_name_snapshot": link.game.name,
                "gross_amount": Decimal("0"),
                "discount_amount": Decimal("0"),
                "settlement_base_amount": Decimal("0"),
                "channel_fee_rate": Decimal(str(link.revenue_share_ratio)),
                "channel_fee_amount": Decimal("0"),
                "settlement_amount": Decimal("0"),
            }
            items_by_game[game_id] = item
        item["gross_amount"] += Decimal(str(row.gross_amount or 0))
    if unmatched_games:
        sample = "、".join(sorted(list(unmatched_games))[:5])
        raise HTTPException(status_code=400, detail=f"存在未映射游戏，无法生成：{sample}")
    total_gross_amount = Decimal("0")
    total_discount_amount = Decimal("0")
    total_settlement_base_amount = Decimal("0")
    total_channel_fee_amount = Decimal("0")
    total_settlement_amount = Decimal("0")
    for _, item in items_by_game.items():
        item["gross_amount"] = _money2(item["gross_amount"])
        # Phase 1：减免口径尚无稳定来源，固定 0，并保留字段快照
        item["discount_amount"] = Decimal("0.00")
        item["settlement_base_amount"] = _money2(item["gross_amount"] - item["discount_amount"])
        item["channel_fee_amount"] = _money2(item["settlement_base_amount"] * item["channel_fee_rate"])
        # 口径：对账金额 = 结算基数 - 通道费
        item["settlement_amount"] = _money2(item["settlement_base_amount"] - item["channel_fee_amount"])
        total_gross_amount += item["gross_amount"]
        total_discount_amount += item["discount_amount"]
        total_settlement_base_amount += item["settlement_base_amount"]
        total_channel_fee_amount += item["channel_fee_amount"]
        total_settlement_amount += item["settlement_amount"]
    return (
        channel,
        items_by_game,
        _money2(total_gross_amount),
        _money2(total_discount_amount),
        _money2(total_settlement_base_amount),
        _money2(total_channel_fee_amount),
        _money2(total_settlement_amount),
    )


@app.get("/settlement-statements")
def list_settlement_statements(
    period: Optional[str] = None,
    channel_id: Optional[int] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    stmt = select(ChannelSettlementStatement).order_by(ChannelSettlementStatement.id.desc())
    if period:
        stmt = stmt.where(ChannelSettlementStatement.period == period)
    if channel_id:
        stmt = stmt.where(ChannelSettlementStatement.channel_id == channel_id)
    if status:
        stmt = stmt.where(ChannelSettlementStatement.status == status)
    rows = db.scalars(stmt).all()
    channel_name_map: dict[int, str] = {}
    if rows:
        ids = list({x.channel_id for x in rows})
        channels = db.scalars(select(Channel).where(Channel.id.in_(ids))).all()
        channel_name_map = {c.id: c.name for c in channels}
    items = [
        {
            "id": row.id,
            "period": row.period,
            "channel_id": row.channel_id,
            "channel_name": channel_name_map.get(row.channel_id, ""),
            "total_gross_amount": row.total_gross_amount,
            "total_discount_amount": row.total_discount_amount,
            "total_settlement_base_amount": row.total_settlement_base_amount,
            "total_channel_fee_amount": row.total_channel_fee_amount,
            "total_settlement_amount": row.total_settlement_amount,
            "status": row.status,
            "updated_at": row.updated_at,
            "created_at": row.created_at,
        }
        for row in rows
    ]
    if keyword:
        key = keyword.strip().lower()
        items = [x for x in items if key in (x["channel_name"] or "").lower()]
    return {"items": items, "total": len(items)}


@app.post("/settlement-statements/generate")
def generate_settlement_statement(
    payload: SettlementStatementGenerateIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance])),
):
    period = (payload.period or "").strip()
    existing = db.scalar(
        select(ChannelSettlementStatement).where(
            ChannelSettlementStatement.period == period,
            ChannelSettlementStatement.channel_id == payload.channel_id,
        )
    )
    if existing and not payload.overwrite:
        raise HTTPException(status_code=400, detail="已存在，请确认是否覆盖")
    (
        channel,
        items_by_game,
        total_gross_amount,
        total_discount_amount,
        total_settlement_base_amount,
        total_channel_fee_amount,
        total_settlement_amount,
    ) = _build_settlement_snapshot(db, period, payload.channel_id)
    now = dt.datetime.now()
    if existing:
        old_items = db.scalars(select(ChannelSettlementStatementItem).where(ChannelSettlementStatementItem.statement_id == existing.id)).all()
        for old in old_items:
            db.delete(old)
        statement = existing
    else:
        statement = ChannelSettlementStatement(
            period=period,
            channel_id=payload.channel_id,
            created_by=ctx["user"],
            status="generated",
            created_at=now,
            updated_at=now,
        )
        db.add(statement)
        db.flush()
    statement.total_gross_amount = total_gross_amount
    statement.total_discount_amount = total_discount_amount
    statement.total_settlement_base_amount = total_settlement_base_amount
    statement.total_channel_fee_amount = total_channel_fee_amount
    statement.total_settlement_amount = total_settlement_amount
    statement.status = "generated"
    statement.updated_at = now
    sort_order = 1
    for item in sorted(items_by_game.values(), key=lambda x: x["game_name_snapshot"]):
        db.add(
            ChannelSettlementStatementItem(
                statement_id=statement.id,
                game_id=item["game_id"],
                raw_game_name_snapshot=item["raw_game_name_snapshot"],
                game_name_snapshot=item["game_name_snapshot"],
                gross_amount=item["gross_amount"],
                discount_amount=item["discount_amount"],
                settlement_base_amount=item["settlement_base_amount"],
                channel_fee_rate=item["channel_fee_rate"],
                channel_fee_amount=item["channel_fee_amount"],
                settlement_amount=item["settlement_amount"],
                sort_order=sort_order,
                created_at=now,
                updated_at=now,
            )
        )
        sort_order += 1
    action = "regenerate_settlement_statement" if existing else "generate_settlement_statement"
    write_system_audit(
        db,
        ctx["user"],
        action,
        "settlement_statement",
        str(statement.id),
        f"生成渠道对账单：{period} / {channel.name}",
    )
    db.commit()
    return {"id": statement.id, "period": statement.period, "channel_id": statement.channel_id, "status": statement.status}


@app.get("/settlement-statements/{statement_id}")
def get_settlement_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    statement = db.get(ChannelSettlementStatement, statement_id)
    if not statement:
        raise HTTPException(status_code=404, detail="对账单不存在")
    channel = db.get(Channel, statement.channel_id)
    items = db.scalars(
        select(ChannelSettlementStatementItem)
        .where(ChannelSettlementStatementItem.statement_id == statement_id)
        .order_by(ChannelSettlementStatementItem.sort_order.asc(), ChannelSettlementStatementItem.id.asc())
    ).all()
    return {
        "id": statement.id,
        "period": statement.period,
        "channel_id": statement.channel_id,
        "channel_name": channel.name if channel else "",
        "status": statement.status,
        "total_gross_amount": statement.total_gross_amount,
        "total_discount_amount": statement.total_discount_amount,
        "total_settlement_base_amount": statement.total_settlement_base_amount,
        "total_channel_fee_amount": statement.total_channel_fee_amount,
        "total_settlement_amount": statement.total_settlement_amount,
        "note": statement.note,
        "created_by": statement.created_by,
        "created_at": statement.created_at,
        "updated_at": statement.updated_at,
        "items": [
            {
                "id": x.id,
                "game_id": x.game_id,
                "raw_game_name_snapshot": x.raw_game_name_snapshot,
                "game_name_snapshot": x.game_name_snapshot,
                "gross_amount": x.gross_amount,
                "discount_amount": x.discount_amount,
                "settlement_base_amount": x.settlement_base_amount,
                "channel_fee_rate": x.channel_fee_rate,
                "channel_fee_amount": x.channel_fee_amount,
                "settlement_amount": x.settlement_amount,
                "sort_order": x.sort_order,
            }
            for x in items
        ],
    }


@app.get("/settlement-statements/{statement_id}/export")
def export_settlement_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance])),
):
    statement = db.get(ChannelSettlementStatement, statement_id)
    if not statement:
        raise HTTPException(status_code=404, detail="对账单不存在")
    channel = db.get(Channel, statement.channel_id)
    items = db.scalars(
        select(ChannelSettlementStatementItem)
        .where(ChannelSettlementStatementItem.statement_id == statement_id)
        .order_by(ChannelSettlementStatementItem.sort_order.asc(), ChannelSettlementStatementItem.id.asc())
    ).all()
    wb = Workbook()
    ws = wb.active
    ws.title = "渠道结算对账单"
    ws["A1"] = "渠道结算对账单"
    ws["A3"] = "结算周期"
    ws["B3"] = statement.period
    ws["D3"] = "渠道名称"
    ws["E3"] = channel.name if channel else ""
    ws["A5"] = "游戏名称"
    ws["B5"] = "系统流水"
    ws["C5"] = "减免/测试金"
    ws["D5"] = "结算基数"
    ws["E5"] = "通道费率"
    ws["F5"] = "通道费金额"
    ws["G5"] = "对账金额"
    row_idx = 6
    for item in items:
        ws[f"A{row_idx}"] = item.game_name_snapshot
        ws[f"B{row_idx}"] = float(item.gross_amount)
        ws[f"C{row_idx}"] = float(item.discount_amount)
        ws[f"D{row_idx}"] = float(item.settlement_base_amount)
        ws[f"E{row_idx}"] = float(item.channel_fee_rate)
        ws[f"F{row_idx}"] = float(item.channel_fee_amount)
        ws[f"G{row_idx}"] = float(item.settlement_amount)
        row_idx += 1
    ws[f"A{row_idx}"] = "合计"
    ws[f"B{row_idx}"] = float(statement.total_gross_amount)
    ws[f"C{row_idx}"] = float(statement.total_discount_amount)
    ws[f"D{row_idx}"] = float(statement.total_settlement_base_amount)
    ws[f"F{row_idx}"] = float(statement.total_channel_fee_amount)
    ws[f"G{row_idx}"] = float(statement.total_settlement_amount)
    ws[f"A{row_idx + 2}"] = "备注"
    ws[f"B{row_idx + 2}"] = statement.note or ""
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 12
    ws.column_dimensions["F"].width = 14
    ws.column_dimensions["G"].width = 14
    bio = io.BytesIO()
    wb.save(bio)
    write_system_audit(
        db,
        ctx["user"],
        "export_settlement_statement",
        "settlement_statement",
        str(statement.id),
        f"导出渠道对账单：{statement.period} / {(channel.name if channel else '')}",
    )
    db.commit()
    filename = f"settlement_statement_{statement.period}_{statement.id}.xlsx"
    return Response(
        content=bio.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/billing/rules/export")
def export_rules(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
    rows = db.scalars(select(BillingRule).order_by(BillingRule.id.desc())).all()
    return [
        {
            "id": x.id,
            "name": x.name,
            "bill_type": x.bill_type,
            "default_ratio": x.default_ratio,
            "active": x.active,
        }
        for x in rows
    ]


@app.post("/billing/generate")
def generate_bills(
    period: str = Query(...),
    overwrite: bool = Query(default=False),
    force_new_version: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance])),
):
    # 兼容历史参数：旧前端可能仍传 force_new_version，语义上等同于重生成
    overwrite = bool(overwrite or force_new_version)
    existing_period_bills = db.scalars(select(Bill).where(Bill.period == period)).all()
    if existing_period_bills and not overwrite:
        raise HTTPException(status_code=400, detail="该账期账单已存在")
    recon_tasks = db.scalars(select(ReconTask).where(ReconTask.period == period, ReconTask.status == ReconStatus.confirmed)).all()
    if not recon_tasks:
        raise HTTPException(status_code=400, detail="该账期无已确认核对任务")
    task_ids = [x.id for x in recon_tasks]
    rows = db.scalars(select(RawStatement).where(RawStatement.recon_task_id.in_(task_ids))).all()
    if not rows:
        raise HTTPException(status_code=400, detail="无原始数据")
    map_rows = db.scalars(select(ChannelGameMap)).all()
    map_key = {(m.channel.name, m.game.name): m for m in map_rows}
    channel_sum: dict[str, Decimal] = {}
    rd_sum: dict[str, Decimal] = {}
    for r in rows:
        link = map_key.get((r.channel_name, r.game_name))
        if not link:
            continue
        channel_amount = r.gross_amount * link.revenue_share_ratio
        rd_amount = r.gross_amount * link.rd_settlement_ratio
        channel_sum[r.channel_name] = channel_sum.get(r.channel_name, Decimal("0")) + channel_amount
        rd_sum[link.game.rd_company] = rd_sum.get(link.game.rd_company, Decimal("0")) + rd_amount
    existing_key_map: dict[tuple[BillType, str], Bill] = {}
    for bill in existing_period_bills:
        key = (bill.bill_type, bill.target_name)
        prev = existing_key_map.get(key)
        if not prev or bill.id > prev.id:
            existing_key_map[key] = bill
    created = 0
    updated = 0
    for target, amount in channel_sum.items():
        key = (BillType.channel, target)
        existing = existing_key_map.get(key)
        if existing:
            if overwrite:
                existing.amount = amount
                updated += 1
            continue
        db.add(Bill(bill_type=BillType.channel, period=period, target_name=target, amount=amount, version=1))
        created += 1
    for target, amount in rd_sum.items():
        key = (BillType.rd, target)
        existing = existing_key_map.get(key)
        if existing:
            if overwrite:
                existing.amount = amount
                updated += 1
            continue
        db.add(Bill(bill_type=BillType.rd, period=period, target_name=target, amount=amount, version=1))
        created += 1
    audit_action = "regenerate_bills" if overwrite else "generate_bills"
    write_system_audit(db, _["user"], audit_action, "bill", period, f"生成账单: 新增{created}, 更新{updated}")
    db.commit()
    return {"created_bills": created, "updated_bills": updated, "overwrite": overwrite}


@app.get("/billing/bills")
def list_bills(
    period: Optional[str] = None,
    bill_type: Optional[BillType] = None,
    lifecycle_status: Optional[str] = "active",
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    stmt = select(Bill).order_by(Bill.id.desc())
    if lifecycle_status in {"active", "discarded"}:
        stmt = stmt.where(Bill.lifecycle_status == lifecycle_status)
    if period:
        stmt = stmt.where(Bill.period == period)
    if bill_type:
        stmt = stmt.where(Bill.bill_type == bill_type)
    rows = db.scalars(stmt).all()
    result = []
    for b in rows:
        invoices = db.scalars(select(Invoice).where(Invoice.bill_id == b.id).order_by(Invoice.id.desc())).all()
        receipts = db.scalars(select(Receipt).where(Receipt.bill_id == b.id).order_by(Receipt.id.desc())).all()
        invoiced_total = sum((Decimal(str(x.total_amount)) for x in invoices), Decimal("0"))
        received_total = sum((Decimal(str(x.amount)) for x in receipts), Decimal("0"))
        outstanding_amount = max(Decimal("0"), Decimal(str(b.amount)) - received_total)
        invoice_status = "已开票" if invoices else "待开票"
        receipt_status = "待回款"
        if received_total >= Decimal(str(b.amount)):
            receipt_status = "已回款"
        elif received_total > 0:
            receipt_status = "部分回款"
        flow_status = calc_bill_flow_status(Decimal(str(b.amount)), b.status, bool(invoices), received_total)
        result.append(
            {
                "id": b.id,
                "bill_type": b.bill_type,
                "period": b.period,
                "target_name": b.target_name,
                "amount": b.amount,
                "status": b.status,
                "version": b.version,
                "collection_status": b.collection_status,
                "lifecycle_status": b.lifecycle_status,
                "invoice_status": invoice_status,
                "receipt_status": receipt_status,
                "flow_status": flow_status,
                "invoiced_total": invoiced_total,
                "received_total": received_total,
                "outstanding_amount": outstanding_amount,
                "latest_receipt_date": str(receipts[0].received_at) if receipts else "",
            }
        )
    return result


@app.get("/billing/{bill_id}")
def get_bill_detail(
    bill_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    b = db.get(Bill, bill_id)
    if not b:
        raise HTTPException(status_code=404, detail="账单不存在")
    invoices = db.scalars(select(Invoice).where(Invoice.bill_id == b.id).order_by(Invoice.id.desc())).all()
    receipts = db.scalars(select(Receipt).where(Receipt.bill_id == b.id).order_by(Receipt.id.desc())).all()
    invoiced_total = sum((Decimal(str(x.total_amount)) for x in invoices), Decimal("0"))
    received_total = sum((Decimal(str(x.amount)) for x in receipts), Decimal("0"))
    outstanding_amount = max(Decimal("0"), Decimal(str(b.amount)) - received_total)
    latest_invoice = invoices[0] if invoices else None
    latest_receipt = receipts[0] if receipts else None
    invoice_status = "已开票" if invoices else "待开票"
    receipt_status = "待回款"
    if received_total >= Decimal(str(b.amount)):
        receipt_status = "已回款"
    elif received_total > 0:
        receipt_status = "部分回款"
    flow_status = calc_bill_flow_status(Decimal(str(b.amount)), b.status, bool(invoices), received_total)
    return {
        "id": b.id,
        "bill_type": b.bill_type,
        "period": b.period,
        "target_name": b.target_name,
        "amount": b.amount,
        "status": b.status,
        "version": b.version,
        "collection_status": b.collection_status,
        "lifecycle_status": b.lifecycle_status,
        "invoice_status": invoice_status,
        "receipt_status": receipt_status,
        "flow_status": flow_status,
        "invoiced_total": invoiced_total,
        "received_total": received_total,
        "outstanding_amount": outstanding_amount,
        "invoice_info": {
            "has_invoice": bool(invoices),
            "invoice_no": latest_invoice.invoice_no if latest_invoice else "",
            "invoice_amount": latest_invoice.total_amount if latest_invoice else Decimal("0"),
            "issue_date": str(latest_invoice.issue_date) if latest_invoice else "",
        },
        "receipt_info": {
            "received_total": received_total,
            "outstanding_amount": outstanding_amount,
            "latest_receipt_date": str(latest_receipt.received_at) if latest_receipt else "",
            "receipt_status": receipt_status,
        },
    }


@app.post("/billing/{bill_id}/discard")
def discard_bill(
    bill_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance])),
):
    bill = db.get(Bill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    if (bill.lifecycle_status or "active") == "discarded":
        return {"bill_id": bill.id, "lifecycle_status": "discarded", "already_discarded": True}

    invoices = db.scalars(select(Invoice).where(Invoice.bill_id == bill.id)).all()
    if invoices:
        raise HTTPException(status_code=400, detail="存在关联发票，禁止作废")
    receipts = db.scalars(select(Receipt).where(Receipt.bill_id == bill.id)).all()
    if receipts:
        raise HTTPException(status_code=400, detail="存在关联回款，禁止作废")
    received_total = sum((Decimal(str(x.amount)) for x in receipts), Decimal("0"))
    if received_total > 0:
        raise HTTPException(status_code=400, detail="已发生回款，禁止作废")

    if bill.status != BillStatus.draft:
        raise HTTPException(status_code=400, detail="仅草稿账单允许作废")
    delivery_count = int(db.scalar(select(func.count(BillDeliveryLog.id)).where(BillDeliveryLog.bill_id == bill.id)) or 0)
    if delivery_count > 0:
        raise HTTPException(status_code=400, detail="存在发送/交付记录，禁止作废")

    outstanding_amount = max(Decimal("0"), Decimal(str(bill.amount)) - received_total)
    if outstanding_amount != Decimal(str(bill.amount)):
        raise HTTPException(status_code=400, detail="存在已回款金额，禁止作废")

    bill.lifecycle_status = "discarded"
    write_system_audit(db, ctx["user"], "discard_bill", "bill", str(bill.id), f"作废账单: {bill.period}/{bill.bill_type}/{bill.target_name}")
    db.commit()
    return {"bill_id": bill.id, "lifecycle_status": bill.lifecycle_status}


@app.post("/billing/cleanup-duplicates")
def cleanup_duplicate_bills(
    payload: CleanupDuplicateBillsIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin])),
):
    rows = db.scalars(select(Bill).order_by(Bill.created_at.asc(), Bill.id.asc())).all()
    grouped: dict[tuple[str, BillType, str], list[Bill]] = {}
    for row in rows:
        key = (row.period, row.bill_type, row.target_name)
        grouped.setdefault(key, []).append(row)
    duplicate_groups = {k: v for k, v in grouped.items() if len(v) > 1}
    deleted_ids: list[int] = []
    kept_groups: list[dict] = []
    skipped: list[dict] = []

    def can_delete_safely(bill: Bill) -> tuple[bool, str]:
        # 仅清理：草稿 + 未回款 + 无下游依赖
        if bill.status != BillStatus.draft:
            return False, f"账单状态非草稿({bill.status.value})"
        if bill.collection_status != CollectionStatus.pending:
            return False, f"回款状态非待回款({bill.collection_status.value})"
        invoice_count = int(db.scalar(select(func.count(Invoice.id)).where(Invoice.bill_id == bill.id)) or 0)
        if invoice_count > 0:
            return False, "存在关联发票"
        receipt_count = int(db.scalar(select(func.count(Receipt.id)).where(Receipt.bill_id == bill.id)) or 0)
        if receipt_count > 0:
            return False, "存在关联回款"
        delivery_count = int(db.scalar(select(func.count(BillDeliveryLog.id)).where(BillDeliveryLog.bill_id == bill.id)) or 0)
        if delivery_count > 0:
            return False, "存在发送/交付记录"
        audit_count = int(
            db.scalar(
                select(func.count(SystemAuditLog.id)).where(
                    SystemAuditLog.target_type == "bill",
                    SystemAuditLog.target_id == str(bill.id),
                )
            )
            or 0
        )
        if audit_count > 0:
            return False, "存在账单审计依赖"
        return True, ""

    for (period, bill_type, target_name), bills in duplicate_groups.items():
        sorted_bills = sorted(bills, key=lambda x: (x.created_at or dt.datetime.min, x.id))
        keep = sorted_bills[0]
        kept_groups.append(
            {
                "period": period,
                "bill_type": bill_type.value if isinstance(bill_type, BillType) else str(bill_type),
                "target_name": target_name,
                "keep_id": keep.id,
                "group_size": len(sorted_bills),
            }
        )
        for candidate in sorted_bills[1:]:
            ok, reason = can_delete_safely(candidate)
            if not ok:
                skipped.append(
                    {
                        "bill_id": candidate.id,
                        "period": period,
                        "bill_type": bill_type.value if isinstance(bill_type, BillType) else str(bill_type),
                        "target_name": target_name,
                        "reason": reason,
                    }
                )
                continue
            deleted_ids.append(candidate.id)
            if not payload.dry_run:
                db.delete(candidate)

    write_system_audit(
        db,
        ctx["user"],
        "cleanup_duplicate_bills",
        "bill",
        "",
        f"重复账单清理 dry_run={payload.dry_run}: 删除候选{len(deleted_ids)}, 分组{len(kept_groups)}, 跳过{len(skipped)}",
    )
    if not payload.dry_run:
        db.commit()
    else:
        db.rollback()
    return {
        "dry_run": payload.dry_run,
        "duplicate_group_count": len(kept_groups),
        "kept_group_count": len(kept_groups),
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "kept_groups": kept_groups,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }


@app.post("/billing/{bill_id}/send")
def send_bill(bill_id: int, payload: BillStatusIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
    bill = db.get(Bill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    if (bill.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="已作废账单不可发送/确认")
    bill.status = payload.status
    if payload.status in (BillStatus.sent, BillStatus.acknowledged, BillStatus.disputed):
        db.add(BillDeliveryLog(bill_id=bill_id, note=payload.note))
    write_system_audit(db, _["user"], "send_bill", "bill", str(bill_id), f"账单状态更新为: {payload.status}")
    db.commit()
    return {"bill_id": bill_id, "status": bill.status}


@app.post("/invoices")
def create_invoice(payload: InvoiceIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    bill = db.get(Bill, payload.bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    if (bill.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="已作废账单不可开票")
    invoice = Invoice(
        invoice_no=payload.invoice_no,
        bill_id=payload.bill_id,
        issue_date=payload.issue_date,
        amount_without_tax=payload.amount_without_tax,
        tax_amount=payload.tax_amount,
        total_amount=payload.total_amount,
        status=payload.status,
    )
    db.add(invoice)
    db.flush()
    db.add(InvoiceMeta(invoice_id=invoice.id, remark=payload.remark))
    write_system_audit(db, _["user"], "create_invoice", "invoice", str(invoice.id), f"新增发票: {payload.invoice_no}")
    db.commit()
    return {"id": invoice.id, "invoice_no": invoice.invoice_no}


@app.get("/invoices")
def list_invoices(
    status: Optional[str] = None,
    period: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz])),
):
    rows = db.scalars(select(Invoice).order_by(Invoice.id.desc())).all()
    result = []
    for x in rows:
        bill = db.get(Bill, x.bill_id)
        meta = db.scalar(select(InvoiceMeta).where(InvoiceMeta.invoice_id == x.id))
        item = {
            "id": x.id,
            "invoice_no": x.invoice_no,
            "bill_id": x.bill_id,
            "issue_date": x.issue_date,
            "total_amount": x.total_amount,
            "status": x.status,
            "target_name": bill.target_name if bill else "",
            "period": bill.period if bill else "",
            "created_at": str(meta.created_at if meta else x.issue_date),
            "remark": meta.remark if meta else "",
        }
        result.append(item)
    if status:
        result = [x for x in result if str(x["status"]) == status]
    if period:
        result = [x for x in result if period in str(x["period"])]
    if keyword:
        result = [x for x in result if keyword in f'{x["invoice_no"]}{x["bill_id"]}{x["target_name"]}']
    return result


@app.put("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, payload: InvoiceIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    row = db.get(Invoice, invoice_id)
    if not row:
        raise HTTPException(status_code=404, detail="发票不存在")
    row.invoice_no = payload.invoice_no
    row.bill_id = payload.bill_id
    row.issue_date = payload.issue_date
    row.amount_without_tax = payload.amount_without_tax
    row.tax_amount = payload.tax_amount
    row.total_amount = payload.total_amount
    row.status = payload.status
    meta = db.scalar(select(InvoiceMeta).where(InvoiceMeta.invoice_id == row.id))
    if meta:
        meta.remark = payload.remark
    else:
        db.add(InvoiceMeta(invoice_id=row.id, remark=payload.remark))
    write_system_audit(db, _["user"], "update_invoice", "invoice", str(row.id), f"编辑发票: {payload.invoice_no}")
    db.commit()
    return {"id": row.id, "status": row.status}


@app.post("/receipts")
def register_receipt(payload: ReceiptIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    bill = db.get(Bill, payload.bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    if (bill.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="已作废账单不可回款")
    receipt = Receipt(
        bill_id=payload.bill_id,
        received_at=payload.received_at,
        amount=payload.amount,
        bank_ref=payload.bank_ref,
        account_name=payload.account_name,
    )
    db.add(receipt)
    db.flush()
    db.add(ReceiptMeta(receipt_id=receipt.id, remark=payload.remark))
    received_total = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == payload.bill_id))
    if received_total >= bill.amount:
        bill.collection_status = CollectionStatus.paid
    elif received_total > 0:
        bill.collection_status = CollectionStatus.partial
    else:
        bill.collection_status = CollectionStatus.pending
    write_system_audit(db, _["user"], "create_receipt", "receipt", str(receipt.id), f"新增回款: bill={payload.bill_id}")
    db.commit()
    return {"receipt_id": receipt.id, "collection_status": bill.collection_status}


@app.get("/receipts")
def list_receipts(
    status: Optional[str] = None,
    period: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz])),
):
    rows = db.scalars(select(Receipt).order_by(Receipt.id.desc())).all()
    result = []
    for x in rows:
        bill = db.get(Bill, x.bill_id)
        meta = db.scalar(select(ReceiptMeta).where(ReceiptMeta.receipt_id == x.id))
        bill_total = Decimal(str(bill.amount)) if bill else Decimal("0")
        received_total = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == x.bill_id)) if bill else Decimal("0")
        item = {
            "id": x.id,
            "bill_id": x.bill_id,
            "received_at": x.received_at,
            "amount": x.amount,
            "bank_ref": x.bank_ref,
            "account_name": x.account_name,
            "target_name": bill.target_name if bill else "",
            "period": bill.period if bill else "",
            "status": bill.collection_status if bill else "",
            "outstanding_amount": max(Decimal("0"), bill_total - Decimal(str(received_total))),
            "remark": meta.remark if meta else "",
            "created_at": str(meta.created_at if meta else x.received_at),
        }
        result.append(item)
    if status:
        result = [x for x in result if str(x["status"]) == status]
    if period:
        result = [x for x in result if period in str(x["period"])]
    if keyword:
        result = [x for x in result if keyword in f'{x["bill_id"]}{x["target_name"]}{x["bank_ref"]}']
    return result


@app.put("/receipts/{receipt_id}")
def update_receipt(receipt_id: int, payload: ReceiptIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    row = db.get(Receipt, receipt_id)
    if not row:
        raise HTTPException(status_code=404, detail="回款不存在")
    row.bill_id = payload.bill_id
    row.received_at = payload.received_at
    row.amount = payload.amount
    row.bank_ref = payload.bank_ref
    row.account_name = payload.account_name
    meta = db.scalar(select(ReceiptMeta).where(ReceiptMeta.receipt_id == row.id))
    if meta:
        meta.remark = payload.remark
    else:
        db.add(ReceiptMeta(receipt_id=row.id, remark=payload.remark))
    if payload.status:
        bill = db.get(Bill, row.bill_id)
        if bill:
            bill.collection_status = payload.status
    write_system_audit(db, _["user"], "update_receipt", "receipt", str(row.id), f"编辑回款: bill={row.bill_id}")
    db.commit()
    return {"id": row.id}


def _filter_import_history_rows(
    db: Session,
    rows: list[ImportHistory],
    period: Optional[str],
    import_type: Optional[str],
    status: Optional[str],
    keyword: Optional[str],
    task_status: Optional[str] = None,
    lifecycle_status: Optional[str] = "active",
) -> list[ImportHistory]:
    out = list(rows)
    if lifecycle_status in {"active", "discarded"}:
        out = [x for x in out if (x.lifecycle_status or "active") == lifecycle_status]
    if period:
        out = [x for x in out if period in x.period]
    if import_type:
        out = [x for x in out if x.import_type == import_type]
    if status:
        out = [x for x in out if status in x.status]
    if keyword:
        kw = keyword.strip()
        if kw:
            out = [x for x in out if kw in f"{x.file_name}{x.summary}{x.created_by}{x.period}{x.task_id}"]
    if task_status:
        out = [x for x in out if _recon_task_status_str(db, x.task_id) == task_status]
    return out


def _recon_task_status_str(db: Session, task_id: int) -> str:
    task = db.get(ReconTask, task_id)
    if not task:
        return ""
    st = task.status
    return st.value if isinstance(st, ReconStatus) else str(st)


@app.get("/imports/history")
def list_import_history(
    period: Optional[str] = None,
    import_type: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    task_status: Optional[str] = None,
    lifecycle_status: Optional[str] = "active",
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    rows = db.scalars(select(ImportHistory).order_by(ImportHistory.id.desc())).all()
    filtered = _filter_import_history_rows(db, rows, period, import_type, status, keyword, task_status, lifecycle_status)
    total = len(filtered)
    amt = Decimal("0")
    matched_v = 0
    unmatched_v = 0
    for x in filtered:
        amt += Decimal(str(x.amount_sum or 0))
        matched_v += int(x.matched_variant_count or 0)
        unmatched_v += int(x.unmatched_variant_count or 0)
    summary = {
        "batch_count": total,
        "total_import_rows": sum(int(x.total_count or 0) for x in filtered),
        "valid_rows": sum(int(x.valid_count or 0) for x in filtered),
        "invalid_rows": sum(int(x.invalid_count or 0) for x in filtered),
        "amount_sum": str(amt),
        "matched_variant_rows": matched_v,
        "unmatched_variant_rows": unmatched_v,
    }
    start = (max(page, 1) - 1) * max(page_size, 1)
    end = start + max(page_size, 1)
    page_rows = filtered[start:end]
    items = []
    for x in page_rows:
        payload = ImportHistoryOut.model_validate(x).model_dump()
        payload["task_status"] = _recon_task_status_str(db, x.task_id)
        items.append(payload)
    return {"items": items, "total": total, "page": page, "page_size": page_size, "summary": summary}


@app.get("/imports/history/{history_id}", response_model=ImportHistoryOut)
def get_import_history(history_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    row = db.get(ImportHistory, history_id)
    if not row:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    unresolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == row.task_id, ReconIssue.resolved.is_(False)))
    resolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == row.task_id, ReconIssue.resolved.is_(True)))
    payload = ImportHistoryOut.model_validate(row)
    payload.unresolved_issue_count = int(unresolved or 0)
    payload.resolved_issue_count = int(resolved or 0)
    payload.task_status = _recon_task_status_str(db, row.task_id)
    return payload


@app.get("/imports/history/{history_id}/issues")
def get_import_history_issues(history_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    rows = db.scalars(select(ReconIssue).where(ReconIssue.recon_task_id == history.task_id).order_by(ReconIssue.id.desc())).all()
    result = []
    for x in rows:
        meta = db.scalar(select(ReconIssueMeta).where(ReconIssueMeta.issue_id == x.id))
        latest_timeline = db.scalar(select(ReconIssueTimeline).where(ReconIssueTimeline.issue_id == x.id).order_by(ReconIssueTimeline.id.desc()).limit(1))
        result.append(
            {
                "issue_id": x.id,
                "task_id": x.recon_task_id,
                "issue_type": x.issue_type,
                "message": x.detail,
                "status": "已处理" if x.resolved else "未处理",
                "row_no": None,
                "raw_data": None,
                "created_at": "",
                "remark": meta.remark if meta else "",
                "updated_at": str(meta.updated_at) if meta else "",
                "latest_operator": latest_timeline.operator if latest_timeline else "",
                "latest_updated_at": str(latest_timeline.created_at) if latest_timeline else "",
            }
        )
    return result


@app.get("/imports/history/{history_id}/unmatched-variants")
def get_import_history_unmatched_variants(
    history_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    stmt = (
        select(
            RawStatement.game_name,
            func.count(RawStatement.id).label("cnt"),
            func.max(RawStatement.period).label("latest_period"),
        )
        .where(
            RawStatement.recon_task_id == history.task_id,
            RawStatement.variant_match_status == "未匹配版本",
        )
        .group_by(RawStatement.game_name)
        .order_by(RawStatement.game_name.asc())
    )
    rows = db.execute(stmt).mappings().all()
    return [
        {
            "game_name": row["game_name"],
            "count": int(row["cnt"]),
            "period": row["latest_period"] or history.period,
        }
        for row in rows
    ]


@app.get("/imports/history/{history_id}/batch-stats")
def get_import_history_batch_stats(
    history_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    task_id = history.task_id
    channel_names_db = set(db.scalars(select(Channel.name)).all())
    game_names_db = set(db.scalars(select(Game.name)).all())
    raw_rows = db.scalars(select(RawStatement).where(RawStatement.recon_task_id == task_id)).all()

    ch_agg: dict[str, dict] = {}
    game_agg: dict[str, dict] = {}
    for r in raw_rows:
        ch = r.channel_name or ""
        gm = r.game_name or ""
        ga = Decimal(str(r.gross_amount or 0))
        if ch not in ch_agg:
            ch_agg[ch] = {"row_count": 0, "gross_amount": Decimal("0")}
        ch_agg[ch]["row_count"] += 1
        ch_agg[ch]["gross_amount"] += ga
        if gm not in game_agg:
            game_agg[gm] = {"row_count": 0, "gross_amount": Decimal("0")}
        game_agg[gm]["row_count"] += 1
        game_agg[gm]["gross_amount"] += ga

    by_channel = [
        {"channel_name": k, "row_count": v["row_count"], "gross_amount": str(v["gross_amount"])}
        for k, v in sorted(ch_agg.items(), key=lambda x: x[0])
    ]
    by_game = [
        {"game_name": k, "row_count": v["row_count"], "gross_amount": str(v["gross_amount"])}
        for k, v in sorted(game_agg.items(), key=lambda x: x[0])
    ]

    unmatched_channels = sorted({r.channel_name for r in raw_rows if r.channel_name and r.channel_name not in channel_names_db})
    unmatched_games = sorted({r.game_name for r in raw_rows if r.game_name and r.game_name not in game_names_db})
    mapping_issues = db.scalars(
        select(ReconIssue).where(ReconIssue.recon_task_id == task_id, ReconIssue.issue_type == "mapping").order_by(ReconIssue.id.asc())
    ).all()
    unmapped_pairs = [x.detail for x in mapping_issues]
    variant_stmt = (
        select(
            RawStatement.game_name,
            func.count(RawStatement.id).label("cnt"),
        )
        .where(RawStatement.recon_task_id == task_id, RawStatement.variant_match_status == "未匹配版本")
        .group_by(RawStatement.game_name)
        .order_by(RawStatement.game_name.asc())
    )
    variant_rows = db.execute(variant_stmt).mappings().all()
    variant_unmatched = [{"game_name": row["game_name"], "count": int(row["cnt"])} for row in variant_rows]

    return {
        "by_channel": by_channel,
        "by_game": by_game,
        "unique_channel_count": len(ch_agg),
        "unique_game_count": len(game_agg),
        "exceptions": {
            "unmatched_channels": unmatched_channels,
            "unmatched_games": unmatched_games,
            "unmapped_pairs": unmapped_pairs,
            "variant_unmatched": variant_unmatched,
        },
    }


@app.get("/imports/history/{history_id}/raw-rows")
def get_import_history_raw_rows(
    history_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    rows = db.scalars(select(RawStatement).where(RawStatement.recon_task_id == history.task_id).order_by(RawStatement.id.asc())).all()
    return [
        {
            "id": r.id,
            "channel_name": r.channel_name,
            "game_name": r.game_name,
            "period": r.period,
            "gross_amount": str(r.gross_amount),
            "channel_id": r.channel_id,
            "game_id": r.game_id,
            "mapping_id": r.mapping_id,
            "channel_share_percent": str(r.channel_share_percent) if r.channel_share_percent is not None else "",
            "rd_share_percent": str(r.rd_share_percent) if r.rd_share_percent is not None else "",
            "publish_share_percent": str(r.publish_share_percent) if r.publish_share_percent is not None else "",
            "match_status": r.match_status,
            "variant_match_status": r.variant_match_status,
            "project_name": r.project_name or "",
            "variant_name": r.variant_name or "",
        }
        for r in rows
    ]


@app.post("/imports/history/{history_id}/recompute")
def recompute_import_history(
    history_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    if (history.lifecycle_status or "active") == "discarded":
        raise HTTPException(status_code=400, detail="已作废批次不支持重新计算")
    task = db.get(ReconTask, history.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="导入任务不存在")

    rows = db.scalars(select(RawStatement).where(RawStatement.recon_task_id == task.id).order_by(RawStatement.id.asc())).all()
    channels = {x.name: x for x in db.scalars(select(Channel)).all()}
    games = {x.name: x for x in db.scalars(select(Game)).all()}
    variants = {x.raw_game_name: x for x in db.scalars(select(GameVariant)).all()}
    projects = {x.id: x for x in db.scalars(select(Project)).all()}
    maps = {(x.channel_id, x.game_id): x for x in db.scalars(select(ChannelGameMap)).all()}

    old_issues = db.scalars(select(ReconIssue).where(ReconIssue.recon_task_id == task.id)).all()
    for issue in old_issues:
        meta = db.scalar(select(ReconIssueMeta).where(ReconIssueMeta.issue_id == issue.id))
        if meta:
            db.delete(meta)
        timelines = db.scalars(select(ReconIssueTimeline).where(ReconIssueTimeline.issue_id == issue.id)).all()
        for tl in timelines:
            db.delete(tl)
        db.delete(issue)

    total = len(rows)
    matched = 0
    unmatched = 0
    matched_variant_count = 0
    unmatched_variant_count = 0
    issue_count = 0
    amount_sum = Decimal("0")
    new_issues: list[ReconIssue] = []

    for row in rows:
        amount_sum += Decimal(str(row.gross_amount or 0))
        channel_name = (row.channel_name or "").strip()
        game_name = (row.game_name or "").strip()
        channel = channels.get(channel_name)
        game = games.get(game_name)
        mapping = maps.get((channel.id, game.id)) if channel and game else None

        row.channel_id = channel.id if channel else None
        row.game_id = game.id if game else None
        row.mapping_id = mapping.id if mapping else None

        rd_share = Decimal(str(game.rd_share_percent if game and game.rd_share_percent is not None else 0))
        channel_share = (
            Decimal(str(mapping.revenue_share_ratio or 0)) * Decimal("100")
            if mapping and mapping.revenue_share_ratio is not None
            else None
        )
        row.rd_share_percent = rd_share if game else None
        row.channel_share_percent = channel_share
        row.publish_share_percent = (
            max(Decimal("0"), Decimal("100") - rd_share - channel_share) if channel_share is not None and game else None
        )

        row_issue = False
        if not channel:
            row_issue = True
            new_issues.append(ReconIssue(recon_task_id=task.id, issue_type="unmatched_channel", detail=f"未匹配渠道: {channel_name}"))
        if not game:
            row_issue = True
            new_issues.append(ReconIssue(recon_task_id=task.id, issue_type="unmatched_game", detail=f"未匹配游戏: {game_name}"))
        if channel and game and not mapping:
            row_issue = True
            new_issues.append(
                ReconIssue(recon_task_id=task.id, issue_type="unmapped_pair", detail=f"未映射组合: {channel_name}/{game_name}")
            )

        variant = variants.get(game_name)
        matched_project = projects.get(variant.project_id) if variant else None
        if variant:
            matched_variant_count += 1
            row.variant_id = variant.id
            row.variant_name = variant.variant_name
            row.project_id = matched_project.id if matched_project else None
            row.project_name = matched_project.name if matched_project else None
            row.rd_company = variant.rd_company
            row.variant_match_status = "已匹配版本"
        else:
            unmatched_variant_count += 1
            row.variant_id = None
            row.variant_name = None
            row.project_id = None
            row.project_name = None
            row.rd_company = None
            row.variant_match_status = "未匹配版本"
            row_issue = True
            new_issues.append(ReconIssue(recon_task_id=task.id, issue_type="variant_unmatched", detail=f"版本未匹配: {game_name}"))

        if row_issue:
            row.match_status = "未匹配"
            unmatched += 1
        else:
            row.match_status = "已匹配"
            matched += 1

    for issue in new_issues:
        db.add(issue)
    issue_count = len(new_issues)

    task.status = ReconStatus.issue if issue_count > 0 else ReconStatus.pending
    history.total_count = total
    history.valid_count = matched
    history.invalid_count = unmatched
    history.matched_variant_count = matched_variant_count
    history.unmatched_variant_count = unmatched_variant_count
    history.amount_sum = amount_sum
    history.status = "异常待处理" if issue_count > 0 else "待确认"
    history.summary = f"总行数:{total}, 正常:{matched}, 异常:{unmatched}, 流水合计:{amount_sum}"

    write_system_audit(
        db,
        ctx["user"],
        "recompute_import_history",
        "import_history",
        str(history.id),
        f"重算批次: total={total}, matched={matched}, unmatched={unmatched}, issues={issue_count}",
    )
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"重算失败: {str(e)}")

    return {"total": total, "matched": matched, "unmatched": unmatched, "issues": issue_count}


@app.post("/imports/history/{history_id}/discard")
def discard_import_history(
    history_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    if (history.lifecycle_status or "active") == "discarded":
        return {"id": history.id, "lifecycle_status": "discarded", "already_discarded": True}
    task = db.get(ReconTask, history.task_id)
    if task and task.status == ReconStatus.confirmed:
        raise HTTPException(status_code=400, detail="已确认入账的批次不可作废")
    history.lifecycle_status = "discarded"
    history.status = "已作废"
    write_system_audit(
        db,
        ctx["user"],
        "discard_import_history",
        "import_history",
        str(history.id),
        f"作废导入批次: task_id={history.task_id}",
    )
    db.commit()
    return {"id": history.id, "lifecycle_status": "discarded"}


@app.post("/imports/history/{history_id}/rematch-variants")
def rematch_import_history_variants(
    history_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    history = db.get(ImportHistory, history_id)
    if not history:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    variants = {x.raw_game_name: x for x in db.scalars(select(GameVariant)).all()}
    projects = {x.id: x for x in db.scalars(select(Project)).all()}
    rows = db.scalars(select(RawStatement).where(RawStatement.recon_task_id == history.task_id)).all()
    rematched_count = 0
    matched_count = 0
    unmatched_count = 0
    for row in rows:
        matched_variant = variants.get(row.game_name)
        matched_project = projects.get(matched_variant.project_id) if matched_variant else None
        prev_unmatched = row.variant_match_status == "未匹配版本"
        if matched_variant:
            row.project_id = matched_project.id if matched_project else None
            row.project_name = matched_project.name if matched_project else None
            row.variant_id = matched_variant.id
            row.variant_name = matched_variant.variant_name
            row.rd_company = matched_variant.rd_company
            row.publish_company = matched_variant.publish_company
            row.rd_share_percent = matched_variant.rd_share_percent
            row.publish_share_percent = matched_variant.publish_share_percent
            row.variant_match_status = "已匹配版本"
            matched_count += 1
            if prev_unmatched:
                rematched_count += 1
        else:
            row.project_id = None
            row.project_name = None
            row.variant_id = None
            row.variant_name = None
            row.rd_company = None
            row.publish_company = None
            row.rd_share_percent = None
            row.publish_share_percent = None
            row.variant_match_status = "未匹配版本"
            unmatched_count += 1
    history.matched_variant_count = matched_count
    history.unmatched_variant_count = unmatched_count
    write_system_audit(
        db,
        ctx["user"],
        "rematch_variants_for_import_history",
        "import_history",
        str(history.id),
        f"重新匹配版本: rematched={rematched_count}, remaining_unmatched={unmatched_count}",
    )
    db.commit()
    return {"rematched_count": rematched_count, "remaining_unmatched_count": unmatched_count}


@app.get("/dashboard/finance")
def finance_dashboard(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.ops_manager, Role.tech]))):
    total_receivable = db.scalar(select(func.coalesce(func.sum(Bill.amount), 0)))
    total_received = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)))
    total_invoiced = db.scalar(select(func.coalesce(func.sum(Invoice.total_amount), 0)))
    pending_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.pending))
    partial_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.partial))
    paid_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.paid))
    outstanding = Decimal(str(total_receivable)) - Decimal(str(total_received))
    current_period = dt.date.today().strftime("%Y-%m")
    overdue_amount = db.scalar(
        select(func.coalesce(func.sum(Bill.amount), 0)).where(Bill.collection_status != CollectionStatus.paid, Bill.period < current_period)
    )
    recent_period_rows = db.scalars(select(Bill).order_by(Bill.period.desc(), Bill.id.desc()).limit(300)).all()
    period_map: dict[str, dict[str, Decimal]] = {}
    for b in recent_period_rows:
        if b.period not in period_map:
            period_map[b.period] = {"receivable": Decimal("0"), "received": Decimal("0"), "count": Decimal("0")}
        period_map[b.period]["receivable"] += Decimal(str(b.amount))
        period_map[b.period]["count"] += Decimal("1")
        rec_sum = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == b.id))
        period_map[b.period]["received"] += Decimal(str(rec_sum))
    recent_period_summary = []
    for period_key in sorted(period_map.keys(), reverse=True)[:6]:
        item = period_map[period_key]
        recent_period_summary.append(
            {
                "period": period_key,
                "bill_count": int(item["count"]),
                "receivable": item["receivable"],
                "received": item["received"],
                "outstanding": max(Decimal("0"), item["receivable"] - item["received"]),
            }
        )
    pending_bills = db.scalars(select(Bill).where(Bill.collection_status != CollectionStatus.paid).order_by(Bill.id.desc()).limit(20)).all()
    pending_list = []
    flow_status_breakdown = {"草稿": 0, "已生成": 0, "已发送": 0, "已开票": 0, "部分回款": 0, "已回款": 0}
    all_bills = db.scalars(select(Bill)).all()
    for b in all_bills:
        inv_count = db.scalar(select(func.count(Invoice.id)).where(Invoice.bill_id == b.id))
        rec_sum = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == b.id))
        flow_status = calc_bill_flow_status(Decimal(str(b.amount)), b.status, bool(inv_count), Decimal(str(rec_sum)))
        flow_status_breakdown[flow_status] = flow_status_breakdown.get(flow_status, 0) + 1
    for b in pending_bills:
        rec_sum = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == b.id))
        rec_total = Decimal(str(rec_sum))
        pending_list.append(
            {
                "bill_id": b.id,
                "period": b.period,
                "target_name": b.target_name,
                "bill_type": b.bill_type,
                "amount": b.amount,
                "received_total": rec_total,
                "outstanding_amount": max(Decimal("0"), Decimal(str(b.amount)) - rec_total),
                "receipt_status": "部分回款" if rec_total > 0 else "待回款",
                "flow_status": calc_bill_flow_status(Decimal(str(b.amount)), b.status, False, rec_total),
            }
        )
    return {
        "total_receivable": total_receivable,
        "total_invoiced": total_invoiced,
        "total_received": total_received,
        "outstanding": outstanding,
        "overdue_amount": overdue_amount,
        "status_breakdown": {"待回款": pending_count, "部分回款": partial_count, "已回款": paid_count},
        "flow_status_breakdown": flow_status_breakdown,
        "recent_period_summary": recent_period_summary,
        "pending_bills": pending_list,
    }


def _parse_dashboard_range(range_text: str) -> int:
    mapping = {"7d": 7, "30d": 30}
    if range_text not in mapping:
        raise HTTPException(status_code=400, detail="range 仅支持 7d 或 30d")
    return mapping[range_text]


def _safe_ratio_change(current: Decimal, previous: Decimal) -> float:
    if previous == 0:
        return 0.0 if current == 0 else 100.0
    return float(((current - previous) / previous) * Decimal("100"))


def _exception_status_text(status: ExceptionHandleStatus) -> str:
    if status == ExceptionHandleStatus.ignored:
        return "已忽略"
    if status == ExceptionHandleStatus.resolved:
        return "已解决"
    return "待处理"


def _collect_exception_data(
    db: Session,
    days: int,
    status_filter: str = "all",
    type_filter: str = "all",
):
    valid_types = {"share", "channel", "game", "import", "overdue"}
    if type_filter not in {"all", *valid_types}:
        raise HTTPException(status_code=400, detail="type 参数非法")
    if status_filter not in {"all", "pending", "ignored", "resolved"}:
        raise HTTPException(status_code=400, detail="status 参数非法")

    cutoff_dt = dt.datetime.combine(dt.date.today() - dt.timedelta(days=days - 1), dt.time.min)
    channels = set(db.scalars(select(Channel.name)).all())
    active_variants = {x.raw_game_name for x in db.scalars(select(GameVariant.raw_game_name).where(GameVariant.status == VariantStatus.active)).all()}

    status_rows = db.scalars(select(ExceptionHandleRecord)).all()
    status_map = {(x.exception_type, x.exception_id): x for x in status_rows}

    def status_for(exception_type: str, exception_id: str) -> ExceptionHandleStatus:
        row = status_map.get((exception_type, exception_id))
        return row.status if row else ExceptionHandleStatus.pending

    def allow(exception_type: str, exception_id: str) -> bool:
        if type_filter != "all" and exception_type != type_filter:
            return False
        if status_filter == "all":
            return True
        return status_for(exception_type, exception_id).value == status_filter

    items: dict[str, list[dict]] = {"share": [], "channel": [], "game": [], "import": [], "overdue": []}

    map_rows = db.scalars(select(ChannelGameMap)).all()
    for row in map_rows:
        total_ratio = Decimal(str(row.revenue_share_ratio or 0)) + Decimal(str(row.rd_settlement_ratio or 0))
        if not (total_ratio > Decimal("1.0001") or total_ratio < Decimal("0.9999")):
            continue
        exception_id = f"share-{row.id}"
        if not allow("share", exception_id):
            continue
        channel_share = Decimal(str(row.revenue_share_ratio or 0))
        rd_share = Decimal(str(row.rd_settlement_ratio or 0))
        tax_rate = Decimal("0")
        private_share = Decimal("0")
        publisher_share = Decimal("1") - channel_share - rd_share - tax_rate - private_share
        items["share"].append(
            {
                "id": exception_id,
                "type": "share",
                "status": status_for("share", exception_id).value,
                "detected_at": dt.datetime.now().isoformat(),
                "updated_at": (status_map.get(("share", exception_id)).updated_at.isoformat() if status_map.get(("share", exception_id)) else None),
                "source_module": "channel_game_map",
                "channel_name": row.channel.name,
                "game_name": row.game.name,
                "channel_share": channel_share,
                "tax_rate": tax_rate,
                "rd_share": rd_share,
                "private_share": private_share,
                "publisher_share": publisher_share,
                "total_ratio": total_ratio,
                "status_text": _exception_status_text(status_for("share", exception_id)),
            }
        )

    raw_rows = db.scalars(select(RawStatement).where(RawStatement.created_at >= cutoff_dt)).all()
    for row in raw_rows:
        if row.channel_name not in channels:
            exception_id = f"channel-{row.id}"
            if allow("channel", exception_id):
                history = db.scalar(select(ImportHistory).where(ImportHistory.task_id == row.recon_task_id))
                items["channel"].append(
                    {
                        "id": exception_id,
                        "type": "channel",
                        "status": status_for("channel", exception_id).value,
                        "detected_at": row.created_at.isoformat() if row.created_at else dt.datetime.now().isoformat(),
                        "updated_at": (status_map.get(("channel", exception_id)).updated_at.isoformat() if status_map.get(("channel", exception_id)) else None),
                        "source_module": "import",
                        "import_history_id": history.id if history else None,
                        "batch_name": history.file_name if history else f"task-{row.recon_task_id}",
                        "raw_channel_name": row.channel_name,
                        "match_status": "未匹配渠道",
                        "status_text": _exception_status_text(status_for("channel", exception_id)),
                    }
                )
        if row.game_name not in active_variants:
            exception_id = f"game-{row.id}"
            if allow("game", exception_id):
                history = db.scalar(select(ImportHistory).where(ImportHistory.task_id == row.recon_task_id))
                items["game"].append(
                    {
                        "id": exception_id,
                        "type": "game",
                        "status": status_for("game", exception_id).value,
                        "detected_at": row.created_at.isoformat() if row.created_at else dt.datetime.now().isoformat(),
                        "updated_at": (status_map.get(("game", exception_id)).updated_at.isoformat() if status_map.get(("game", exception_id)) else None),
                        "source_module": "import",
                        "import_history_id": history.id if history else None,
                        "batch_name": history.file_name if history else f"task-{row.recon_task_id}",
                        "raw_game_name": row.game_name,
                        "match_status": "未匹配游戏",
                        "status_text": _exception_status_text(status_for("game", exception_id)),
                    }
                )

    import_rows = db.scalars(
        select(ImportHistory).where(
            ImportHistory.created_at >= cutoff_dt,
            (ImportHistory.invalid_count > 0) | (ImportHistory.status.like("%失败%")),
        )
    ).all()
    for row in import_rows:
        exception_id = f"import-{row.id}"
        if not allow("import", exception_id):
            continue
        fail_reason = f"异常行{row.invalid_count}条，状态={row.status}"
        items["import"].append(
            {
                "id": exception_id,
                "type": "import",
                "status": status_for("import", exception_id).value,
                "detected_at": row.created_at.isoformat() if row.created_at else dt.datetime.now().isoformat(),
                "updated_at": (status_map.get(("import", exception_id)).updated_at.isoformat() if status_map.get(("import", exception_id)) else None),
                "source_module": "import_history",
                "import_history_id": row.id,
                "batch_name": row.file_name or f"history-{row.id}",
                "fail_reason": fail_reason,
                "invalid_count": int(row.invalid_count or 0),
                "status_text": _exception_status_text(status_for("import", exception_id)),
            }
        )

    current_period = dt.date.today().strftime("%Y-%m")
    overdue_rows = db.scalars(
        select(Bill).where(
            Bill.collection_status != CollectionStatus.paid,
            Bill.period < current_period,
        )
    ).all()
    for row in overdue_rows:
        exception_id = f"overdue-{row.id}"
        if not allow("overdue", exception_id):
            continue
        period_date = dt.datetime.strptime(f"{row.period}-01", "%Y-%m-%d").date() if len(row.period) == 7 else dt.date.today()
        overdue_days = max(0, (dt.date.today() - period_date).days)
        items["overdue"].append(
            {
                "id": exception_id,
                "type": "overdue",
                "status": status_for("overdue", exception_id).value,
                "detected_at": row.created_at.isoformat() if row.created_at else dt.datetime.now().isoformat(),
                "updated_at": (status_map.get(("overdue", exception_id)).updated_at.isoformat() if status_map.get(("overdue", exception_id)) else None),
                "source_module": "billing",
                "channel_name": row.target_name if row.bill_type == BillType.channel else "",
                "game_name": "",
                "period": row.period,
                "bill_amount": row.amount,
                "overdue_days": overdue_days,
                "status_text": _exception_status_text(status_for("overdue", exception_id)),
            }
        )

    summary = {
        "share": len(items["share"]),
        "channel": len(items["channel"]),
        "game": len(items["game"]),
        "import": len(items["import"]),
        "overdue": len(items["overdue"]),
    }
    summary["total"] = summary["share"] + summary["channel"] + summary["game"] + summary["import"] + summary["overdue"]
    return {"summary": summary, "items": items}


@app.get("/dashboard/overview")
def dashboard_overview(
    range: str = Query(default="7d"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.ops_manager, Role.tech])),
):
    days = _parse_dashboard_range(range)
    today = dt.date.today()
    month_start = today.replace(day=1)
    prev_month_end = month_start - dt.timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)
    current_period = today.strftime("%Y-%m")
    prev_period = prev_month_start.strftime("%Y-%m")

    # 口径：本月总流水 = raw_statements 在当前自然月账期(period=YYYY-MM)的 gross_amount 汇总
    monthly_gross_revenue = Decimal(
        str(db.scalar(select(func.coalesce(func.sum(RawStatement.gross_amount), 0)).where(RawStatement.period == current_period)) or 0)
    )
    previous_month_gross_revenue = Decimal(
        str(db.scalar(select(func.coalesce(func.sum(RawStatement.gross_amount), 0)).where(RawStatement.period == prev_period)) or 0)
    )

    # 口径：本月渠道回款 = Receipt 关联 Bill(period=当前月) 的实际回款金额汇总
    monthly_channel_receipts = Decimal(
        str(
            db.scalar(
                select(func.coalesce(func.sum(Receipt.amount), 0))
                .select_from(Receipt)
                .join(Bill, Bill.id == Receipt.bill_id)
                .where(Bill.period == current_period)
            )
            or 0
        )
    )
    previous_month_channel_receipts = Decimal(
        str(
            db.scalar(
                select(func.coalesce(func.sum(Receipt.amount), 0))
                .select_from(Receipt)
                .join(Bill, Bill.id == Receipt.bill_id)
                .where(Bill.period == prev_period)
            )
            or 0
        )
    )

    # 口径：本月应付研发 = rd 账单(BillType.rd)在当前月账期的 amount 汇总
    monthly_rd_payable = Decimal(
        str(
            db.scalar(
                select(func.coalesce(func.sum(Bill.amount), 0)).where(Bill.bill_type == BillType.rd, Bill.period == current_period)
            )
            or 0
        )
    )
    previous_month_rd_payable = Decimal(
        str(
            db.scalar(
                select(func.coalesce(func.sum(Bill.amount), 0)).where(Bill.bill_type == BillType.rd, Bill.period == prev_period)
            )
            or 0
        )
    )

    # 口径：本月毛利润 = 本月渠道回款 - 本月应付研发
    monthly_gross_profit = monthly_channel_receipts - monthly_rd_payable
    previous_month_gross_profit = previous_month_channel_receipts - previous_month_rd_payable

    # 口径：未结算金额 = 所有未完全回款账单(amount - 已回款)的剩余金额汇总
    receipt_sum = (
        select(Receipt.bill_id.label("bill_id"), func.coalesce(func.sum(Receipt.amount), 0).label("received_total"))
        .group_by(Receipt.bill_id)
        .subquery("receipt_sum")
    )
    outstanding_stmt = (
        select(func.coalesce(func.sum(Bill.amount - func.coalesce(receipt_sum.c.received_total, 0)), 0))
        .select_from(Bill)
        .outerjoin(receipt_sum, receipt_sum.c.bill_id == Bill.id)
        .where(Bill.collection_status != CollectionStatus.paid)
    )
    unsettled_amount = Decimal(str(db.scalar(outstanding_stmt) or 0))
    previous_unsettled_amount = Decimal(
        str(
            db.scalar(
                select(func.coalesce(func.sum(Bill.amount), 0)).where(
                    Bill.collection_status != CollectionStatus.paid,
                    Bill.period == prev_period,
                )
            )
            or 0
        )
    )

    # 异常口径与异常中心同源：复用统一异常聚合函数
    exception_data_current = _collect_exception_data(db, days=days, status_filter="all", type_filter="all")
    exception_bill_count = int(exception_data_current["summary"]["total"])

    previous_exception_bill_count = int(
        db.scalar(
            select(func.count(ImportHistory.id)).where(
                ImportHistory.created_at >= dt.datetime.combine(prev_month_start, dt.time.min),
                ImportHistory.created_at < dt.datetime.combine(month_start, dt.time.min),
                (ImportHistory.invalid_count > 0) | (ImportHistory.status.like("%失败%")),
            )
        )
        or 0
    )

    start_day = today - dt.timedelta(days=days - 1)
    date_keys = [(start_day + dt.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    flow_map: dict[str, Decimal] = {d: Decimal("0") for d in date_keys}
    receipt_map: dict[str, Decimal] = {d: Decimal("0") for d in date_keys}
    rd_map: dict[str, Decimal] = {d: Decimal("0") for d in date_keys}

    flow_rows = db.execute(
        select(func.date(RawStatement.created_at).label("d"), func.coalesce(func.sum(RawStatement.gross_amount), 0).label("s"))
        .where(RawStatement.created_at >= cutoff_dt)
        .group_by(func.date(RawStatement.created_at))
    ).all()
    for d, s in flow_rows:
        key = str(d)
        if key in flow_map:
            flow_map[key] = Decimal(str(s or 0))

    receipt_rows = db.execute(
        select(func.date(Receipt.received_at).label("d"), func.coalesce(func.sum(Receipt.amount), 0).label("s"))
        .where(Receipt.received_at >= start_day)
        .group_by(func.date(Receipt.received_at))
    ).all()
    for d, s in receipt_rows:
        key = str(d)
        if key in receipt_map:
            receipt_map[key] = Decimal(str(s or 0))

    rd_rows = db.execute(
        select(func.date(Bill.created_at).label("d"), func.coalesce(func.sum(Bill.amount), 0).label("s"))
        .where(Bill.bill_type == BillType.rd, Bill.created_at >= cutoff_dt)
        .group_by(func.date(Bill.created_at))
    ).all()
    for d, s in rd_rows:
        key = str(d)
        if key in rd_map:
            rd_map[key] = Decimal(str(s or 0))

    trends: list[dict] = []
    for d in date_keys:
        flow_amount = flow_map[d]
        receipt_amount = receipt_map[d]
        profit_amount = receipt_amount - rd_map[d]
        trends.append({"date": d, "type": "流水", "amount": flow_amount})
        trends.append({"date": d, "type": "回款", "amount": receipt_amount})
        trends.append({"date": d, "type": "利润", "amount": profit_amount})

    recent_logs = db.scalars(select(SystemAuditLog).order_by(SystemAuditLog.id.desc()).limit(10)).all()
    recent_activities = [
        {
            "id": x.id,
            "operator": x.operator,
            "action_type": x.action,
            "detail": x.summary,
            "created_at": x.created_at,
        }
        for x in recent_logs
    ]

    return {
        "summary": {
            "monthly_gross_revenue": monthly_gross_revenue,
            "monthly_channel_receipts": monthly_channel_receipts,
            "monthly_rd_payable": monthly_rd_payable,
            "monthly_gross_profit": monthly_gross_profit,
            "unsettled_amount": unsettled_amount,
            "exception_bill_count": exception_bill_count,
        },
        "summary_compare": {
            "monthly_gross_revenue": _safe_ratio_change(monthly_gross_revenue, previous_month_gross_revenue),
            "monthly_channel_receipts": _safe_ratio_change(monthly_channel_receipts, previous_month_channel_receipts),
            "monthly_rd_payable": _safe_ratio_change(monthly_rd_payable, previous_month_rd_payable),
            "monthly_gross_profit": _safe_ratio_change(monthly_gross_profit, previous_month_gross_profit),
            "unsettled_amount": _safe_ratio_change(unsettled_amount, previous_unsettled_amount),
            "exception_bill_count": _safe_ratio_change(Decimal(str(exception_bill_count)), Decimal(str(previous_exception_bill_count))),
        },
        "trends": trends,
        "exceptions": {
            "total": exception_data_current["summary"]["total"],
            "share": exception_data_current["summary"]["share"],
            "channel": exception_data_current["summary"]["channel"],
            "game": exception_data_current["summary"]["game"],
            "import": exception_data_current["summary"]["import"],
            "overdue": exception_data_current["summary"]["overdue"],
        },
        "recent_activities": recent_activities,
    }


@app.get("/exceptions/overview")
def exceptions_overview(
    range: str = Query(default="30d"),
    status: str = Query(default="all"),
    type: str = Query(default="all"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance_manager, Role.ops_manager, Role.tech])),
):
    range_mapping = {"7d": 7, "30d": 30, "90d": 90}
    if range not in range_mapping:
        raise HTTPException(status_code=400, detail="range 仅支持 7d/30d/90d")
    payload = _collect_exception_data(db, days=range_mapping[range], status_filter=status, type_filter=type)
    return payload


@app.post("/exceptions/status")
def update_exception_status(
    payload: ExceptionStatusPatchIn,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_role([Role.admin, Role.finance_manager])),
):
    if payload.type not in {"share", "channel", "game", "import", "overdue"}:
        raise HTTPException(status_code=400, detail="type 参数非法")
    row = db.scalar(
        select(ExceptionHandleRecord).where(
            ExceptionHandleRecord.exception_type == payload.type,
            ExceptionHandleRecord.exception_id == payload.id,
        )
    )
    if row:
        row.status = payload.status
        row.remark = payload.remark
        row.updated_by = ctx["user"]
        row.updated_at = dt.datetime.now()
    else:
        db.add(
            ExceptionHandleRecord(
                exception_type=payload.type,
                exception_id=payload.id,
                status=payload.status,
                remark=payload.remark,
                updated_by=ctx["user"],
                updated_at=dt.datetime.now(),
            )
        )
    write_system_audit(
        db,
        ctx["user"],
        "update_exception_status",
        "exception",
        f"{payload.type}:{payload.id}",
        f"状态更新为 {payload.status.value}",
    )
    db.commit()
    return {"ok": True}


@app.get("/audit/logs")
def list_system_audit_logs(
    operator: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin])),
):
    rows = db.scalars(select(SystemAuditLog).order_by(SystemAuditLog.id.desc())).all()
    if operator:
        rows = [x for x in rows if operator in x.operator]
    if action:
        rows = [x for x in rows if action in x.action]
    if target_type:
        rows = [x for x in rows if target_type in x.target_type]
    if start_time:
        start_dt = dt.datetime.fromisoformat(start_time)
        rows = [x for x in rows if x.created_at >= start_dt]
    if end_time:
        end_dt = dt.datetime.fromisoformat(end_time)
        rows = [x for x in rows if x.created_at <= end_dt]
    total = len(rows)
    start = (max(page, 1) - 1) * max(page_size, 1)
    end = start + max(page_size, 1)
    return {"items": rows[start:end], "total": total, "page": page, "page_size": page_size}


@app.get("/audit-logs")
def list_audit_logs_compat(
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin])),
):
    return db.scalars(select(SystemAuditLog).order_by(SystemAuditLog.id.desc()).limit(200)).all()
