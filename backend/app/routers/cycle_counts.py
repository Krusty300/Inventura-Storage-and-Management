from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from app.constants import MAX_PAGE_SIZE
from app.database import get_db
from app.models import CycleCount, CycleCountItem, Location, Product
from app.models.settings import Settings
from app.schemas.cycle_count import CycleCountCreate, CycleCountOut, CycleCountSubmit, CycleCountUpdate
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_low_stock
from app.services.sequences import next_document_number
from app.services.pdf_helpers import (
    BODY_RIGHT, MARGIN, draw_header, draw_info_block, draw_item_table,
    draw_notes, draw_signoff, draw_totals, new_canvas, render_pdf,
)
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/cycle-counts", tags=["cycle-counts"], dependencies=[Depends(get_current_user)])


def _load_cc(db: Session, cc_id: int) -> CycleCount:
    return get_or_404(CycleCount, cc_id, db, options=[
        joinedload(CycleCount.items).joinedload(CycleCountItem.product),
        joinedload(CycleCount.location), joinedload(CycleCount.creator),
    ])


@router.get("")
def list_cycle_counts(
    status: str | None = None,
    location_id: int | None = None,
    has_variance: bool | None = None,
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    q = db.query(CycleCount).options(joinedload(CycleCount.items), joinedload(CycleCount.location))
    if status:
        q = q.filter(CycleCount.status == status)
    if location_id:
        q = q.filter(CycleCount.location_id == location_id)
    if search:
        like = f"%{search}%"
        q = q.join(CycleCount.location, isouter=True).filter(
            CycleCount.cc_number.ilike(like) | Location.name.ilike(like) | CycleCount.notes.ilike(like)
        )
    counts = q.order_by(CycleCount.created_at.desc()).all()
    if has_variance is not None:
        counts = [c for c in counts if c.has_variance == has_variance]
    total = len(counts)
    items = counts[skip:skip + limit]
    return {"items": [CycleCountOut.model_validate(c) for c in items], "total": total,
            "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/{cc_id}", response_model=CycleCountOut)
def get_cycle_count(cc_id: int, db: Session = Depends(get_db)):
    return _load_cc(db, cc_id)


@router.get("/{cc_id}/pdf")
def cycle_count_pdf(cc_id: int, db: Session = Depends(get_db)):
    cc = _load_cc(db, cc_id)
    s = db.query(Settings).first()

    store_name = (s.store_name if s else None) or "My Store"
    store_lines = [store_name] + [ln for ln in (
        (s.address if s else None),
        (s.phone if s else None),
        (s.email if s else None),
    ) if ln]

    c, buf = new_canvas(f"Cycle Count {cc.cc_number}")
    meta = [
        ("CC #:", cc.cc_number),
        ("Date:", cc.created_at.strftime("%b %d, %Y")),
        ("Status:", cc.status),
        ("Created by:", cc.username or "\u2014"),
    ]
    body_y = draw_header(c, "CYCLE COUNT", meta, store_lines)

    info_y = draw_info_block(c, MARGIN, body_y, "Location", [cc.location_name or "\u2014"])

    headers = ["Product", "Expected", "Counted", "Variance", "Status"]
    aligns = ["l", "r", "r", "r", "l"]
    col_widths = [224.0, 70.0, 70.0, 70.0, 70.0]
    rows = []
    for item in cc.items:
        name = item.product_name or f"Product #{item.product_id}"
        rows.append([
            (name[:52] + "\u2026") if len(name) > 52 else name,
            str(item.expected_qty),
            str(item.counted_qty) if item.counted_qty is not None else "\u2014",
            f"{item.variance:+d}",
            item.status,
        ])

    y = draw_item_table(
        c, MARGIN, info_y, headers, aligns, col_widths, rows,
        on_page_break=lambda c: draw_header(c, "CYCLE COUNT", meta, store_lines),
    )

    y = draw_totals(c, BODY_RIGHT, y, [
        ("Total Expected", f"{cc.total_expected} unit(s)"),
        ("Total Variance", f"{cc.total_variance:+d}"),
    ])

    if cc.notes:
        draw_notes(c, MARGIN, y, cc.notes)
        y -= 18

    draw_signoff(c, y, "Inventory count sheet")
    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={cc.cc_number}.pdf"
    })


@router.post("", response_model=CycleCountOut, status_code=201)
def create_cycle_count(data: CycleCountCreate, db: Session = Depends(get_db), user=Depends(require_permission("cycle_counts.create"))):
    if data.location_id is None:
        raise HTTPException(status_code=400, detail="A location is required for a cycle count")
    get_or_404(Location, data.location_id, db)
    cc = CycleCount(
        cc_number=next_document_number(db, "cycle_count", "CC-"),
        location_id=data.location_id,
        created_by=user.id,
        notes=data.notes,
    )
    db.add(cc)
    db.flush()
    for item in data.items:
        product = get_or_404(Product, item.product_id, db)
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"'{product.display_name}' is inactive")
        expected_qty = inventory.on_hand(db, product_id=item.product_id, location_id=data.location_id)
        db.add(CycleCountItem(
            cycle_count_id=cc.id,
            product_id=item.product_id,
            expected_qty=expected_qty,
        ))
    db.commit()
    cc = _load_cc(db, cc.id)
    log_activity(db, user.id, user.username, "create", "cycle_count", cc.id, f"Created cycle count '{cc.cc_number}'")
    db.commit()
    broadcast_change("cycle_count", "created")
    return cc


@router.put("/{cc_id}", response_model=CycleCountOut)
def update_cycle_count(cc_id: int, data: CycleCountUpdate, db: Session = Depends(get_db), user=Depends(require_permission("cycle_counts.update"))):
    cc = _load_cc(db, cc_id)
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in ("pending", "in_progress", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status (allowed: pending, in_progress, cancelled)")
    if updates.get("status") == "cancelled" and cc.status == "completed":
        raise HTTPException(status_code=400, detail="Completed counts cannot be cancelled")
    for k, v in updates.items():
        setattr(cc, k, v)
    db.commit()
    cc = _load_cc(db, cc.id)
    log_activity(db, user.id, user.username, "update", "cycle_count", cc.id, f"Updated cycle count '{cc.cc_number}' (status={cc.status})")
    db.commit()
    broadcast_change("cycle_count", "updated")
    return cc


@router.post("/{cc_id}/submit", response_model=CycleCountOut)
def submit_cycle_count(cc_id: int, data: CycleCountSubmit, db: Session = Depends(get_db), user=Depends(require_permission("cycle_counts.count"))):
    cc = _load_cc(db, cc_id)
    if cc.location_id is None:
        raise HTTPException(status_code=400, detail="This cycle count has no location and cannot be submitted")
    if cc.status == "completed":
        raise HTTPException(status_code=400, detail="Cycle count is already completed")
    if cc.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot submit a cancelled cycle count")

    by_product = {item.product_id: item for item in cc.items}
    on_hand_at_submit = {
        item.product_id: inventory.on_hand(db, product_id=item.product_id, location_id=cc.location_id)
        for item in cc.items
    }
    try:
        for line in data.items:
            item = by_product.get(line.product_id)
            if item is None:
                raise HTTPException(status_code=400, detail=f"Product {line.product_id} is not on this cycle count")
            product = get_or_404(Product, item.product_id, db)
            prev_variance = item.variance
            new_variance = line.counted_qty - item.expected_qty
            delta = new_variance - prev_variance
            item.counted_qty = line.counted_qty
            item.variance = new_variance
            item.status = "ok" if new_variance == 0 else "mismatch"
            if delta == 0:
                continue
            if product.is_serialized:
                if new_variance > 0:
                    raise HTTPException(status_code=400, detail=(
                        f"Overage of {new_variance} cannot be posted for serialized '{product.display_name}'. "
                        "Register the extra serial number(s) before counting."
                    ))
                if delta > 0:
                    raise HTTPException(status_code=400, detail=(
                        f"Counted quantity for serialized '{product.display_name}' cannot be increased "
                        "after a shortage was posted."
                    ))
                inventory.scrap_serials(
                    db, product_id=item.product_id, user_id=user.id,
                    location_id=cc.location_id, quantity=-delta,
                    reference=f"Cycle count {cc.cc_number}",
                    notes=f"Counted {line.counted_qty}, expected {item.expected_qty}",
                )
                notify_low_stock(db, product)
            else:
                inventory.count_adjustment(
                    db, product_id=item.product_id, user_id=user.id,
                    variance=delta, location_id=cc.location_id,
                    reference=f"Cycle count {cc.cc_number}",
                    notes=f"Counted {line.counted_qty}, expected {item.expected_qty}",
                )
                notify_low_stock(db, product)
    except inventory.InventoryError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    if all(i.counted_qty is not None for i in cc.items):
        cc.status = "completed"
        cc.completed_at = datetime.now(timezone.utc)
    else:
        cc.status = "in_progress"

    db.commit()
    cc = _load_cc(db, cc.id)
    log_activity(db, user.id, user.username, "complete", "cycle_count", cc.id,
                 f"Completed cycle count '{cc.cc_number}' (variance {cc.total_variance:+d})")
    db.commit()
    for item in cc.items:
        item.current_on_hand = on_hand_at_submit.get(item.product_id)
    broadcast_change("cycle_count", "updated")
    broadcast_change("stock_movement", "created")
    broadcast_change("product", "updated")
    broadcast_change("location", "updated")
    return cc
