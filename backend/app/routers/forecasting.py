from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.services import forecasting
from app.services.auth import get_current_user, require_permission
from app.utils import get_or_404

router = APIRouter(prefix="/api/forecasting", tags=["forecasting"], dependencies=[Depends(get_current_user)])


@router.get("/replenishment")
def replenishment(
    service_level: float = Query(forecasting.DEFAULT_SERVICE_LEVEL, gt=0.5, lt=1.0),
    days: int = Query(forecasting.DEFAULT_HISTORY_DAYS, ge=7, le=365),
    lead_time_days: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    user=Depends(require_permission("forecasting.view")),
):
    items = forecasting.replenishment_rows(
        db,
        service_level=service_level,
        days=days,
        lead_time_override=lead_time_days,
    )
    to_reorder = [i for i in items if i["status"] == "reorder"]
    summary = {
        "products": len(items),
        "to_reorder": len(to_reorder),
        "total_suggested_qty": sum(i["suggested_order_qty"] for i in to_reorder),
        "avg_lead_time": round(
            sum(i["lead_time_days"] for i in items) / len(items), 1
        ) if items else 0,
    }
    return {"items": items, "summary": summary, "service_level": service_level, "days": days}


@router.get("/products/{product_id}")
def product_detail(
    product_id: int,
    service_level: float = Query(forecasting.DEFAULT_SERVICE_LEVEL, gt=0.5, lt=1.0),
    days: int = Query(forecasting.DEFAULT_HISTORY_DAYS, ge=7, le=365),
    lead_time_days: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    user=Depends(require_permission("forecasting.view")),
):
    get_or_404(Product, product_id, db)
    try:
        return forecasting.product_forecast_detail(
            db,
            product_id=product_id,
            service_level=service_level,
            days=days,
            lead_time_override=lead_time_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
