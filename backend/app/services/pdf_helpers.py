"""Shared helpers for generating clean, minimal, professional PDFs with reportlab."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Callable

from reportlab.lib.colors import Color
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

_FONT_DIR = Path(__file__).resolve().parent

_USE_CUSTOM = False
try:
    if "MonaSans" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("MonaSans", str(_FONT_DIR / "MonaSans.ttf")))
        pdfmetrics.registerFont(TTFont("BricolageGrotesque", str(_FONT_DIR / "BricolageGrotesque.ttf")))
        pdfmetrics.registerFontFamily("MonaSans", normal="MonaSans", bold="MonaSans", italic="MonaSans", boldItalic="MonaSans")
        pdfmetrics.registerFontFamily("BricolageGrotesque", normal="BricolageGrotesque", bold="BricolageGrotesque", italic="BricolageGrotesque", boldItalic="BricolageGrotesque")
    _USE_CUSTOM = True
except Exception as exc:
    import warnings
    warnings.warn(f"Custom PDF fonts unavailable, falling back to Helvetica: {exc}")
    _USE_CUSTOM = False

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
BODY_RIGHT = PAGE_W - MARGIN
BODY_LEFT = MARGIN
BODY_CENTER = PAGE_W / 2
META_X = PAGE_W * 0.54

FONT = "MonaSans" if _USE_CUSTOM else "Helvetica"
BOLD = "BricolageGrotesque" if _USE_CUSTOM else "Helvetica-Bold"
OBLIQUE = "MonaSans" if _USE_CUSTOM else "Helvetica-Oblique"
MONO = "Courier"

# Design tokens mirroring frontend/src/style.css (--t-*), so printed PDFs share the
# app's amber brand ramp and slate ink ramp regardless of which router renders them.
INK = Color(0.067, 0.094, 0.153)        # --t-ink #111827 (near-black slate)
MUTED = Color(0.294, 0.333, 0.388)      # --t-muted #4b5563
FAINT = Color(0.820, 0.835, 0.859)      # --t-border-strong #d1d5db
ACCENT = Color(0.851, 0.467, 0.024)     # --t-primary #d97706 (amber-600)
ACCENT_HOVER = Color(0.706, 0.325, 0.035)   # --t-primary-solid-hover #b45309
ACCENT_STRONG = Color(0.573, 0.251, 0.055)  # --t-primary-strong #92400e

BANNER_BG = Color(0.471, 0.208, 0.059)  # --t-brand-to #78350f (deep amber banner)
STRIPE_BG = Color(0.96, 0.96, 0.97)
WATERMARK_COLORS = {
    "paid": Color(0.063, 0.725, 0.588, 0.10),      # emerald-500 #10b981
    "pending": Color(0.961, 0.620, 0.043, 0.10),   # amber-500 #f59e0b
    "cancelled": Color(0.937, 0.267, 0.267, 0.10), # red-500 #ef4444
    "refunded": Color(0.937, 0.267, 0.267, 0.10),  # red-500 #ef4444
    "draft": Color(0.294, 0.333, 0.388, 0.08),     # slate-500 #4b5563
}

_page_counter = 0


def new_canvas(title: str) -> tuple[canvas.Canvas, io.BytesIO]:
    global _page_counter
    _page_counter = 0
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


def draw_page_footer(c: canvas.Canvas, page_num: int, tax_id: str = "", footer_note: str = ""):
    """Draw page number centered at the bottom, plus optional tax_id and footer_note on page 1."""
    global _page_counter
    _page_counter = max(_page_counter, page_num)
    y = MARGIN - 20
    c.setFont(FONT, 8)
    c.setFillColor(MUTED)
    c.drawCentredString(BODY_CENTER, y, f"Page {page_num}")
    if page_num == 1:
        parts = []
        if tax_id:
            parts.append(f"Tax ID: {tax_id}")
        if footer_note:
            parts.append(footer_note[:120])
        if parts:
            c.setFont(FONT, 7.5)
            c.drawCentredString(BODY_CENTER, y - 13, "  |  ".join(parts))


def draw_watermark(c: canvas.Canvas, text: str, color_key: str = "draft"):
    """Draw large semi-transparent diagonal watermark text across the page body."""
    color = WATERMARK_COLORS.get(color_key, WATERMARK_COLORS["draft"])
    c.saveState()
    c.setFillColor(color)
    c.setFont(BOLD, 72)
    c.translate(PAGE_W / 2, PAGE_H / 2)
    c.rotate(45)
    tw = stringWidth(text, BOLD, 72)
    c.drawCentredString(0, -tw * 0.15, text)
    c.restoreState()


def _try_load_image(path: str | None, base_dir: Path | None = None) -> ImageReader | None:
    """Attempt to load an image file from a relative or absolute path."""
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute() and base_dir:
        p = base_dir / path.lstrip("/")
    if not p.exists():
        return None
    try:
        return ImageReader(str(p))
    except Exception:
        return None


def draw_banner_header(c: canvas.Canvas, doc_label: str, meta: list[tuple[str, str]],
                       store_lines: list[str], logo_url: str = "",
                       base_dir: Path | None = None) -> float:
    """Full-width colored banner header with optional logo. Returns y below the banner."""
    banner_h = 72
    banner_y = PAGE_H - MARGIN - banner_h

    c.setFillColor(BANNER_BG)
    c.rect(MARGIN, banner_y, BODY_RIGHT - MARGIN, banner_h, fill=1, stroke=0)

    content_x = MARGIN + 14
    content_y_center = banner_y + banner_h / 2

    logo_img = _try_load_image(logo_url, base_dir)
    if logo_img:
        try:
            iw, ih = logo_img.getSize()
            max_h = banner_h - 20
            max_w = 160
            scale = min(max_w / iw, max_h / ih)
            draw_w = iw * scale
            draw_h = ih * scale
            logo_y = content_y_center - draw_h / 2
            c.drawImage(logo_img, content_x, logo_y, width=draw_w, height=draw_h, mask="auto")
            content_x += draw_w + 14
        except Exception:
            pass

    c.setFont(BOLD, 18)
    c.setFillColor(Color(1, 1, 1))
    c.drawString(content_x, content_y_center + 6, store_lines[0] if store_lines else "My Store")

    c.setFont(FONT, 9)
    c.setFillColor(Color(0.85, 0.87, 0.92))
    for i, line in enumerate(store_lines[1:3]):
        c.drawString(content_x, content_y_center - 6 - (i * 12), line)

    meta_x = BODY_RIGHT - 14
    meta_y = banner_y + banner_h - 18
    c.setFont(FONT, 9.5)
    for label, value in meta:
        c.setFillColor(Color(0.75, 0.78, 0.85))
        c.drawRightString(meta_x - stringWidth(value, FONT, 9.5) - 6, meta_y, label)
        c.setFillColor(Color(1, 1, 1))
        c.drawRightString(meta_x, meta_y, value)
        meta_y -= 15

    return banner_y - 20


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
                    on_page_break: Callable[[canvas.Canvas], None] | None = None,
                    stripe: bool = True) -> float:
    """Typographic table: muted header, hairline rule, airy rows.
    Splits across pages when space runs out. Returns y below the last row."""
    global _page_counter
    right = x + sum(col_widths)
    row_h = 20
    y = top_y
    row_idx = 0

    def draw_table_header():
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

    def draw_page_break():
        global _page_counter
        nonlocal y, row_idx
        c.showPage()
        _page_counter += 1
        draw_page_footer(c, _page_counter)
        y = PAGE_H - MARGIN - 6
        draw_table_header()
        row_idx = 0

    draw_table_header()

    for row in rows:
        if y - row_h < 64:
            if on_page_break:
                on_page_break(c)
            else:
                draw_page_break()
            y = PAGE_H - MARGIN - 6
            draw_table_header()
            row_idx = 0

        if stripe and row_idx % 2 == 1:
            c.setFillColor(STRIPE_BG)
            c.rect(x - 4, y - row_h + 2, right - x + 8, row_h, fill=1, stroke=0)

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
        row_idx += 1

    return y - 12


def draw_totals(c: canvas.Canvas, right: float, y: float,
                rows: list[tuple[str, str]], total_label: str | None = None,
                total_value: str | None = None) -> float:
    """Right-aligned summary block with airy spacing and a bold, highlighted total."""
    block_w = 140
    for label, value in rows:
        c.setFont(FONT, 10)
        c.setFillColor(MUTED)
        c.drawRightString(right - block_w, y - 4, label)
        c.setFillColor(INK)
        c.drawRightString(right, y - 4, value)
        y -= 19
    if total_label is not None:
        y -= 8
        band_h = 26
        band_y = y - 16
        c.setFillColor(STRIPE_BG)
        c.roundRect(right - block_w - 4, band_y, block_w + 4, band_h, 3, fill=1, stroke=0)
        c.setStrokeColor(FAINT)
        c.setLineWidth(0.8)
        c.line(right - block_w, band_y + band_h - 3, right, band_y + band_h - 3)
        c.setFont(BOLD, 9.5)
        c.setFillColor(MUTED)
        c.drawRightString(right - block_w - 2, y - 5, total_label)
        c.setFont(BOLD, 13.5)
        c.setFillColor(ACCENT)
        c.drawRightString(right, y - 5, total_value)
        y = band_y
    return y


def money(currency_symbol: str, amount: float | int | None) -> str:
    """Format a monetary amount with thousands separators, e.g. 'KSh1,234,567.89'.

    A leading minus sign is placed before the currency symbol.
    """
    try:
        amt = float(amount or 0)
    except (TypeError, ValueError):
        amt = 0.0
    if amt < 0:
        return f"-{currency_symbol}{abs(amt):,.2f}"
    return f"{currency_symbol}{amt:,.2f}"


def truncate_to_width(text: str, max_width: float, font: str = FONT, size: float = 10,
                      ellipsis: str = "\u2026") -> str:
    """Trim *text* so it fits within max_width pt at the given font/size, adding an ellipsis.

    Falls back to character truncation if stringWidth is unavailable for *font*.
    """
    try:
        if stringWidth(text, font, size) <= max_width:
            return text
    except Exception:
        return text[: int(max_width / 5.5)] + ellipsis
    fit = len(text)
    while fit > 0 and stringWidth(text[:fit] + ellipsis, font, size) > max_width:
        fit -= 1
    return (text[:fit] + ellipsis) if fit > 0 else ellipsis


def draw_notes(c: canvas.Canvas, x: float, y: float, text: str):
    c.setFont(OBLIQUE, 9.5)
    c.setFillColor(MUTED)
    c.drawString(x, y, f"Notes: {text[:200]}")


def draw_signoff(c: canvas.Canvas, y: float, text: str):
    """Centered closing line near the bottom; starts a fresh page if needed."""
    sy = 1.0 * inch
    if y < sy + 18:
        c.showPage()
        global _page_counter
        _page_counter += 1
        draw_page_footer(c, _page_counter)
    c.setFont(OBLIQUE, 10.5)
    c.setFillColor(MUTED)
    c.drawCentredString(BODY_CENTER, sy, text)
