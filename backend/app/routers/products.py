import csv
import io
import json
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

from math import ceil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import String, cast
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.category import Category
from app.models.location import Location
from app.models.product import Product
from app.models.serial_number import SerialNumber
from app.models.settings import Settings
from app.models.stock_line import StockLine
from app.models.stock_movement import StockMovement
from app.models.supplier import Supplier
from app.models.work_order import WorkOrder, WorkOrderItem
from app.schemas.product import ProductCreate, ProductOut, ProductUpdate
from app.schemas.stock_movement import StockMovementOut
from app.services import inventory
from app.services.auth import get_current_user, require_permission
from app.services.notify import notify_expiring, notify_low_stock
from app.utils import get_or_404, log_activity, broadcast_change

from reportlab.graphics import renderPDF
from reportlab.lib.units import inch
from svglib.svglib import svg2rlg

import barcode as pybarcode
from barcode.writer import SVGWriter

from app.services.pdf_helpers import FONT, BOLD, INK, MONO, MUTED, FAINT, PAGE_H, PAGE_W, new_canvas, render_pdf

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/api/products", tags=["products"], dependencies=[Depends(get_current_user)])


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


def validate_refs(db: Session, category_id: Optional[int], supplier_id: Optional[int]) -> None:
    if category_id is not None and not db.query(Category).filter(Category.id == category_id).first():
        raise HTTPException(status_code=400, detail=f"Category {category_id} does not exist")
    if supplier_id is not None and not db.query(Supplier).filter(Supplier.id == supplier_id).first():
        raise HTTPException(status_code=400, detail=f"Supplier {supplier_id} does not exist")


def validate_location_ref(db: Session, location_id: Optional[int]) -> None:
    if location_id is not None and not db.query(Location).filter(Location.id == location_id).first():
        raise HTTPException(status_code=400, detail=f"Location {location_id} does not exist")


def resolve_location(db: Session, location_id: Optional[int], location_text: Optional[str]) -> Optional[int]:
    """Resolve the effective location id for a product: prefer an explicit id,
    otherwise match the free-text location field against a location path."""
    if location_id is not None:
        return location_id
    text = (location_text or "").strip()
    if not text:
        return None
    for loc in db.query(Location).all():
        if loc.path.lower() == text.lower():
            return loc.id
    return None


@router.get("")
def list_products(
    search: str = "", category_id: int | None = None,
    sort_by: str = "name", sort_dir: str = "asc",
    skip: int = 0, limit: int = 100,
    active_only: bool = False,
    expiry: str = "",
    low_stock: bool = False,
    include_variants: bool = False,
    db: Session = Depends(get_db),
):
    options = [joinedload(Product.category), joinedload(Product.supplier), joinedload(Product.default_location), joinedload(Product.stock_lines).joinedload(StockLine.location)]
    if include_variants:
        options.append(joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location))
    q = db.query(Product).options(*options).filter(Product.parent_id.is_(None))
    if active_only:
        q = q.filter(Product.is_active == True)
    if search:
        like = f"%{search}%"
        if include_variants:
            q = q.filter(
                Product.name.ilike(like) | Product.sku.ilike(like)
                | Product.variants.any(Product.name.ilike(like) | Product.sku.ilike(like) | cast(Product.attributes, String).ilike(like))
            )
        else:
            q = q.filter(Product.name.ilike(like) | Product.sku.ilike(like))
    if category_id:
        q = q.filter(Product.category_id == category_id)
    today = date.today()
    soon = today + timedelta(days=30)
    if expiry == "expired":
        if include_variants:
            q = q.filter(
                (Product.expiry_date.isnot(None) & (Product.expiry_date < today))
                | Product.variants.any(Product.expiry_date.isnot(None), Product.expiry_date < today)
            )
        else:
            q = q.filter(Product.expiry_date.isnot(None), Product.expiry_date < today)
    elif expiry == "expiring":
        if include_variants:
            q = q.filter(
                (Product.expiry_date.isnot(None) & (Product.expiry_date >= today) & (Product.expiry_date <= soon))
                | Product.variants.any(Product.expiry_date.isnot(None), Product.expiry_date >= today, Product.expiry_date <= soon)
            )
        else:
            q = q.filter(Product.expiry_date.isnot(None), Product.expiry_date >= today, Product.expiry_date <= soon)
    if low_stock:
        if include_variants:
            q = q.filter(
                (Product.quantity <= Product.reorder_level)
                | Product.variants.any(Product.quantity <= Product.reorder_level)
            )
        else:
            q = q.filter(Product.quantity <= Product.reorder_level)
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
        col = getattr(Product, sort_by, Product.name)
        q = q.order_by(col.asc() if sort_dir == "asc" else col.desc())
    items = q.offset(skip).limit(limit).all()
    results = []
    for p in items:
        out = ProductOut.model_validate(p)
        out.location = _effective_location(p)
        if include_variants and p.variants and out.variants:
            for v_orm, v_out in zip(p.variants, out.variants):
                v_out.location = _effective_location(v_orm)
        results.append(out)
    return {"items": results, "total": total, "page": (skip // limit) + 1 if limit else 1, "pages": max(ceil(total / limit), 1) if limit else 1}


class BulkEditRequest(BaseModel):
    ids: list[int]
    supplier_id: Optional[int] = None
    category_id: Optional[int] = None
    reorder_level: Optional[int] = None


@router.patch("/bulk-edit")
def bulk_edit_products(data: BulkEditRequest, db: Session = Depends(get_db), user=Depends(require_permission("products.bulk"))):
    validate_refs(db, data.category_id, data.supplier_id)
    products = db.query(Product).filter(Product.id.in_(data.ids), Product.is_active == True).all()
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
        q = q.filter(Product.id.in_(id_list))
    products = q.order_by(Product.name).all()

    LABEL_W, LABEL_H = 2.25 * inch, 1.0 * inch
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
        price = f"${p.unit_price:.2f}" if p.unit_price else ""
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
        joinedload(Product.stock_lines).joinedload(StockLine.location),
    ])
    out = ProductOut.model_validate(p)
    out.location = _effective_location(p)
    if p.variants and out.variants:
        for v_orm, v_out in zip(p.variants, out.variants):
            v_out.location = _effective_location(v_orm)
    return out


@router.get("/barcode/{barcode}", response_model=ProductOut)
def get_product_by_barcode(barcode: str, db: Session = Depends(get_db)):
    p = db.query(Product).options(
        joinedload(Product.category), joinedload(Product.supplier),
        joinedload(Product.default_location),
        joinedload(Product.variants).joinedload(Product.stock_lines).joinedload(StockLine.location),
        joinedload(Product.stock_lines).joinedload(StockLine.location),
    ).filter(Product.barcode == barcode, Product.is_active == True).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    out = ProductOut.model_validate(p)
    out.location = _effective_location(p)
    if p.variants and out.variants:
        for v_orm, v_out in zip(p.variants, out.variants):
            v_out.location = _effective_location(v_orm)
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
    if "location" in updates or "location_id" in updates:
        updates["location_id"] = resolve_location(db, updates.get("location_id"), updates.get("location"))
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
    for k, v in updates.items():
        setattr(p, k, v)
    if not p.is_variant:
        sync = {k: v for k, v in updates.items() if k in ("name", "category_id", "supplier_id", "is_active")}
        if sync:
            q = db.query(Product).filter(Product.parent_id == p.id)
            if "name" in sync:
                q = q.filter(Product.name == old_name)
            q.update(sync, synchronize_session=False)
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
    if p.parent_id is None:
        db.query(Product).filter(Product.parent_id == p.id).update({"is_active": False}, synchronize_session=False)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "product", product_id, f"Deleted product '{name}'")
    db.commit()
    broadcast_change("product", "deleted")


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
    content = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    result = CsvImportResult()
    _settings_row = db.query(Settings).first()
    default_reorder = _settings_row.default_reorder_level if _settings_row else 10
    for row_idx, row in enumerate(reader, start=2):
        sku = (row.get("sku") or "").strip()
        name = (row.get("name") or "").strip()
        if not sku or not name:
            result.errors.append(f"Row {row_idx}: missing required field 'sku' or 'name'")
            continue
        if db.query(Product).filter(Product.sku == sku).first():
            result.skipped += 1
            continue
        try:
            parent_sku = (row.get("parent_sku") or "").strip()
            attrs_raw = (row.get("attributes") or "").strip()
            parent = None
            attrs = None
            if parent_sku:
                parent = db.query(Product).filter(Product.sku == parent_sku).first()
                if not parent:
                    result.errors.append(f"Row {row_idx} ({sku}): parent_sku '{parent_sku}' not found")
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
            is_serialized = (row.get("is_serialized") or "").strip().lower() in ("1", "true", "yes", "y")
            qty = int(row.get("quantity") or 0)
            if is_serialized and qty != 0:
                result.errors.append(f"Row {row_idx} ({sku}): serialized products cannot have opening quantity")
                continue
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
                barcode=(row.get("barcode") or "").strip(),
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
                        reference=f"Stock transfer to {p.sku}",
                        notes="Parent stock carried over to imported variant",
                    )
                    p.quantity += transfer_qty
            if p.quantity > 0:
                inventory.post_journal_entry(
                    db, product_id=p.id, user_id=user.id, quantity_change=p.quantity,
                    movement_type="in", reference="Initial stock",
                    notes="Opening balance",
                )
            log_activity(db, user.id, user.username, "create", "product", p.id, f"Imported product '{p.display_name}' ({p.sku})")
            result.created += 1
        except Exception as e:
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
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


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
    filename = f"{uuid.uuid4().hex}{detected}"
    filepath = UPLOAD_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    p.image_url = f"/uploads/{filename}"
    db.commit()
    broadcast_change("product", "updated")
    return {"image_url": p.image_url}
