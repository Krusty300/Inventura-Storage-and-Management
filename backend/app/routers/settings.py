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


def get_or_create_settings(db: Session) -> Settings:
    s = db.query(Settings).first()
    if not s:
        s = Settings(store_name="My Store", currency_symbol="$")
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {
        "id": s.id, "store_name": s.store_name, "address": s.address, "phone": s.phone,
        "email": s.email, "currency_symbol": s.currency_symbol, "tax_rate": s.tax_rate,
        "default_reorder_level": s.default_reorder_level,
    }


@router.put("")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), user=Depends(require_permission("settings.update"))):
    s = get_or_create_settings(db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return {
        "id": s.id, "store_name": s.store_name, "address": s.address, "phone": s.phone,
        "email": s.email, "currency_symbol": s.currency_symbol, "tax_rate": s.tax_rate,
        "default_reorder_level": s.default_reorder_level,
    }
