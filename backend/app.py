from __future__ import annotations

import datetime as dt
import enum
import os
from decimal import Decimal
from typing import Optional

import pandas as pd
import jwt
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
    select,
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


DATABASE_URL = resolve_database_url()
engine = create_engine(DATABASE_URL, echo=False, future=True)
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


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    role: Mapped[Role] = mapped_column(Enum(Role))


LOCAL_USERS = {
    "admin": {"password": "123456", "role": Role.admin},
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
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=func.now())


class ReconIssue(Base):
    __tablename__ = "recon_issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    recon_task_id: Mapped[int] = mapped_column(ForeignKey("recon_tasks.id"), index=True)
    issue_type: Mapped[str] = mapped_column(String(50))
    detail: Mapped[str] = mapped_column(String(300))
    resolved: Mapped[bool] = mapped_column(default=False)


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


class ChannelIn(BaseModel):
    name: str


class GameIn(BaseModel):
    name: str
    rd_company: str


class MapIn(BaseModel):
    channel_id: int
    game_id: int
    revenue_share_ratio: Decimal = Field(default=Decimal("0.3000"))
    rd_settlement_ratio: Decimal = Field(default=Decimal("0.5000"))


class RuleIn(BaseModel):
    name: str
    bill_type: BillType
    default_ratio: Decimal


class RuleBulkRow(BaseModel):
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


class ReceiptIn(BaseModel):
    bill_id: int
    received_at: dt.date
    amount: Decimal
    bank_ref: str
    account_name: str


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


app = FastAPI(title="内部对账系统", version="1.0.0")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        create_default_data(db)


@app.get("/")
def root():
    return {"name": "内部对账系统", "phase": "1-3 已实现基础闭环", "docs": "/docs"}


@app.post("/login")
def login(payload: LoginIn):
    user = LOCAL_USERS.get(payload.username)
    if not user or user["password"] != payload.password:
        raise HTTPException(status_code=401, detail={"code": 401, "message": "用户名或密码错误"})
    token = build_token(payload.username, user["role"])
    return {"access_token": token, "token_type": "bearer"}


@app.post("/channels")
def create_channel(payload: ChannelIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
    channel = Channel(name=payload.name)
    db.add(channel)
    db.commit()
    return {"id": channel.id, "name": channel.name}


@app.get("/channels")
def list_channels(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    return db.scalars(select(Channel).order_by(Channel.id.desc())).all()


@app.put("/channels/{channel_id}")
def update_channel(channel_id: int, payload: ChannelIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
    row = db.get(Channel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    row.name = payload.name
    db.commit()
    return {"id": row.id, "name": row.name}


@app.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(Channel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    db.delete(row)
    db.commit()
    return {"id": channel_id, "deleted": True}


@app.post("/games")
def create_game(payload: GameIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz, Role.ops]))):
    game = Game(name=payload.name, rd_company=payload.rd_company)
    db.add(game)
    db.commit()
    return {"id": game.id, "name": game.name}


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
    db.commit()
    return {"id": row.id, "name": row.name}


@app.delete("/games/{game_id}")
def delete_game(game_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(Game, game_id)
    if not row:
        raise HTTPException(status_code=404, detail="游戏不存在")
    db.delete(row)
    db.commit()
    return {"id": game_id, "deleted": True}


@app.post("/channel-game-map")
def create_map(payload: MapIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.biz]))):
    exists = db.scalar(
        select(ChannelGameMap).where(ChannelGameMap.channel_id == payload.channel_id, ChannelGameMap.game_id == payload.game_id)
    )
    if exists:
        raise HTTPException(status_code=400, detail="关系已存在")
    item = ChannelGameMap(**payload.model_dump())
    db.add(item)
    db.commit()
    return {"id": item.id}


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
    db.commit()
    return {"id": row.id}


@app.delete("/channel-game-map/{map_id}")
def delete_map(map_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    row = db.get(ChannelGameMap, map_id)
    if not row:
        raise HTTPException(status_code=404, detail="映射不存在")
    db.delete(row)
    db.commit()
    return {"id": map_id, "deleted": True}


@app.post("/recon/import")
async def import_statement(
    period: str = Query(..., description="账期，例如 2026-03"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops])),
):
    content = await file.read()
    tmp = f"./tmp_{dt.datetime.now().timestamp()}.xlsx"
    with open(tmp, "wb") as f:
        f.write(content)
    try:
        if file.filename and file.filename.lower().endswith(".csv"):
            df = pd.read_csv(tmp)
        else:
            df = pd.read_excel(tmp)
    finally:
        os.remove(tmp)
    required = {"channel_name", "game_name", "gross_amount"}
    if not required.issubset(set(df.columns)):
        raise HTTPException(status_code=400, detail="缺少字段: channel_name, game_name, gross_amount")
    task = ReconTask(period=period, status=ReconStatus.pending)
    db.add(task)
    db.flush()
    issue_count = 0
    for _, row in df.iterrows():
        channel_name = str(row["channel_name"]).strip()
        game_name = str(row["game_name"]).strip()
        gross_amount = Decimal(str(row["gross_amount"]))
        db.add(
            RawStatement(
                recon_task_id=task.id,
                channel_name=channel_name,
                game_name=game_name,
                period=period,
                gross_amount=gross_amount,
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
    db.commit()
    return {"recon_task_id": task.id, "issue_count": issue_count}


@app.post("/recon/{task_id}/confirm")
def confirm_recon(task_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    task = db.get(ReconTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    unresolved = db.scalar(select(func.count(ReconIssue.id)).where(ReconIssue.recon_task_id == task_id, ReconIssue.resolved.is_(False)))
    if unresolved > 0:
        raise HTTPException(status_code=400, detail="仍有异常未处理")
    task.status = ReconStatus.confirmed
    db.commit()
    return {"task_id": task_id, "status": task.status}


@app.post("/recon/issues/{issue_id}/resolve")
def resolve_issue(issue_id: int, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops]))):
    issue = db.get(ReconIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="异常不存在")
    issue.resolved = True
    db.commit()
    return {"issue_id": issue.id, "resolved": True}


@app.get("/recon/tasks")
def list_recon(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz, Role.ops]))):
    tasks = db.scalars(select(ReconTask).order_by(ReconTask.id.desc())).all()
    return [{"id": x.id, "period": x.period, "status": x.status} for x in tasks]


@app.get("/recon/issues")
def list_recon_issues(task_id: int = Query(...), db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.ops]))):
    rows = db.scalars(select(ReconIssue).where(ReconIssue.recon_task_id == task_id).order_by(ReconIssue.id.desc())).all()
    return rows


@app.post("/billing/rules")
def create_rule(payload: RuleIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    rule = BillingRule(**payload.model_dump())
    db.add(rule)
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
    db.commit()
    return {"id": row.id}


@app.post("/billing/rules/bulk-import")
def bulk_import_rules(payload: RuleBulkIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    created_count = 0
    updated_count = 0
    failed_count = 0
    for row in payload.rows:
        try:
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
    db.commit()
    return {"created_count": created_count, "updated_count": updated_count, "failed_count": failed_count}


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
    db.commit()
    return {"created_bills": created}


@app.get("/billing/bills", response_model=list[BillOut])
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
    return db.scalars(stmt).all()


@app.post("/billing/{bill_id}/send")
def send_bill(bill_id: int, payload: BillStatusIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
    bill = db.get(Bill, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    bill.status = payload.status
    if payload.status in (BillStatus.sent, BillStatus.acknowledged, BillStatus.disputed):
        db.add(BillDeliveryLog(bill_id=bill_id, note=payload.note))
    db.commit()
    return {"bill_id": bill_id, "status": bill.status}


@app.post("/invoices")
def create_invoice(payload: InvoiceIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    bill = db.get(Bill, payload.bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    invoice = Invoice(**payload.model_dump(), status=InvoiceStatus.issued)
    db.add(invoice)
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
        item = {
            "id": x.id,
            "invoice_no": x.invoice_no,
            "bill_id": x.bill_id,
            "issue_date": x.issue_date,
            "total_amount": x.total_amount,
            "status": x.status,
            "target_name": bill.target_name if bill else "",
            "period": bill.period if bill else "",
            "created_at": str(x.issue_date),
            "remark": "",
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
    db.commit()
    return {"id": row.id}


@app.post("/receipts")
def register_receipt(payload: ReceiptIn, db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance]))):
    bill = db.get(Bill, payload.bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="账单不存在")
    receipt = Receipt(**payload.model_dump())
    db.add(receipt)
    db.flush()
    received_total = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)).where(Receipt.bill_id == payload.bill_id))
    if received_total >= bill.amount:
        bill.collection_status = CollectionStatus.paid
    elif received_total > 0:
        bill.collection_status = CollectionStatus.partial
    else:
        bill.collection_status = CollectionStatus.pending
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
            "remark": "",
            "created_at": str(x.received_at),
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
    db.commit()
    return {"id": row.id}


@app.get("/dashboard/finance")
def finance_dashboard(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin, Role.finance, Role.biz]))):
    total_receivable = db.scalar(select(func.coalesce(func.sum(Bill.amount), 0)))
    total_received = db.scalar(select(func.coalesce(func.sum(Receipt.amount), 0)))
    pending_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.pending))
    partial_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.partial))
    paid_count = db.scalar(select(func.count(Bill.id)).where(Bill.collection_status == CollectionStatus.paid))
    return {
        "total_receivable": total_receivable,
        "total_received": total_received,
        "outstanding": Decimal(str(total_receivable)) - Decimal(str(total_received)),
        "status_breakdown": {"待回款": pending_count, "部分回款": partial_count, "已回款": paid_count},
    }


@app.get("/audit-logs")
def list_audit_logs(db: Session = Depends(get_db), _: dict = Depends(require_role([Role.admin]))):
    logs = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(200)).all()
    return logs
