import csv
import io
import json
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal, Optional
from sqlalchemy import String, case, cast, exists, func, select
from sqlalchemy.orm import Session, joinedload, aliased
from app.constants import MAX_PAGE_SIZE_PRODUCTS
from app.database import get_db
from app.models.category import Category
from app.models.location import Location
from app.models.lot import Lot
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.models.stock_line import StockLine
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.models.work_order import WorkOrder, WorkOrderItem
from app.schemas.product import ProductCreate, ProductOut, ProductUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services import expiry as expiry_svc
from app.services import inventory
from app.services.auth import require_permission
from app.services.filters import apply_date_range, apply_numeric_range, parse_date
from app.services.notify import notify_expiring, notify_low_stock
from app.services.soft_delete import register, soft_delete
from app.utils import get_or_404, log_activity, broadcast_change, read_upload_text

from reportlab.graphics import renderPDF
from reportlab.lib.units import inch
from svglib.svglib import svg2rlg

import barcode as pybarcode
from barcode.writer import SVGWriter

from app.services.pdf_helpers import FONT, BOLD, INK, MONO, MUTED, FAINT, PAGE_H, PAGE_W, money, new_canvas, render_pdf

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/api/products", tags=["products"], dependencies=[Depends(require_permission("products.view"))])


def _purge_product(db: Session, p: Product, user) -> None:
    has_stock = db.query(StockLine).filter(StockLine.product_id == p.id).first() is not None
    if has_stock:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a product that has stock on hand")
    has_lots = db.query(Lot).filter(Lot.product_id == p.id).first() is not None
    if has_lots:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a product with lot history")
    has_serials = db.query(SerialNumber).filter(SerialNumber.product_id == p.id).first() is not None
    if has_serials:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a product with serial number history")
    has_movements = db.query(StockMovement).filter(StockMovement.product_id == p.id).first() is not None
    if has_movements:
        raise HTTPException(status_code=400, detail="Cannot permanently delete a product with movement history")
    db.delete(p)


register("product", Product, lambda p: p.display_name, _purge_product)

PRODUCT_SORT_COLUMNS = {"name", "sku", "unit_price", "cost_price", "quantity", "reorder_level", "created_at", "updated_at", "category_name", "supplier_name"}


def _effective_location(product: Product) -> str:
    """Return the location path derived from actual stock lines, falling back to the stored default."""
    stock_lines = product.stock_lines
    from collections import Counter
    loc_qty: Counter = Counter()
    for sl in stock_lines:
        if sl.location_id:
            loc_qty[sl.location_id] += sl.quantity
    if loc_qty:
        best_loc_id = loc_qty.most_common(1)[0][0]
        loc = next((sl.location for sl in stock_lines if sl.location_id == best_loc_id and sl.location), None)
        if loc:
            return loc.path
    if product.location_id and product.default_location:
        return product.default_location.path
    return product.location or ""


def _set_expiry(out: ProductOut, orm: Product, lot_dates: dict[int, list[date]], today: date) -> None:
    """Fill a ProductOut row's effective expiry from its static date and lots."""
    eff, days = expiry_svc.effective_expiry(today, orm.expiry_date, lot_dates.get(orm.id, []))
    out.effective_expiry_date = eff
    out.expiry_days_left = days


def _fold_group_expiry(out: ProductOut, variant_dates: list[date], today: date) -> None:
    """Aggregate a parent row's expiry over its own date and its active variants."""
    candidates = list(variant_dates)
    if out.effective_expiry_date:
        candidates.append(out.effective_expiry_date)
    eff = min(candidates)
    out.effective_expiry_date = eff
    out.expiry_days_left = (eff - today).days


def validate_refs(db: Session, category_id: Optional[int], supplier_id: Optional[int]) -> None:
    if category_id is not None and not db.query(Category).filter(Category.id == category_id).first():
        raise HTTPException(status_code=400, detail=f"Category {category_id} does not exist")
    if supplier_id is not None and not db.query(Supplier).filter(Supplier.id == supplier_id).first():
        raise HTTPException(status_code=400, detail=f"Supplier {supplier_id} does not exist")


def validate_location_ref(db: Session, location_id: Optional[int]) -> None:
    if location_id is not None and not db.query(Location).filter(Location.id == location_id).first():
        raise HTTPException(status_code=400, detail=f"Location {location_id} does not exist")


def _normalize_path(text: str) -> str:
    """Collapse runs of whitespace and lower-case a location path/code so
    matching is robust to inconsistent spacing (e.g. "Zone   A" vs "Zone A")."""
    return " ".join(text.split()).lower()


def resolve_location(db: Session, location_id: Optional[int], location_text: Optional[str]) -> Optional[int]:
    """Resolve the effective location id for a product: prefer an explicit id,
    otherwise match the free-text location field against a location path
    (case-insensitive, whitespace-normalized). Returns None when nothing matches,
    so callers can fall back or surface a helpful error."""
    if location_id is not None:
        return location_id
    text = (location_text or "").strip()
    if not text:
        return None
    norm = _normalize_path(text)
    # Location.path is a computed property (parent-name chain), so it cannot be
    # matched in SQL; the in-Python path comparison below is the single source
    # of truth.
    for loc in db.query(Location).all():
        if _normalize_path(loc.path) == norm:
            return loc.id
    return None


@router.get("")
def list_products(
    search: str = "", category_id: int | None = None,
    sort_by: str = "name", sort_dir: str = "asc",
    skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_PRODUCTS),
    active_only: bool = False,
    expiry: Literal["", "expired", "expiring"] = "",
    low_stock: bool = False,
    include_variants: bool = False,
    menu_only: bool = False,
    created_after: str | None = None,
    created_before: str | None = None,
    expiry_after: str | None = None,
    expiry_before: str | None = None,
    price_min: str | None = None,
    price_max: str | None = None,
    cost_min: str | None = None,
    cost_max: str | None = None,
    stock_min: str | None = None,
    stock_max: str | None = None,
    db: Session = Depends(get_db),
):
    if sort_by not in PRODUCT_SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {sorted(PRODUCT_SORT_COLUMNS)}")
    if sort_dir not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="sort_dir must be 'asc' or 'desc'")
    inventory.expire_overdue_lots(db)
    options = [
        joinedload(Product.category), joinedload(Product.supplier), joinedload(Product.default_location),
        joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.stock_lines).joinedload(StockLine.lot),
    ]
    if include_variants:
        options.append(joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location))
        options.append(joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.lot))
    q = db.query(Product).options(*options).filter(Product.parent_id.is_(None), Product.is_deleted == False)  # noqa: E712
    if active_only:
        q = q.filter(Product.is_active == True)
    if menu_only:
        q = q.filter(Product.is_menu_item == True)
    if search:
        like = f"%{search}%"
        if include_variants:
            q = q.filter(
                Product.name.ilike(like) | Product.sku.ilike(like) | Product.barcode.ilike(like)
                | Product.variants.any(Product.name.ilike(like) | Product.sku.ilike(like) | Product.barcode.ilike(like) | cast(Product.attributes, String).ilike(like))
            )
        else:
            q = q.filter(Product.name.ilike(like) | Product.sku.ilike(like) | Product.barcode.ilike(like))
    if category_id:
        q = q.filter(Product.category_id == category_id)
    today = date.today()
    if expiry == "expired":
        # Agree with the red/E badges: expired-lot stock (bulk + serialized) OR
        # a static expiry_date that has passed. Lot-aware and variant-aware so a
        # serialized product expiring via its lots shows up too.
        condition = expiry_svc.expired_condition(Product.id, today)
        if include_variants:
            condition = condition | Product.id.in_(
                select(Product.parent_id).where(
                    Product.parent_id.isnot(None), Product.is_active == True,  # noqa: E712
                    expiry_svc.expired_condition(Product.id, today),
                )
            )
        q = q.filter(condition)
    elif expiry == "expiring":
        # Settings-driven window, lot-aware (bulk + serialized), requiring
        # sellable stock -- mirrors the amber badge.
        soon = today + timedelta(days=expiry_svc.warning_window(db))
        condition = expiry_svc.expiring_condition(Product.id, today, soon)
        if include_variants:
            condition = condition | Product.id.in_(
                select(Product.parent_id).where(
                    Product.parent_id.isnot(None), Product.is_active == True,  # noqa: E712
                    expiry_svc.expiring_condition(Product.id, today, soon),
                )
            )
        q = q.filter(condition)
    if low_stock:
        # match the dashboard definition: active, sellable stock at or below reorder
        sellable = inventory.sellable_qty_subquery()
        q = q.filter(Product.is_active == True)
        if include_variants:
            low_variant_parent_ids = select(Product.parent_id).where(
                Product.parent_id.isnot(None),
                Product.is_active == True,
                inventory.sellable_qty_subquery() <= Product.reorder_level,
            )
            q = q.filter(
                (Product.id.notin_(Product.variant_parent_id_subquery()) & (sellable <= Product.reorder_level))
                | Product.id.in_(low_variant_parent_ids)
            )
        else:
            q = q.filter(sellable <= Product.reorder_level)
            # Exclude parents whose stock lives on their variants
            q = q.filter(Product.id.notin_(Product.variant_parent_id_subquery()))
    q = apply_date_range(q, Product.created_at, created_after, created_before, label="created")
    if expiry_after or expiry_before:
        after = parse_date(expiry_after, "expiry after").date() if expiry_after else None
        before = parse_date(expiry_before, "expiry before").date() if expiry_before else None
        cond = expiry_svc.expiry_range_condition(Product.id, after, before)
        if include_variants:
            # A parent's displayed expiry folds in its active variants, so the
            # parent also matches when any active variant is in range.
            cond = cond | Product.id.in_(
                select(Product.parent_id).where(
                    Product.parent_id.isnot(None), Product.is_active == True,  # noqa: E712
                    expiry_svc.expiry_range_condition(Product.id, after, before),
                )
            )
        q = q.filter(cond)
    q = apply_numeric_range(q, Product.unit_price, price_min, price_max, label="price")
    q = apply_numeric_range(q, Product.cost_price, cost_min, cost_max, label="cost")
    q = apply_numeric_range(q, Product.quantity, stock_min, stock_max, label="stock")
    total = q.count()
    if sort_by in ("category_name", "supplier_name"):
        relation = Product.category if sort_by == "category_name" else Product.supplier
        label_col = Category.name if sort_by == "category_name" else Supplier.name
        q = q.join(relation, isouter=True)
        if sort_dir == "asc":
            q = q.order_by(label_col.asc().nulls_last())
        else:
            q = q.order_by(label_col.desc().nulls_last())
    else:
        if sort_by == "quantity" and include_variants:
            V = aliased(Product)
            variant_sum = select(func.coalesce(func.sum(V.quantity), 0)).where(
                V.parent_id == Product.id, V.is_active == True
            )
            has_variants = exists().where(V.parent_id == Product.id, V.is_active == True)
            qty_sort_col = case((has_variants, variant_sum), else_=Product.quantity)
            q = q.order_by(qty_sort_col.asc() if sort_dir == "asc" else qty_sort_col.desc())
        else:
            col = getattr(Product, sort_by, Product.name)
            q = q.order_by(col.asc() if sort_dir == "asc" else col.desc())
    items = q.offset(skip).limit(limit).all()
    ids: list[int] = []
    for p in items:
        ids.append(p.id)
        if include_variants and p.variants:
            ids.extend(v.id for v in p.variants)
    lot_dates = expiry_svc.lot_expiry_dates_by_product(db, ids)
    quarantined = inventory.quarantined_qty_by_product(db, ids) if ids else {}
    expired = inventory.expired_lot_qty_by_product(db, ids) if ids else {}
    sellable = inventory.sellable_qty_by_product(db, ids) if ids else {}
    reserved = inventory.reserved_qty_by_product(db, ids) if ids else {}
    results = []
    for p in items:
        out = ProductOut.model_validate(p)
        out.location = _effective_location(p)
        _set_expiry(out, p, lot_dates, today)
        if include_variants and p.variants and out.variants:
            variant_dates: list[date] = []
            for v_orm, v_out in zip(p.variants, out.variants):
                v_out.location = _effective_location(v_orm)
                _set_expiry(v_out, v_orm, lot_dates, today)
                if v_orm.is_active and v_out.effective_expiry_date:
                    variant_dates.append(v_out.effective_expiry_date)
            if variant_dates:
                _fold_group_expiry(out, variant_dates, today)
        results.append(out)
    for p in results:
        p.quarantined_qty = quarantined.get(p.id, 0)
        p.expired_lot_qty = expired.get(p.id, 0)
        p.sellable_qty = sellable.get(p.id, 0)
        p.reserved_qty = reserved.get(p.id, 0)
        if include_variants and p.variants:
            for v in p.variants:
                v.quarantined_qty = quarantined.get(v.id, 0)
                v.expired_lot_qty = expired.get(v.id, 0)
                v.sellable_qty = sellable.get(v.id, 0)
                v.reserved_qty = reserved.get(v.id, 0)
    return {"items": results, "total": total, "page": (skip // limit) + 1 if limit else 1, "pages": max(ceil(total / limit), 1) if limit else 1}


class BulkEditRequest(BaseModel):
    ids: list[int]
    supplier_id: Optional[int] = None
    category_id: Optional[int] = None
    reorder_level: Optional[int] = None


@router.patch("/bulk-edit")
def bulk_edit_products(data: BulkEditRequest, db: Session = Depends(get_db), user=Depends(require_permission("products.bulk"))):
    validate_refs(db, data.category_id, data.supplier_id)
    products = db.query(Product).filter(Product.id.in_(data.ids), Product.is_deleted == False).all()
    if not products:
        raise HTTPException(status_code=404, detail="No products found")
    updates = {}
    if data.supplier_id is not None:
        updates["supplier_id"] = data.supplier_id
    if data.category_id is not None:
        updates["category_id"] = data.category_id
    if data.reorder_level is not None:
        updates["reorder_level"] = data.reorder_level
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    for p in products:
        for k, v in updates.items():
            setattr(p, k, v)
        if not p.is_variant:
            sync = {k: v for k, v in updates.items() if k in ("category_id", "supplier_id")}
            if sync:
                db.query(Product).filter(Product.parent_id == p.id).update(sync, synchronize_session=False)
    db.commit()
    log_activity(db, user.id, user.username, "update", "product", None,
                 f"Bulk-edited {len(products)} product(s): {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("product", "updated")
    return {"updated": len(products), "fields": list(updates.keys())}


@router.get("/barcode-labels")
def barcode_labels(ids: str = "", db: Session = Depends(get_db)):
    q = db.query(Product).filter(Product.is_active == True)
    if ids:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        if id_list:
            # Selecting a parent product also prints labels for its active variants,
            # matching the "print all" behavior which already includes variants.
            selected = db.query(Product).filter(Product.id.in_(id_list)).all()
            ids_to_print = set(id_list)
            for p in selected:
                if p.variants:
                    ids_to_print.update(v.id for v in p.variants if v.is_active)
            q = q.filter(Product.id.in_(ids_to_print))
    products = q.order_by(Product.name).all()

    s = db.query(Settings).first()
    currency = (s.currency_symbol if s else "$") or "$"

    MARGIN_X, MARGIN_Y = 0.5 * inch, 0.5 * inch
    COLS, ROWS = 3, 8
    GAP_X, GAP_Y = 0.25 * inch, 0.125 * inch

    cols = min(COLS, max(len(products), 1))
    col_width = (PAGE_W - 2 * MARGIN_X - (cols - 1) * GAP_X) / cols
    row_height = (PAGE_H - 2 * MARGIN_Y - (ROWS - 1) * GAP_Y) / ROWS

    c, buf = new_canvas("Product Barcode Labels")

    for idx, p in enumerate(products):
        pos_in_page = idx % (COLS * ROWS)
        col = pos_in_page % COLS
        row = pos_in_page // COLS

        if pos_in_page == 0 and idx > 0:
            c.showPage()
            c.setTitle("Product Barcode Labels")

        x = MARGIN_X + col * (col_width + GAP_X)
        y = PAGE_H - MARGIN_Y - (row + 1) * row_height - row * GAP_Y

        c.setStrokeColor(FAINT)
        c.setLineWidth(0.75)
        c.rect(x, y, col_width, row_height)

        name = (p.display_name[:30] + "\u2026") if len(p.display_name) > 30 else p.display_name
        sku = p.sku or ""
        price = money(currency, p.unit_price) if p.unit_price else ""
        line_y = y + row_height - 12
        c.setFont(BOLD, 8)
        c.setFillColor(INK)
        c.drawString(x + 6, line_y, name)
        if price:
            c.drawRightString(x + col_width - 6, line_y, price)
        c.setFont(MONO, 6.5)
        c.setFillColor(MUTED)
        c.drawString(x + 6, line_y - 11, sku)

        barcode_val = p.barcode or p.sku
        try:
            code = pybarcode.get("code128", barcode_val, writer=SVGWriter())
            svg_bytes = code.render()
            drawing = svg2rlg(io.BytesIO(svg_bytes))
            bw = col_width * 0.62
            scale = min(bw / drawing.width, row_height * 0.42 / drawing.height)
            drawing.scale(scale, scale)
            bw_scaled = drawing.width * scale
            bx = x + (col_width - bw_scaled) / 2
            by = y + (row_height * 0.42 - drawing.height * scale) / 2 + 2
            renderPDF.draw(drawing, c, bx, by)
        except Exception:
            c.setFont(FONT, 5)
            c.setFillColor(MUTED)
            c.drawCentredString(x + col_width / 2, y + 12, "[no barcode]")

    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": "inline; filename=barcode-labels.pdf"
    })


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    p = get_or_404(Product, product_id, db, options=[
        joinedload(Product.category), joinedload(Product.supplier),
        joinedload(Product.default_location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.lot),
        joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.stock_lines).joinedload(StockLine.lot),
    ])
    out = ProductOut.model_validate(p)
    out.location = _effective_location(p)
    ids = [p.id] + [v.id for v in p.variants]
    lot_dates = expiry_svc.lot_expiry_dates_by_product(db, ids)
    today = date.today()
    quarantined = inventory.quarantined_qty_by_product(db, ids)
    expired = inventory.expired_lot_qty_by_product(db, ids)
    sellable = inventory.sellable_qty_by_product(db, ids)
    reserved = inventory.reserved_qty_by_product(db, ids)
    if p.variants and out.variants:
        # A parent's derived stock fields aggregate its active variants so the
        # group renders a single coherent picture on the product detail screen.
        quarantined[p.id] = quarantined.get(p.id, 0) + sum(
            quarantined.get(v.id, 0) for v in p.variants if v.is_active
        )
        expired[p.id] = expired.get(p.id, 0) + sum(
            expired.get(v.id, 0) for v in p.variants if v.is_active
        )
        sellable[p.id] = sellable.get(p.id, 0) + sum(
            sellable.get(v.id, 0) for v in p.variants if v.is_active
        )
        reserved[p.id] = reserved.get(p.id, 0) + sum(
            reserved.get(v.id, 0) for v in p.variants if v.is_active
        )
        for v_orm, v_out in zip(p.variants, out.variants):
            v_out.location = _effective_location(v_orm)
            _set_expiry(v_out, v_orm, lot_dates, today)
            v_out.quarantined_qty = quarantined.get(v_orm.id, 0)
            v_out.expired_lot_qty = expired.get(v_orm.id, 0)
            v_out.sellable_qty = sellable.get(v_orm.id, 0)
            v_out.reserved_qty = reserved.get(v_orm.id, 0)
    _set_expiry(out, p, lot_dates, today)
    if p.variants and out.variants:
        variant_expiries = [v_out.effective_expiry_date for v_out in out.variants if v_out.is_active and v_out.effective_expiry_date]
        if variant_expiries:
            _fold_group_expiry(out, variant_expiries, today)
    out.quarantined_qty = quarantined.get(p.id, 0)
    out.expired_lot_qty = expired.get(p.id, 0)
    out.sellable_qty = sellable.get(p.id, 0)
    out.reserved_qty = reserved.get(p.id, 0)
    return out


@router.get("/barcode/{barcode}", response_model=ProductOut)
def get_product_by_barcode(barcode: str, db: Session = Depends(get_db)):
    p = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier),
        joinedload(Product.default_location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.lot),
        joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.stock_lines).joinedload(StockLine.lot),
    ).filter(func.lower(Product.barcode) == barcode.lower(), Product.is_active == True).first()
    if not p:
        p = db.query(Product).options(
            joinedload(Product.category), joinedload(Product.supplier),
            joinedload(Product.default_location),
            joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location),
            joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.lot),
            joinedload(Product.stock_lines).joinedload(StockLine.location),
            joinedload(Product.stock_lines).joinedload(StockLine.lot),
        ).filter(func.lower(Product.sku) == barcode.lower(), Product.is_active == True).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    out = ProductOut.model_validate(p)
    out.location = _effective_location(p)
    ids = [p.id] + [v.id for v in p.variants]
    lot_dates = expiry_svc.lot_expiry_dates_by_product(db, ids)
    today = date.today()
    quarantined = inventory.quarantined_qty_by_product(db, ids)
    expired = inventory.expired_lot_qty_by_product(db, ids)
    sellable = inventory.sellable_qty_by_product(db, ids)
    reserved = inventory.reserved_qty_by_product(db, ids)
    if p.variants and out.variants:
        # A parent's derived stock fields aggregate its active variants so the
        # group renders a single coherent picture on the product detail screen.
        quarantined[p.id] = quarantined.get(p.id, 0) + sum(
            quarantined.get(v.id, 0) for v in p.variants if v.is_active
        )
        expired[p.id] = expired.get(p.id, 0) + sum(
            expired.get(v.id, 0) for v in p.variants if v.is_active
        )
        sellable[p.id] = sellable.get(p.id, 0) + sum(
            sellable.get(v.id, 0) for v in p.variants if v.is_active
        )
        reserved[p.id] = reserved.get(p.id, 0) + sum(
            reserved.get(v.id, 0) for v in p.variants if v.is_active
        )
        for v_orm, v_out in zip(p.variants, out.variants):
            v_out.location = _effective_location(v_orm)
            _set_expiry(v_out, v_orm, lot_dates, today)
            v_out.quarantined_qty = quarantined.get(v_orm.id, 0)
            v_out.expired_lot_qty = expired.get(v_orm.id, 0)
            v_out.sellable_qty = sellable.get(v_orm.id, 0)
            v_out.reserved_qty = reserved.get(v_orm.id, 0)
    _set_expiry(out, p, lot_dates, today)
    if p.variants and out.variants:
        variant_expiries = [v_out.effective_expiry_date for v_out in out.variants if v_out.is_active and v_out.effective_expiry_date]
        if variant_expiries:
            _fold_group_expiry(out, variant_expiries, today)
    out.quarantined_qty = quarantined.get(p.id, 0)
    out.expired_lot_qty = expired.get(p.id, 0)
    out.sellable_qty = sellable.get(p.id, 0)
    out.reserved_qty = reserved.get(p.id, 0)
    return out


@router.post("", response_model=ProductOut, status_code=201)
def create_product(data: ProductCreate, db: Session = Depends(get_db), user=Depends(require_permission("products.create"))):
    validate_refs(db, data.category_id, data.supplier_id)
    validate_location_ref(db, data.location_id)
    if db.query(Product).filter(Product.sku == data.sku).first():
        raise HTTPException(status_code=400, detail="SKU already exists")
    parent = None
    if data.parent_id is not None:
        parent = get_or_404(Product, data.parent_id, db)
        if parent.parent_id is not None:
            raise HTTPException(status_code=400, detail="Cannot add a variant to another variant")
        if parent.is_serialized:
            raise HTTPException(status_code=400, detail="Cannot create variants for a serialized product")
    if data.is_serialized and data.quantity > 0:
        raise HTTPException(status_code=400, detail="Serialized products cannot have an opening quantity - use receipts to receive stock")
    if data.is_serialized and parent is not None:
        parent_has_stock = (
            db.query(StockLine)
            .filter(StockLine.product_id == parent.id, StockLine.quantity > 0)
            .first()
        )
        if parent_has_stock is not None:
            raise HTTPException(
                status_code=400,
                detail="Cannot create a serialized variant for a product with existing stock - serials must be registered individually, so clear the parent's stock first",
            )
    payload = data.model_dump()
    payload["location_id"] = resolve_location(db, payload.get("location_id"), payload.get("location"))
    if payload.get("reorder_level") is None:
        s = db.query(Settings).first()
        payload["reorder_level"] = s.default_reorder_level if s else 10
    if parent is not None:
        if not (payload.get("name") or "").strip():
            payload["name"] = parent.name
        payload["category_id"] = parent.category_id
        payload["supplier_id"] = parent.supplier_id
        if not payload.get("location_id") and not (payload.get("location") or "").strip():
            payload["location_id"] = parent.location_id
            payload["location"] = parent.location or ""
        if payload.get("attributes") is None:
            payload["attributes"] = {}
        attrs = payload["attributes"]
        dup = db.query(Product).filter(Product.parent_id == parent.id, Product.is_active == True).all()
        for v in dup:
            if (v.attributes or {}) == attrs:
                raise HTTPException(status_code=400, detail="A variant with these attributes already exists")
    loc_id = payload.get("location_id")
    if loc_id is None:
        raise HTTPException(status_code=400, detail="A location is required when creating a product")
    loc = db.get(Location, loc_id)
    if loc is None or not loc.is_active:
        raise HTTPException(status_code=400, detail=f"Location '{loc.path if loc else ''}' must be active - it is not available")
    p = Product(**payload)
    db.add(p)
    db.flush()
    transfer_qty = 0
    if parent is not None:
        parent_lines = (
            db.query(StockLine)
            .filter(StockLine.product_id == parent.id, StockLine.quantity > 0)
            .order_by(StockLine.id)
            .all()
        )
        for line in parent_lines:
            inventory.post_journal_entry(
                db, product_id=parent.id, user_id=user.id,
                quantity_change=-line.quantity, movement_type="out",
                from_location_id=line.location_id, lot_id=line.lot_id, lpn_id=line.lpn_id,
                reference=f"Stock transfer to {p.sku}",
                notes="Parent stock carried over to new variant",
            )
            transfer_qty += line.quantity
    total_initial = data.quantity + max(transfer_qty, 0)
    if total_initial > 0:
        inventory.post_journal_entry(
            db, product_id=p.id, user_id=user.id,
            quantity_change=total_initial, movement_type="in",
            to_location_id=payload.get("location_id"),
            reference="Initial stock" + (" (incl. parent transfer)" if transfer_qty > 0 else ""),
            notes="Opening balance" + ("; stock carried over from parent" if transfer_qty > 0 else ""),
        )
    db.commit()
    db.refresh(p)
    log_activity(db, user.id, user.username, "create", "product", p.id, f"Created product '{p.display_name}' ({p.sku})")
    notify_low_stock(db, p)
    notify_expiring(db, p)
    db.commit()
    broadcast_change("product", "created")
    broadcast_change("stock_movement", "created")
    return p


@router.put("/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db), user=Depends(require_permission("products.update"))):
    p = get_or_404(Product, product_id, db, options=[joinedload(Product.category), joinedload(Product.supplier)])
    updates = data.model_dump(exclude_unset=True)
    validate_refs(db, updates.get("category_id"), updates.get("supplier_id"))
    validate_location_ref(db, updates.get("location_id"))
    if updates.get("sku"):
        existing_sku = db.query(Product).filter(
            Product.sku == updates["sku"], Product.id != product_id
        ).first()
        if existing_sku:
            raise HTTPException(status_code=400, detail="SKU already exists")
    if "location" in updates or "location_id" in updates:
        new_loc_id = resolve_location(db, updates.get("location_id"), updates.get("location"))
        if new_loc_id is None:
            raise HTTPException(status_code=400, detail="A location is required for a product - set a valid location")
        loc = db.get(Location, new_loc_id)
        if loc is None or not loc.is_active:
            raise HTTPException(status_code=400, detail=f"Location must be active - '{loc.path if loc else ''}' is not available")
        updates["location_id"] = new_loc_id
    if "is_serialized" in updates and updates["is_serialized"] != p.is_serialized:
        if p.is_serialized:
            has_serials = db.query(SerialNumber).filter(SerialNumber.product_id == p.id).first() is not None
            if has_serials:
                raise HTTPException(status_code=400, detail="Cannot disable serialization - serial numbers are registered for this product")
        else:
            has_variants = db.query(Product).filter(Product.parent_id == p.id, Product.is_active == True).first() is not None
            if has_variants:
                raise HTTPException(status_code=400, detail="Products with variants cannot be serialized")
            if p.quantity != 0:
                raise HTTPException(status_code=400, detail="Serialized products must have zero quantity - use receipts to receive stock")
    if p.is_variant:
        if updates.get("parent_id") is not None and updates["parent_id"] != p.parent_id:
            raise HTTPException(status_code=400, detail="Cannot move a variant to another product")
        updates.pop("parent_id", None)
        if "attributes" in updates:
            attrs = updates["attributes"] or {}
            dup = db.query(Product).filter(
                Product.parent_id == p.parent_id, Product.id != p.id, Product.is_active == True
            ).all()
            for v in dup:
                if (v.attributes or {}) == attrs:
                    raise HTTPException(status_code=400, detail="A variant with these attributes already exists")
    else:
        if updates.get("parent_id") is not None:
            raise HTTPException(status_code=400, detail="A parent product cannot be converted into a variant")
        updates.pop("parent_id", None)
        if "quantity" in updates and updates["quantity"] != 0:
            has_variants = db.query(Product).filter(Product.parent_id == p.id, Product.is_active == True).first() is not None
            if has_variants:
                raise HTTPException(status_code=400, detail="Products with variants hold stock on their variants, not on the parent")
    old_quantity = p.quantity
    old_name = p.name
    old_location_id = p.location_id
    old_active = p.is_active
    variant_active_before: dict[int, bool] = {}
    if not p.is_variant and "is_active" in updates:
        variant_active_before = {v.id: v.is_active for v in p.variants}
    for k, v in updates.items():
        setattr(p, k, v)
    if not p.is_variant:
        sync = {k: v for k, v in updates.items() if k in ("name", "category_id", "supplier_id", "is_active")}
        if sync:
            q = db.query(Product).filter(Product.parent_id == p.id)
            if "name" in sync:
                q = q.filter(Product.name == old_name)
            q.update(sync, synchronize_session=False)
    if "is_active" in updates and updates["is_active"] != old_active:
        if old_active and not p.is_active:
            inventory.deactivate_serials(
                db, product_id=p.id, user_id=user.id,
                reference=f"Product '{p.display_name}' deactivated",
                notes="Product set inactive",
            )
        elif not old_active and p.is_active:
            inventory.reactivate_serials(
                db, product_id=p.id, user_id=user.id,
                reference=f"Product '{p.display_name}' reactivated",
                notes="Product set active",
            )
        # A parent toggle cascades is_active to its variants; flag their serials too.
        for vid, was_active in variant_active_before.items():
            if was_active == p.is_active:
                continue
            if p.is_active:
                inventory.reactivate_serials(
                    db, product_id=vid, user_id=user.id,
                    reference=f"Variant reactivated via parent '{p.display_name}'",
                    notes="Parent product set active",
                )
            else:
                inventory.deactivate_serials(
                    db, product_id=vid, user_id=user.id,
                    reference=f"Variant deactivated via parent '{p.display_name}'",
                    notes="Parent product set inactive",
                )
    if "quantity" in updates and p.quantity != old_quantity:
        try:
            inventory.post_journal_entry(
                db, product_id=p.id, user_id=user.id,
                quantity_change=p.quantity - old_quantity,
                movement_type="adjustment",
                to_location_id=p.location_id,
                reference="Quantity edited in product form",
                notes=f"Changed from {old_quantity} to {p.quantity}",
            )
        except inventory.InventoryError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))
    if p.location_id != old_location_id:
        new_location_id = p.location_id
        if p.is_serialized:
            serials = db.query(SerialNumber).filter(
                SerialNumber.product_id == p.id,
                SerialNumber.status == inventory.SERIAL_STATUS_IN_STOCK,
                SerialNumber.location_id == old_location_id,
                SerialNumber.lpn_id.is_(None),
            ).all()
            for serial in serials:
                inventory.transfer_stock(
                    db, product_id=p.id, user_id=user.id, quantity=1,
                    from_location_id=old_location_id, to_location_id=new_location_id,
                    serial_id=serial.id, reference_type="location_change",
                    reference="Product location changed",
                    notes=f"Location changed from {old_location_id} to {new_location_id}",
                )
        else:
            lines = db.query(StockLine).filter(
                StockLine.product_id == p.id,
                StockLine.quantity > 0,
                StockLine.location_id == old_location_id,
                StockLine.lpn_id.is_(None),
            ).all()
            for line in lines:
                inventory.transfer_stock(
                    db, product_id=p.id, user_id=user.id, quantity=line.quantity,
                    from_location_id=old_location_id, to_location_id=new_location_id,
                    lot_id=line.lot_id, lpn_id=line.lpn_id,
                    reference_type="location_change",
                    reference="Product location changed",
                    notes=f"Location changed from {old_location_id} to {new_location_id}",
                )
    db.commit()
    db.refresh(p)
    log_activity(db, user.id, user.username, "update", "product", p.id, f"Updated product '{p.display_name}'")
    notify_low_stock(db, p)
    notify_expiring(db, p)
    db.commit()
    broadcast_change("product", "updated")
    broadcast_change("stock_movement", "created")
    return p


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db), user=Depends(require_permission("products.delete"))):
    p = get_or_404(Product, product_id, db)
    name = p.display_name
    p.is_active = False
    if p.is_serialized:
        inventory.deactivate_serials(
            db, product_id=p.id, user_id=user.id,
            reference=f"Deleted product '{name}'",
            notes="Product deleted",
        )
    if p.parent_id is None:
        serialized_variants = [v.id for v in p.variants if v.is_serialized]
        db.query(Product).filter(Product.parent_id == p.id).update({"is_active": False}, synchronize_session=False)
        for vid in serialized_variants:
            inventory.deactivate_serials(
                db, product_id=vid, user_id=user.id,
                reference=f"Variant deactivated via deleted parent '{name}'",
                notes="Parent product deleted",
            )
    soft_delete(db, p, user, "product")


@router.get("/{product_id}/movements", response_model=list[StockMovementOut])
def product_movements(product_id: int, skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    get_or_404(Product, product_id, db)
    return db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.user)
    ).filter(StockMovement.product_id == product_id).order_by(
        StockMovement.created_at.desc()
    ).offset(skip).limit(limit).all()


class CsvImportResult(BaseModel):
    created: int = 0
    skipped: int = 0
    errors: list[str] = []


@router.post("/import-csv")
def import_products_csv(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_permission("products.import"))):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    content = read_upload_text(file)
    reader = csv.DictReader(io.StringIO(content))
    result = CsvImportResult()
    _settings_row = db.query(Settings).first()
    default_reorder = _settings_row.default_reorder_level if _settings_row else 10
    active_loc_ids = {loc.id for loc in db.query(Location).filter(Location.is_active == True)}  # noqa: E712
    active_loc_by_norm = {_normalize_path(loc.path): loc.id for loc in db.query(Location).all() if loc.is_active}
    for row_idx, row in enumerate(reader, start=2):
        sku = (row.get("sku") or "").strip()
        name = (row.get("name") or "").strip()
        parent_sku = (row.get("parent_sku") or "").strip()
        if not sku:
            result.errors.append(f"Row {row_idx}: missing required field 'sku'")
            continue
        if not name and not parent_sku:
            result.errors.append(f"Row {row_idx}: missing required field 'name' (or 'parent_sku' for a variant)")
            continue
        if db.query(Product).filter(Product.sku == sku).first():
            result.skipped += 1
            continue
        try:
            attrs_raw = (row.get("attributes") or "").strip()
            parent = None
            attrs = None
            if parent_sku:
                parent = db.query(Product).filter(Product.sku == parent_sku).first()
                if not parent:
                    result.errors.append(f"Row {row_idx} ({sku}): parent_sku '{parent_sku}' not found")
                    continue
                if parent.parent_id is not None:
                    result.errors.append(
                        f"Row {row_idx} ({sku}): parent_sku '{parent_sku}' is itself a variant - variants can only be created from a top-level product"
                    )
                    continue
                if parent.is_serialized:
                    result.errors.append(f"Row {row_idx} ({sku}): cannot create variants for serialized parent '{parent.sku}'")
                    continue
            if attrs_raw:
                try:
                    attrs = json.loads(attrs_raw)
                    if not isinstance(attrs, dict):
                        raise ValueError("attributes must be a JSON object")
                except Exception as e:
                    result.errors.append(f"Row {row_idx} ({sku}): invalid attributes JSON: {e}")
                    continue
            if parent is not None and attrs is not None:
                duplicate = any(
                    (v.attributes or {}) == attrs
                    for v in db.query(Product).filter(Product.parent_id == parent.id, Product.is_active == True).all()
                )
                if duplicate:
                    result.errors.append(
                        f"Row {row_idx} ({sku}): a variant of '{parent.sku}' with these attributes already exists"
                    )
                    continue
            is_serialized = (row.get("is_serialized") or "").strip().lower() in ("1", "true", "yes", "y")
            qty = int(row.get("quantity") or 0)
            if is_serialized and qty != 0:
                result.errors.append(f"Row {row_idx} ({sku}): serialized products cannot have opening quantity")
                continue
            expiry_raw = (row.get("expiry_date") or "").strip()
            expiry_date = None
            if expiry_raw:
                try:
                    expiry_date = date.fromisoformat(expiry_raw)
                except ValueError:
                    result.errors.append(f"Row {row_idx} ({sku}): invalid expiry_date '{expiry_raw}' (expected YYYY-MM-DD)")
                    continue
            active_raw = (row.get("is_active") or "").strip()
            is_active = True if not active_raw else active_raw.lower() in ("1", "true", "yes", "y")
            loc_text = (row.get("location") or "").strip()
            if parent is not None:
                loc_id = parent.location_id
            else:
                loc_id = active_loc_by_norm.get(_normalize_path(loc_text))
            if loc_id is None or loc_id not in active_loc_ids:
                if not loc_text and parent is None:
                    result.errors.append(
                        f"Row {row_idx} ({sku}): a location is required - set a 'location' column matching an active location"
                    )
                else:
                    result.errors.append(
                        f"Row {row_idx} ({sku}): location '{loc_text or loc_id}' is not an active location"
                    )
                continue
            row_sp = db.begin_nested()
            p = Product(
                sku=sku,
                name=parent.name if parent else name,
                description=(row.get("description") or "").strip(),
                category_id=parent.category_id if parent else None,
                supplier_id=parent.supplier_id if parent else None,
                parent_id=parent.id if parent else None,
                attributes=attrs,
                unit_price=float(row.get("unit_price") or 0),
                cost_price=float(row.get("cost_price") or 0),
                quantity=qty,
                reorder_level=int(row.get("reorder_level") or default_reorder),
                location=(row.get("location") or "").strip(),
                location_id=loc_id,
                barcode=(row.get("barcode") or "").strip(),
                batch_number=(row.get("batch_number") or "").strip(),
                expiry_date=expiry_date,
                is_active=is_active,
                is_serialized=is_serialized,
            )
            db.add(p)
            db.flush()
            if parent is not None:
                transfer_qty = inventory.on_hand(db, product_id=parent.id)
                if transfer_qty > 0:
                    inventory.post_journal_entry(
                        db, product_id=parent.id, user_id=user.id,
                        quantity_change=-transfer_qty, movement_type="out",
                        from_location_id=parent.location_id, to_location_id=loc_id,
                        reference=f"Stock transfer to {p.sku}",
                        notes="Parent stock carried over to imported variant",
                    )
                    p.quantity += transfer_qty
            if p.quantity > 0:
                inventory.post_journal_entry(
                    db, product_id=p.id, user_id=user.id, quantity_change=p.quantity,
                    movement_type="in", to_location_id=loc_id, reference="Initial stock",
                    notes="Opening balance",
                )
            log_activity(db, user.id, user.username, "create", "product", p.id, f"Imported product '{p.display_name}' ({p.sku})")
            result.created += 1
            row_sp.commit()
        except Exception as e:
            _sp = locals().get("row_sp")
            if _sp is not None:
                _sp.rollback()
            result.errors.append(f"Row {row_idx} ({sku}): {e}")
    db.commit()
    broadcast_change("product", "created")
    return result


@router.get("/{product_id}/trace")
def product_trace(product_id: int, db: Session = Depends(get_db)):
    """Forward + backward traceability for a product.

    Forward: every journal entry for the product (receives, sales, transfers,
    work-order issues, cycle-count adjustments). Backward: the work orders that
    produced this product (its components came from their BOMs) and the work
    orders that consumed it as a component. Journal entries link back to their
    source documents via ``reference_type`` / ``reference``.
    """
    p = get_or_404(Product, product_id, db)
    movements = (
        db.query(StockMovement)
        .options(
            joinedload(StockMovement.user), joinedload(StockMovement.lot),
            joinedload(StockMovement.from_location), joinedload(StockMovement.to_location),
        )
        .filter(StockMovement.product_id == product_id)
        .order_by(StockMovement.created_at.asc())
        .all()
    )

    incoming: list[dict] = []
    outgoing: list[dict] = []
    for m in movements:
        entry = {
            "id": m.id,
            "created_at": m.created_at,
            "movement_type": m.movement_type,
            "quantity_change": m.quantity_change,
            "reference_type": m.reference_type,
            "reference": m.reference,
            "notes": m.notes,
            "lot_number": m.lot.lot_number if m.lot else "",
            "username": m.username,
            "from_location_name": m.from_location.path if m.from_location else "",
            "to_location_name": m.to_location.path if m.to_location else "",
        }
        (incoming if m.quantity_change > 0 else outgoing).append(entry)

    produced = db.query(WorkOrder).filter(WorkOrder.product_id == product_id).all()
    consumed = (
        db.query(WorkOrderItem)
        .options(joinedload(WorkOrderItem.work_order))
        .filter(WorkOrderItem.product_id == product_id)
        .all()
    )
    work_orders = [
        {"wo_number": w.wo_number, "role": "produced", "status": w.status,
         "quantity": w.quantity, "created_at": w.created_at}
        for w in produced
    ] + [
        {"wo_number": wi.work_order.wo_number, "role": "consumed", "status": wi.work_order.status,
         "quantity": wi.quantity_required, "created_at": wi.work_order.created_at}
        for wi in consumed
    ]
    work_orders.sort(key=lambda x: x["created_at"] or "")

    return {
        "product_id": p.id,
        "product_name": p.display_name,
        "sku": p.sku,
        "incoming": incoming,
        "outgoing": outgoing,
        "work_orders": work_orders,
    }


ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024


def detect_image_ext(data: bytes) -> str | None:
    """Return the real image extension from magic bytes, or None if not an image."""
    from app.utils import detect_image_ext as _detect
    return _detect(data)


@router.post("/{product_id}/upload-image")
def upload_product_image(product_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_permission("products.upload"))):
    p = get_or_404(Product, product_id, db)
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
    detected = detect_image_ext(content)
    if detected is None:
        raise HTTPException(status_code=400, detail="File content is not a supported image")
    if ext in JPEG_EXTENSIONS:
        matches = detected in JPEG_EXTENSIONS
    else:
        matches = detected == ext
    if not matches:
        raise HTTPException(status_code=400, detail=f"File content does not match its extension ({ext})")
    from app.models.product_image import ProductImage
    if p.image_url:
        old_path = UPLOAD_DIR / Path(p.image_url).name
        try:
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass
        stale = db.query(ProductImage).filter(ProductImage.product_id == product_id, ProductImage.url == p.image_url).first()
        db.delete(stale) if stale else None
    filename = f"{uuid.uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    p.image_url = f"/uploads/{filename}"
    max_sort = db.query(func.coalesce(func.max(ProductImage.sort_order), 0)).filter(ProductImage.product_id == product_id).scalar()
    img = ProductImage(product_id=product_id, url=f"/uploads/{filename}", sort_order=max_sort + 1)
    db.add(img)
    db.commit()
    broadcast_change("product", "updated")
    return {"image_url": p.image_url}


@router.post("/{product_id}/images")
def upload_product_images(product_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db), user=Depends(require_permission("products.upload"))):
    from app.models.product_image import ProductImage
    p = get_or_404(Product, product_id, db)
    max_sort = db.query(func.coalesce(func.max(ProductImage.sort_order), 0)).filter(ProductImage.product_id == product_id).scalar()
    uploaded = []
    for file in files:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            continue
        content = file.file.read()
        if not content or len(content) > MAX_UPLOAD_SIZE:
            continue
        detected = detect_image_ext(content)
        if detected is None:
            continue
        if ext in JPEG_EXTENSIONS:
            matches = detected in JPEG_EXTENSIONS
        else:
            matches = detected == ext
        if not matches:
            continue
        filename = f"{uuid.uuid4().hex}{detected}"
        filepath = UPLOAD_DIR / filename
        with open(filepath, "wb") as f:
            f.write(content)
        max_sort += 1
        img = ProductImage(product_id=product_id, url=f"/uploads/{filename}", sort_order=max_sort)
        db.add(img)
        uploaded.append(img)
    if uploaded:
        has_cover_row = bool(
            db.query(ProductImage).filter(ProductImage.product_id == product_id, ProductImage.url == p.image_url).first()
        ) if p.image_url else False
        if not has_cover_row:
            p.image_url = uploaded[0].url
    db.commit()
    for img in uploaded:
        db.refresh(img)
    return [{"id": img.id, "url": img.url, "sort_order": img.sort_order} for img in uploaded]


@router.delete("/{product_id}/images/{image_id}")
def delete_product_image(product_id: int, image_id: int, db: Session = Depends(get_db), user=Depends(require_permission("products.upload"))):
    from app.models.product_image import ProductImage
    p = get_or_404(Product, product_id, db)
    img = db.query(ProductImage).filter(ProductImage.id == image_id, ProductImage.product_id == product_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        file_path = UPLOAD_DIR / Path(img.url).name
        if file_path.exists():
            file_path.unlink()
    except Exception:
        pass
    url = img.url
    db.delete(img)
    db.flush()
    if p.image_url == url:
        remaining = db.query(ProductImage).filter(ProductImage.product_id == product_id).order_by(ProductImage.sort_order).first()
        p.image_url = remaining.url if remaining else ""
    db.commit()
    broadcast_change("product", "updated")
    return {"ok": True}


@router.put("/{product_id}/images/reorder")
def reorder_product_images(product_id: int, body: dict, db: Session = Depends(get_db), user=Depends(require_permission("products.upload"))):
    from app.models.product_image import ProductImage
    p = get_or_404(Product, product_id, db)
    image_ids = body.get("image_ids", [])
    for idx, img_id in enumerate(image_ids):
        img = db.query(ProductImage).filter(ProductImage.id == img_id, ProductImage.product_id == product_id).first()
        if img:
            img.sort_order = idx
    if image_ids:
        first = db.query(ProductImage).filter(ProductImage.id == image_ids[0], ProductImage.product_id == product_id).first()
        if first:
            p.image_url = first.url
    db.commit()
    broadcast_change("product", "updated")
    return {"ok": True}
