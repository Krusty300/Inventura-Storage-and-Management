from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.constants import CURRENCIES, currency_symbol as symbol_for
from app.database import get_db
from app.models.settings import Settings
from app.services.auth import require_permission
from app.utils import broadcast_change
from app.services.cache import settings_cache

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_permission("settings.view"))])

# Public settings are reachable without authentication (e.g. the login screen
# needs store branding). Kept on a separate router because FastAPI route-level
# `dependencies=[]` cannot override router-level auth dependencies.
public_router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[])

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
    invoice_prefix: Optional[str] = None
    po_prefix: Optional[str] = None
    receipt_prefix: Optional[str] = None
    asn_prefix: Optional[str] = None
    qc_prefix: Optional[str] = None
    cc_prefix: Optional[str] = None
    return_prefix: Optional[str] = None
    transfer_prefix: Optional[str] = None
    unallocated_prefix: Optional[str] = None
    quarantine_prefix: Optional[str] = None
    lpn_prefix: Optional[str] = None
    lpn_move_prefix: Optional[str] = None
    lpn_load_prefix: Optional[str] = None
    lpn_unload_prefix: Optional[str] = None
    stock_in_prefix: Optional[str] = None
    stock_out_prefix: Optional[str] = None
    adjustment_prefix: Optional[str] = None
    require_qc_before_ship: Optional[bool] = None
    auto_allocate_stock: Optional[bool] = None
    enforce_fefo: Optional[bool] = None
    default_costing_method: Optional[str] = None
    fiscal_year_start_month: Optional[int] = None
    default_items_per_page: Optional[int] = None
    date_format: Optional[str] = None
    show_product_hover_cards: Optional[bool] = None
    show_customer_hover_cards: Optional[bool] = None
    show_supplier_hover_cards: Optional[bool] = None
    show_datetime_hover_cards: Optional[bool] = None
    show_cart_summary_hover_cards: Optional[bool] = None
    tax_id: Optional[str] = None
    payment_terms: Optional[str] = None
    bank_details: Optional[str] = None
    footer_note: Optional[str] = None

    @field_validator("tax_rate")
    @classmethod
    def validate_tax_rate(cls, v: float | None) -> float | None:
        if v is not None and (v < 0 or v > 100):
            raise ValueError("tax_rate must be between 0 and 100")
        return v

    @field_validator("default_reorder_level")
    @classmethod
    def validate_reorder(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("default_reorder_level must be >= 0")
        return v

    @field_validator("expiry_warning_days")
    @classmethod
    def validate_expiry_days(cls, v: int | None) -> int | None:
        if v is not None and (v < 1 or v > 365):
            raise ValueError("expiry_warning_days must be between 1 and 365")
        return v

    @field_validator("fiscal_year_start_month")
    @classmethod
    def validate_fiscal_month(cls, v: int | None) -> int | None:
        if v is not None and (v < 1 or v > 12):
            raise ValueError("fiscal_year_start_month must be between 1 and 12")
        return v

    @field_validator("default_items_per_page")
    @classmethod
    def validate_per_page(cls, v: int | None) -> int | None:
        if v is not None and (v < 1 or v > 500):
            raise ValueError("default_items_per_page must be between 1 and 500")
        return v


SETTING_FIELDS = [
    "id", "store_name", "address", "phone", "email", "currency_symbol", "currency_code",
    "tax_rate", "default_reorder_level",
    "expiry_warning_days", "low_stock_alerts", "expiry_alerts",
    "shipment_prefix", "work_order_prefix", "invoice_prefix", "po_prefix",
    "receipt_prefix", "asn_prefix", "qc_prefix", "cc_prefix",
    "return_prefix", "transfer_prefix", "unallocated_prefix", "quarantine_prefix",
    "lpn_prefix", "lpn_move_prefix", "lpn_load_prefix", "lpn_unload_prefix",
    "stock_in_prefix", "stock_out_prefix", "adjustment_prefix",
    "require_qc_before_ship", "auto_allocate_stock", "enforce_fefo",
    "default_costing_method", "fiscal_year_start_month",
    "default_items_per_page", "date_format",
    "show_product_hover_cards", "show_customer_hover_cards", "show_supplier_hover_cards",
    "show_datetime_hover_cards", "show_cart_summary_hover_cards",
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
    from app.utils import detect_image_ext
    return detect_image_ext(data)


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    return _serialize(get_or_create_settings(db))


@public_router.get("/public", dependencies=[])
def get_public_settings(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"store_name": s.store_name, "logo_url": s.logo_url}


@router.put("")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_permission("settings.update"))):
    s = get_or_create_settings(db)
    payload = data.model_dump(exclude_unset=True)
    if "currency_code" in payload and payload["currency_code"] not in CURRENCIES:
        raise HTTPException(status_code=400, detail=f"currency_code must be one of {', '.join(CURRENCIES)}")
    # Keep the symbol consistent with the code: always use the canonical symbol
    # for an updated code when the caller didn't supply one, and fall back to the
    # canonical symbol for the current code when a supplied symbol is empty.
    if "currency_code" in payload:
        code = payload["currency_code"]
        symbol = payload.get("currency_symbol")
        payload["currency_symbol"] = (symbol or "").strip() or symbol_for(code)
    elif "currency_symbol" in payload:
        symbol = (payload["currency_symbol"] or "").strip()
        payload["currency_symbol"] = symbol or symbol_for(s.currency_code)
    PREFIX_FIELDS = [
        "shipment_prefix", "work_order_prefix", "invoice_prefix", "po_prefix",
        "receipt_prefix", "asn_prefix", "qc_prefix", "cc_prefix",
        "return_prefix", "transfer_prefix", "unallocated_prefix", "quarantine_prefix",
        "lpn_prefix", "lpn_move_prefix", "lpn_load_prefix", "lpn_unload_prefix",
        "stock_in_prefix", "stock_out_prefix", "adjustment_prefix",
    ]
    for k, v in payload.items():
        if k in PREFIX_FIELDS and isinstance(v, str):
            v = v.strip()
            if not v:
                raise HTTPException(status_code=400, detail=f"{k} cannot be empty")
            if len(v) > 20:
                raise HTTPException(status_code=400, detail=f"{k} must be 20 characters or fewer")
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    settings_cache.clear()
    broadcast_change("settings", "updated")
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
    s = get_or_create_settings(db)
    if s.logo_url:
        old_path = UPLOAD_DIR / Path(s.logo_url).name
        try:
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass
    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"logo_{uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    s.logo_url = f"/uploads/{filename}"
    db.commit()
    broadcast_change("settings", "updated")
    return {"logo_url": s.logo_url}


@router.delete("/logo")
def remove_logo(
    db: Session = Depends(get_db),
    user=Depends(require_permission("settings.update")),
):
    s = get_or_create_settings(db)
    if s.logo_url:
        old_path = UPLOAD_DIR / Path(s.logo_url).name
        try:
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass
    s.logo_url = ""
    db.commit()
    broadcast_change("settings", "updated")
    return {"logo_url": ""}
