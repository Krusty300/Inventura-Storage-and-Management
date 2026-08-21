from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.constants import CURRENCIES
from app.database import get_db
from app.models.settings import Settings
from app.services.auth import require_permission

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_permission("settings.view"))])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_LOGO_SIZE = 5 * 1024 * 1024


class SettingsUpdate(BaseModel):
    store_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    currency_symbol: Optional[str] = None
    currency_code: Optional[str] = None
    tax_rate: Optional[float] = None
    default_reorder_level: Optional[int] = None
    expiry_warning_days: Optional[int] = None
    low_stock_alerts: Optional[bool] = None
    expiry_alerts: Optional[bool] = None
    shipment_prefix: Optional[str] = None
    work_order_prefix: Optional[str] = None
    sale_prefix: Optional[str] = None
    invoice_prefix: Optional[str] = None
    po_prefix: Optional[str] = None
    require_qc_before_ship: Optional[bool] = None
    auto_allocate_stock: Optional[bool] = None
    enforce_fefo: Optional[bool] = None
    default_costing_method: Optional[str] = None
    fiscal_year_start_month: Optional[int] = None
    default_items_per_page: Optional[int] = None
    date_format: Optional[str] = None
    tax_id: Optional[str] = None
    payment_terms: Optional[str] = None
    bank_details: Optional[str] = None
    footer_note: Optional[str] = None


SETTING_FIELDS = [
    "id", "store_name", "address", "phone", "email", "currency_symbol", "currency_code",
    "tax_rate", "default_reorder_level",
    "expiry_warning_days", "low_stock_alerts", "expiry_alerts",
    "shipment_prefix", "work_order_prefix", "sale_prefix", "invoice_prefix", "po_prefix",
    "require_qc_before_ship", "auto_allocate_stock", "enforce_fefo",
    "default_costing_method", "fiscal_year_start_month",
    "default_items_per_page", "date_format",
    "logo_url", "tax_id", "payment_terms", "bank_details", "footer_note",
]


def get_or_create_settings(db: Session) -> Settings:
    s = db.query(Settings).first()
    if not s:
        s = Settings(store_name="My Store", currency_symbol="$")
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _serialize(s: Settings) -> dict:
    return {f: getattr(s, f) for f in SETTING_FIELDS}


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


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    return _serialize(get_or_create_settings(db))


@router.get("/public", dependencies=[])
def get_public_settings(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"store_name": s.store_name}


@router.put("")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_permission("settings.update"))):
    s = get_or_create_settings(db)
    if data.currency_code is not None and data.currency_code not in CURRENCIES:
        raise HTTPException(status_code=400, detail=f"currency_code must be one of {', '.join(CURRENCIES)}")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return _serialize(s)


@router.post("/logo")
def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_permission("settings.update")),
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    detected = _detect_image_ext(content)
    if detected is None:
        raise HTTPException(status_code=400, detail="File content is not a supported image")
    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"logo_{uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    s = get_or_create_settings(db)
    s.logo_url = f"/uploads/{filename}"
    db.commit()
    return {"logo_url": s.logo_url}


@router.delete("/logo")
def remove_logo(
    db: Session = Depends(get_db),
    user=Depends(require_permission("settings.update")),
):
    s = get_or_create_settings(db)
    s.logo_url = ""
    db.commit()
    return {"logo_url": ""}
