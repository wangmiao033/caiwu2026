from __future__ import annotations

import datetime as dt
import enum
import os
from decimal import Decimal
from typing import Optional
from urllib.parse import urlparse

import pandas as pd
import jwt
from openpyxl import load_workbook
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
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
bearer_scheme = HTTPBearer(auto_error=False)


class Base(DeclarativeBase):
    pass


class Role(str, enum.Enum):
    admin = "admin"
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
    "finance": {"password": "123456", "role": Role.finance},
    "biz": {"password": "123456", "role": Role.biz},
    "ops": {"password": "123456", "role": Role.ops},
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
    project_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    project_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    variant_id: Mapped[Optional[int]] = mapped_column(index=True, nullable=True)
    variant_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rd_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    publish_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    rd_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    publish_share_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
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


class ChannelIn(BaseModel):
    name: str


class ChannelBulkCreateIn(BaseModel):
    names: list[str]


class GameBulkCreateIn(BaseModel):
    names: list[str]


class GameIn(BaseModel):
    name: str
    rd_company: str


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


class BillStatusIn(BaseModel):
    status: BillStatus
    note: str = ""


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
    summary: str
    created_by: str
    created_at: dt.datetime
    matched_variant_count: int = 0
    unmatched_variant_count: int = 0
    unresolved_issue_count: int = 0
    resolved_issue_count: int = 0


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def build_token(username: str, role: Role) -> str:
    expire_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=JWT_EXPIRE_DAYS)
    payload = {"sub": username, "role": role.value, "exp": expire_at}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def unauthorized(message: str = "未登录或登录已过期"):
    return HTTPException(status_code=401, detail={"code": 401, "message": message})


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


def require_role(roles: list[Role]):
    def checker(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
        x_user: str = Header(default="system"),
        db: Session = Depends(get_db),
    ):
        if not credentials or credentials.scheme.lower() != "bearer":
            raise unauthorized()
        try:
            payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
            current_role = Role(payload.get("role", "ops"))
            token_user = payload.get("sub", x_user)
        except Exception as e:
            raise unauthorized() from e
        if current_role not in roles:
            raise HTTPException(status_code=403, detail="无权限")
        db.add(AuditLog(actor=token_user, action="api_call", target=f"role={current_role.value}"))
        db.commit()
        return {"user": token_user, "role": current_role}

    return checker


def create_default_data(db: Session):
    if db.scalar(select(func.count(User.id))) == 0:
        db.add_all(
            [
                User(username="admin", role=Role.admin),
                User(username="finance", role=Role.finance),
                User(username="biz", role=Role.biz),
                User(username="ops", role=Role.ops),
            ]
        )
    if db.scalar(select(func.count(BillingRule.id))) == 0:
        db.add_all(
            [
                BillingRule(name="默认渠道分成", bill_type=BillType.channel, default_ratio=Decimal("0.3000")),
                BillingRule(name="默认研发结算", bill_type=BillType.rd, default_ratio=Decimal("0.5000")),
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


def ensure_import_enrichment_columns():
    inspector = inspect(engine)
    if "raw_statements" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("raw_statements")}
        statements: list[str] = []
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
    ensure_game_variant_settlement_columns()
    ensure_import_enrichment_columns()
    with SessionLocal() as db:
        create_default_data(db)


@app.get("/")
def root():
    return {"name": "内部对账系统", "phase": "1-3 已实现基础闭环", "docs": "/docs"}


@app.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = LOCAL_USERS.get(payload.username)
    if not user or user["password"] != payload.password:
        raise HTTPException(status_code=401, detail={"code": 401, "message": "用户名或密码错误"})
    token = build_token(payload.username, user["role"])
    write_system_audit(db, payload.username, "login_success", "auth", payload.username, "登录成功")
    db.commit()
    return {"access_token": token, "token_type": "bearer"}


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
    game = Game(name=payload.name, rd_company=payload.rd_company)
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
        db.add(Game(name=name, rd_company="待补充"))
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
    row.name = payload.name
    row.rd_company = payload.rd_company
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
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    stmt = select(GameVariant).order_by(GameVariant.id.desc())
    if project_id is not None:
        stmt = stmt.where(GameVariant.project_id == project_id)
    return db.scalars(stmt).all()


@app.post("/game-variants")
def create_game_variant(payload: GameVariantIn, db: Session = Depends(get_db), ctx: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
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
    ctx: dict = Depends(require_role([Role.admin, Role.biz])),
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
    ctx: dict = Depends(require_role([Role.admin, Role.biz])),
):
    row = db.get(GameVariant, variant_id)
    if not row:
        raise HTTPException(status_code=404, detail="版本不存在")
    row.status = payload.status
    write_system_audit(db, ctx["user"], "update_game_variant_status", "game_variant", str(row.id), f"版本状态: {payload.status.value}")
    db.commit()
    return row


@app.post("/channel-game-map")
def create_map(payload: MapIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
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
    ctx: dict = Depends(require_role([Role.admin, Role.biz])),
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
def list_map(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
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
def update_map(map_id: int, payload: MapIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
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
    ctx: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    content = await file.read()
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail={"code": 400, "message": "仅支持 CSV / XLSX 文件"})
    tmp = f"./tmp_{dt.datetime.now().timestamp()}.xlsx"
    with open(tmp, "wb") as f:
        f.write(content)
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
    unresolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == task_id, ReconIssue.resolved.is_(False)))
    if unresolved > 0:
        raise HTTPException(status_code=400, detail="仍有异常未处理")
    task.status = ReconStatus.confirmed
    write_system_audit(db, _["user"], "confirm_recon_period", "recon_task", str(task.id), f"确认账期: {task.period}")
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
    force_new_version: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance])),
):
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
    created = 0
    for target, amount in channel_sum.items():
        latest = db.scalar(
            select(Bill).where(Bill.bill_type == BillType.channel, Bill.period == period, Bill.target_name == target).order_by(Bill.version.desc())
        )
        version = (latest.version + 1) if (latest and force_new_version) else 1 if not latest else latest.version
        db.add(Bill(bill_type=BillType.channel, period=period, target_name=target, amount=amount, version=version))
        created += 1
    for target, amount in rd_sum.items():
        latest = db.scalar(
            select(Bill).where(Bill.bill_type == BillType.rd, Bill.period == period, Bill.target_name == target).order_by(Bill.version.desc())
        )
        version = (latest.version + 1) if (latest and force_new_version) else 1 if not latest else latest.version
        db.add(Bill(bill_type=BillType.rd, period=period, target_name=target, amount=amount, version=version))
        created += 1
    write_system_audit(db, _["user"], "generate_bills", "bill", period, f"生成账单数量: {created}")
    db.commit()
    return {"created_bills": created}


@app.get("/billing/bills")
def list_bills(
    period: Optional[str] = None,
    bill_type: Optional[BillType] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops])),
):
    stmt = select(Bill).order_by(Bill.id.desc())
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


@app.post("/billing/{bill_id}/send")
def send_bill(bill_id: int, payload: BillStatusIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
    bill = db.get(Bill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
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


@app.get("/imports/history")
def list_import_history(
    period: Optional[str] = None,
    import_type: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops, Role.biz])),
):
    rows = db.scalars(select(ImportHistory).order_by(ImportHistory.id.desc())).all()
    if period:
        rows = [x for x in rows if period in x.period]
    if import_type:
        rows = [x for x in rows if x.import_type == import_type]
    if status:
        rows = [x for x in rows if status in x.status]
    if keyword:
        rows = [x for x in rows if keyword in f"{x.file_name}{x.summary}{x.created_by}"]
    total = len(rows)
    start = (max(page, 1) - 1) * max(page_size, 1)
    end = start + max(page_size, 1)
    return {"items": rows[start:end], "total": total, "page": page, "page_size": page_size}


@app.get("/imports/history/{history_id}", response_model=ImportHistoryOut)
def get_import_history(history_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops, Role.biz]))):
    row = db.get(ImportHistory, history_id)
    if not row:
        raise HTTPException(status_code=404, detail="导入历史不存在")
    unresolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == row.task_id, ReconIssue.resolved.is_(False)))
    resolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == row.task_id, ReconIssue.resolved.is_(True)))
    payload = ImportHistoryOut.model_validate(row)
    payload.unresolved_issue_count = int(unresolved or 0)
    payload.resolved_issue_count = int(resolved or 0)
    return payload


@app.get("/imports/history/{history_id}/issues")
def get_import_history_issues(history_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops, Role.biz]))):
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
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops, Role.biz])),
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


@app.get("/dashboard/finance")
def finance_dashboard(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
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
