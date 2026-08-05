from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.activity_log import ActivityLog
from app.models.asn import ASN
from app.models.cycle_count import CycleCount
from app.models.notification import Notification
from app.models.order import Order
from app.models.quality_check import QualityCheck
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.session import UserSession
from app.models.shipment import Shipment
from app.models.stock_movement import StockMovement
from app.models.user import User
from app.models.work_order import WorkOrder
from app.schemas.user import LoginRequest, ProfileUpdate, SessionOut, Token, UserCreate, UserOut
from app.services.auth import create_access_token, get_current_user, hash_password, security, verify_password
from app.services.password_policy import validate_password
from app.services import ratelimit
from app.utils import log_activity

router = APIRouter(prefix="/api/auth", tags=["auth"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _detect_image_ext(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def _create_session(db: Session, user: User, request: Request) -> str:
    jti = uuid4().hex
    db.add(UserSession(
        user_id=user.id,
        jti=jti,
        ip_address=_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:255],
    ))
    return jti


def _current_jti(credentials: HTTPAuthorizationCredentials) -> str | None:
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=[settings.algorithm])
        return payload.get("jti")
    except Exception:
        return None


@router.post("/login", response_model=Token)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    message = ratelimit.lockout_message(req.username, ip)
    if message:
        raise HTTPException(status_code=429, detail=message)
    user = db.query(User).filter(User.username == req.username, User.is_active == True).first()
    if not user or not verify_password(req.password, user.password_hash):
        ratelimit.record_failure(req.username, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    ratelimit.clear_failures(req.username, ip)
    user.last_login_at = datetime.now(timezone.utc)
    jti = _create_session(db, user, request)
    db.commit()
    db.refresh(user)
    token = create_access_token(
        {"sub": str(user.id)},
        expires_minutes=settings.remember_token_expire_minutes if req.remember else None,
        jti=jti,
    )
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.post("/register", response_model=Token)
def register(req: UserCreate, request: Request, db: Session = Depends(get_db)):
    password_error = validate_password(req.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if db.query(User).filter((User.username == req.username) | (User.email == req.email)).first():
        raise HTTPException(status_code=400, detail="Username or email already exists")
    if db.query(User).count() > 0:
        raise HTTPException(status_code=403, detail="Registration is disabled. Contact an administrator.")
    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role="admin",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()
    jti = _create_session(db, user, request)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)}, jti=jti)
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
def update_me(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes to save")
    if "username" in updates:
        username = updates["username"].strip()
        if not username:
            raise HTTPException(status_code=400, detail="Username cannot be empty")
        if db.query(User).filter(User.username == username, User.id != current_user.id).first():
            raise HTTPException(status_code=400, detail="Username already exists")
        updates["username"] = username
    if "email" in updates:
        email = updates["email"].strip()
        if not email:
            raise HTTPException(status_code=400, detail="Email cannot be empty")
        if db.query(User).filter(User.email == email, User.id != current_user.id).first():
            raise HTTPException(status_code=400, detail="Email already exists")
        updates["email"] = email
    for key, val in updates.items():
        setattr(current_user, key, val)
    db.commit()
    db.refresh(current_user)
    log_activity(db, current_user.id, current_user.username, "update", "user", current_user.id,
                 f"Updated own profile ({', '.join(updates.keys())})")
    db.commit()
    return current_user


@router.post("/me/avatar")
def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    detected = _detect_image_ext(content)
    if detected is None:
        raise HTTPException(status_code=400, detail="File content is not a supported image")
    if ext in (".jpeg", ".jpg"):
        matches = detected in (".jpeg", ".jpg")
    else:
        matches = detected == ext
    if not matches:
        raise HTTPException(status_code=400, detail=f"File content does not match its extension ({ext})")
    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"avatar_{current_user.id}_{uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    current_user.avatar_url = f"/uploads/{filename}"
    db.commit()
    return {"avatar_url": current_user.avatar_url}


@router.delete("/me/avatar", response_model=UserOut)
def remove_avatar(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.avatar_url = ""
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_jti = _current_jti(credentials)
    sessions = db.query(UserSession).filter(UserSession.user_id == current_user.id).order_by(UserSession.created_at.desc()).all()
    out = []
    for s in sessions:
        item = SessionOut.model_validate(s)
        item.is_current = s.jti == current_jti
        out.append(item)
    return out


@router.delete("/sessions", response_model=dict)
def revoke_all_other_sessions(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_jti = _current_jti(credentials)
    now = datetime.now(timezone.utc)
    count = db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.jti != current_jti,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": now})
    db.commit()
    log_activity(db, current_user.id, current_user.username, "logout_all", "user", current_user.id,
                 f"Signed out {count} other session(s)")
    db.commit()
    return {"revoked": count}


@router.delete("/sessions/{session_id}", response_model=dict)
def revoke_session(
    session_id: int,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(UserSession).filter(UserSession.id == session_id, UserSession.user_id == current_user.id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.jti == _current_jti(credentials):
        raise HTTPException(status_code=400, detail="You cannot revoke the current session here (use Sign Out)")
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/logout", response_model=dict)
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    jti = _current_jti(credentials)
    if jti:
        db.query(UserSession).filter(UserSession.jti == jti, UserSession.revoked_at.is_(None)).update({"revoked_at": datetime.now(timezone.utc)})
        db.commit()
    return {"ok": True}


@router.get("/me/export")
def export_my_data(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.id
    activity = [
        {"id": l.id, "action": l.action, "entity_type": l.entity_type, "entity_id": l.entity_id,
         "description": l.description, "created_at": l.created_at}
        for l in db.query(ActivityLog).filter(ActivityLog.user_id == uid).order_by(ActivityLog.created_at.desc()).all()
    ]
    notifications = [
        {"id": n.id, "type": n.type, "title": n.title, "message": n.message, "is_read": n.is_read, "created_at": n.created_at}
        for n in db.query(Notification).filter(Notification.user_id == uid).order_by(Notification.created_at.desc()).all()
    ]
    orders = [
        {"id": o.id, "order_number": o.order_number, "status": o.status, "total_amount": o.total_amount, "created_at": o.created_at}
        for o in db.query(Order).filter(Order.user_id == uid).all()
    ]
    sales = [
        {"id": s.id, "invoice_number": s.invoice_number, "status": s.status, "total_amount": s.total_amount, "created_at": s.created_at}
        for s in db.query(Sale).filter(Sale.user_id == uid).all()
    ]
    receipts = [
        {"id": r.id, "receipt_number": r.receipt_number, "status": r.status, "created_at": r.created_at}
        for r in db.query(Receipt).filter(Receipt.user_id == uid).all()
    ]
    movements = [
        {"id": m.id, "product_id": m.product_id, "product_name": m.product_name, "quantity_change": m.quantity_change,
         "movement_type": m.movement_type, "reference_type": m.reference_type, "reference": m.reference,
         "created_at": m.created_at}
        for m in db.query(StockMovement).filter(StockMovement.user_id == uid).order_by(StockMovement.created_at.desc()).all()
    ]
    shipments = [
        {"id": s.id, "shipment_number": s.shipment_number, "status": s.status, "created_at": s.created_at}
        for s in db.query(Shipment).filter(Shipment.created_by == uid).all()
    ]
    quality_checks = [
        {"id": q.id, "qc_number": q.qc_number, "product_id": q.product_id, "result": q.result, "checked_at": q.checked_at}
        for q in db.query(QualityCheck).filter(QualityCheck.checked_by == uid).all()
    ]
    asns = [
        {"id": a.id, "asn_number": a.asn_number, "status": a.status, "expected_arrival": a.expected_arrival, "created_at": a.created_at}
        for a in db.query(ASN).filter(ASN.user_id == uid).all()
    ]
    cycle_counts = [
        {"id": c.id, "cc_number": c.cc_number, "status": c.status, "created_at": c.created_at}
        for c in db.query(CycleCount).filter(CycleCount.created_by == uid).all()
    ]
    work_orders = [
        {"id": w.id, "wo_number": w.wo_number, "status": w.status, "created_at": w.created_at}
        for w in db.query(WorkOrder).filter(WorkOrder.created_by == uid).all()
    ]
    return {
        "exported_at": datetime.now(timezone.utc),
        "profile": UserOut.model_validate(current_user),
        "activity_logs": activity,
        "notifications": notifications,
        "orders": orders,
        "sales": sales,
        "receipts": receipts,
        "stock_movements": movements,
        "shipments": shipments,
        "quality_checks": quality_checks,
        "asns": asns,
        "cycle_counts": cycle_counts,
        "work_orders": work_orders,
    }
