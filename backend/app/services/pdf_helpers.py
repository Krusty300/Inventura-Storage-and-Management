"""Shared helpers for generating clean, minimal, professional PDFs with reportlab."""
from __future__ import annotations

import io
from typing import Callable

from reportlab.lib.colors import Color
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
BODY_RIGHT = PAGE_W - MARGIN
BODY_LEFT = MARGIN
BODY_CENTER = PAGE_W / 2
META_X = PAGE_W * 0.54

FONT = "Helvetica"
BOLD = "Helvetica-Bold"
OBLIQUE = "Helvetica-Oblique"
MONO = "Courier"

INK = Color(0.13, 0.16, 0.22)
MUTED = Color(0.45, 0.48, 0.55)
FAINT = Color(0.87, 0.88, 0.91)
ACCENT = Color(0.08, 0.34, 0.61)


def new_canvas(title: str) -> tuple[canvas.Canvas, io.BytesIO]:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.setTitle(title)
    return c, buf


def render_pdf(c: canvas.Canvas, buf: io.BytesIO) -> bytes:
    c.save()
    pdf = buf.getvalue()
    buf.close()
    return pdf


def _hrule(c: canvas.Canvas, x: float, y: float, width: float, color: Color = FAINT, weight: float = 0.8):
    c.setStrokeColor(color)
    c.setLineWidth(weight)
    c.line(x, y, x + width, y)


def draw_header(c: canvas.Canvas, doc_label: str, meta: list[tuple[str, str]],
                store_lines: list[str]) -> float:
    """Centered document title, store identity on the left, key/value meta on the right.
    Returns the y coordinate where body content should start."""
    y0 = PAGE_H - MARGIN

    c.setFont(BOLD, 24)
    c.setFillColor(INK)
    c.drawCentredString(BODY_CENTER, y0, doc_label)

    c.setFont(BOLD, 15)
    c.setFillColor(INK)
    c.drawString(BODY_LEFT, y0 - 34, store_lines[0] if store_lines else "My Store")

    y = y0 - 49
    c.setFont(FONT, 9.5)
    c.setFillColor(MUTED)
    left_bottom = y
    for line in store_lines[1:4]:
        c.drawString(BODY_LEFT, y, line)
        y -= 13
        left_bottom = y

    y = y0 - 34
    c.setFont(FONT, 10)
    right_bottom = y
    for label, value in meta:
        c.setFillColor(MUTED)
        c.drawString(META_X, y, label)
        c.setFillColor(INK)
        c.drawString(META_X + stringWidth(label, FONT, 10) + 8, y, value)
        y -= 16
        right_bottom = y

    rule_y = min(left_bottom, right_bottom) - 16
    _hrule(c, BODY_LEFT, rule_y, BODY_RIGHT - BODY_LEFT)
    return rule_y - 22


def draw_info_block(c: canvas.Canvas, x: float, y: float, label: str, lines: list[str]) -> float:
    """Uppercase section label, bold lead line, muted detail lines."""
    c.setFont(BOLD, 9)
    c.setFillColor(MUTED)
    c.drawString(x, y, label.upper())
    y -= 16

    c.setFont(BOLD, 11)
    c.setFillColor(INK)
    if lines:
        c.drawString(x, y, lines[0])
        y -= 16

    c.setFont(FONT, 9.5)
    c.setFillColor(MUTED)
    for line in lines[1:]:
        c.drawString(x, y, line)
        y -= 13
    return y - 18


def draw_item_table(c: canvas.Canvas, x: float, top_y: float, headers: list[str],
                    aligns: list[str], col_widths: list[float], rows: list[list[str]],
                    on_page_break: Callable[[canvas.Canvas], None] | None = None) -> float:
    """Typographic table: muted header, hairline rule, airy rows.
    Splits across pages when space runs out. Returns y below the last row."""
    right = x + sum(col_widths)
    row_h = 20
    y = top_y

    def draw_header():
        nonlocal y
        c.setFont(BOLD, 9)
        c.setFillColor(MUTED)
        cx = x
        for h, a, w in zip(headers, aligns, col_widths):
            if a == "r":
                c.drawRightString(cx + w, y, h)
            else:
                c.drawString(cx, y, h)
            cx += w
        _hrule(c, x, y - 10, right - x)
        y -= 18

    draw_header()

    for row in rows:
        if y - row_h < 64:
            if on_page_break:
                on_page_break(c)
            y = PAGE_H - MARGIN - 6
            draw_header()
        c.setFont(FONT, 10)
        c.setFillColor(INK)
        cx = x
        for val, a, w in zip(row, aligns, col_widths):
            if a == "r":
                c.drawRightString(cx + w, y - 6, val)
            else:
                c.drawString(cx, y - 6, val)
            cx += w
        y -= row_h

    return y - 12


def draw_totals(c: canvas.Canvas, right: float, y: float,
                rows: list[tuple[str, str]], total_label: str | None = None,
                total_value: str | None = None) -> float:
    """Right-aligned summary block with a rule above the highlighted total."""
    c.setFont(FONT, 10)
    for label, value in rows:
        c.setFillColor(MUTED)
        c.drawRightString(right - 130, y - 4, label)
        c.setFillColor(INK)
        c.drawRightString(right, y - 4, value)
        y -= 18
    if total_label is not None:
        y -= 4
        _hrule(c, right - 130, y + 8, 130, weight=0.8)
        c.setFont(BOLD, 11)
        c.setFillColor(ACCENT)
        c.drawRightString(right - 130, y - 4, total_label)
        c.drawRightString(right, y - 4, total_value)
        y -= 24
    return y


def draw_notes(c: canvas.Canvas, x: float, y: float, text: str):
    c.setFont(OBLIQUE, 9.5)
    c.setFillColor(MUTED)
    c.drawString(x, y, f"Notes: {text[:200]}")


def draw_signoff(c: canvas.Canvas, y: float, text: str):
    """Centered closing line near the bottom; starts a fresh page if needed."""
    sy = 1.0 * inch
    if y < sy + 18:
        c.showPage()
    c.setFont(OBLIQUE, 10.5)
    c.setFillColor(MUTED)
    c.drawCentredString(BODY_CENTER, sy, text)
