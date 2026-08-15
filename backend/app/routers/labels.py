import io

import barcode as pybarcode
from barcode.writer import SVGWriter
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from reportlab.graphics import renderPDF
from reportlab.lib.units import inch
from sqlalchemy.orm import Session
from svglib.svglib import svg2rlg

from app.database import get_db
from app.models import LPN, Location, Lot
from app.services.auth import get_current_user
from app.services.pdf_helpers import BOLD, FAINT, INK, MUTED, new_canvas, render_pdf
from app.utils import get_or_404

router = APIRouter(prefix="/api/labels", tags=["labels"], dependencies=[Depends(get_current_user)])

LABEL_W, LABEL_H = 4.0 * inch, 2.0 * inch


def _render_label(c, buf, title: str, lines: list[str], barcode_val: str, filename: str) -> Response:
    c.setStrokeColor(FAINT)
    c.setLineWidth(1)
    c.roundRect(12, 12, LABEL_W - 24, LABEL_H - 24, 6, stroke=1, fill=0)

    y = LABEL_H - 40
    c.setFont(BOLD, 13)
    c.setFillColor(INK)
    c.drawString(22, y, title)
    y -= 24

    c.setFont("Helvetica", 10)
    c.setFillColor(INK)
    for line in lines:
        c.drawString(22, y, line)
        y -= 15

    try:
        code = pybarcode.get("code128", barcode_val, writer=SVGWriter())
        drawing = svg2rlg(io.BytesIO(code.render()))
        bw = LABEL_W - 44
        scale = min(bw / drawing.width, 46 / drawing.height)
        drawing.scale(scale, scale)
        renderPDF.draw(drawing, c, 22, 24)
    except Exception:
        c.setFont("Helvetica", 7)
        c.setFillColor(MUTED)
        c.drawString(22, 26, barcode_val)

    return Response(render_pdf(c, buf), media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename={filename}.pdf"
    })


@router.get("/lot/{lot_id}")
def lot_label(lot_id: int, db: Session = Depends(get_db)):
    lot = get_or_404(Lot, lot_id, db)
    c, buf = new_canvas(f"Lot {lot.lot_number}")
    barcode_val = lot.lot_number or f"LOT-{lot.id}"
    return _render_label(
        c, buf,
        f"LOT {lot.lot_number}",
        [
            f"Product: {lot.product_name}",
            f"Expiry: {lot.expiry_date or 'N/A'}",
            f"On hand: {sum(sl.quantity for sl in lot.stock_lines)}",
        ],
        barcode_val, f"lot-{lot.lot_number}",
    )


@router.get("/location/{location_id}")
def location_label(location_id: int, db: Session = Depends(get_db)):
    loc = get_or_404(Location, location_id, db)
    c, buf = new_canvas(f"Location {loc.path}")
    return _render_label(
        c, buf,
        "BIN LOCATION",
        [
            f"Name: {loc.name}",
            f"Path: {loc.path}",
            f"Type: {loc.location_type}",
        ],
        loc.code or loc.name, f"location-{loc.id}",
    )


@router.get("/pallet/{lpn_id}")
def pallet_label(lpn_id: int, db: Session = Depends(get_db)):
    lpn = get_or_404(LPN, lpn_id, db)
    c, buf = new_canvas(f"Pallet {lpn.lpn_number}")
    lines = [f"Type: {lpn.lpn_type}", f"Location: {lpn.location_name or 'N/A'}"]
    for sl in lpn.stock_lines:
        lines.append(f"{sl.product.display_name}: {sl.quantity}")
    serials_by_product: dict[str, list[str]] = {}
    for serial in sorted(lpn.serial_numbers, key=lambda s: s.serial_number):
        serials_by_product.setdefault(serial.product_name or f"Product #{serial.product_id}", []).append(serial.serial_number)
    for name, serials in serials_by_product.items():
        joined = ", ".join(serials)
        label = f"{name} (serials x{len(serials)}): {joined}"
        lines.append(label[:100] + ("\u2026" if len(label) > 100 else ""))
    return _render_label(
        c, buf,
        f"PALLET {lpn.lpn_number}",
        lines,
        lpn.lpn_number, f"pallet-{lpn.lpn_number}",
    )
