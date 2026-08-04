from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import Settings
from app.services.auth import get_current_user, require_permission

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(get_current_user)])


class SettingsUpdate(BaseModel):
    store_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    currency_symbol: Optional[str] = None
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


SETTING_FIELDS = [
    "id", "store_name", "address", "phone", "email", "currency_symbol",
    "tax_rate", "default_reorder_level",
    "expiry_warning_days", "low_stock_alerts", "expiry_alerts",
    "shipment_prefix", "work_order_prefix", "sale_prefix", "invoice_prefix", "po_prefix",
    "require_qc_before_ship", "auto_allocate_stock", "enforce_fefo",
    "default_costing_method", "fiscal_year_start_month",
    "default_items_per_page", "date_format",
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


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    return _serialize(get_or_create_settings(db))


@router.put("")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_permission("settings.update"))):
    s = get_or_create_settings(db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return _serialize(s)
