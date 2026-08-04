from sqlalchemy.orm import Session, joinedload

from app.models import BOM, BOMItem, Product


def active_bom_map(db: Session) -> dict[int, tuple[int, list[tuple[Product, int]]]]:
    """product_id -> (bom_id, [(component Product, qty)]) for active BOMs
    (first active BOM per product)."""
    boms = (
        db.query(BOM)
        .options(joinedload(BOM.items).joinedload(BOMItem.product))
        .filter(BOM.is_active == True)
        .all()
    )
    out: dict[int, tuple[int, list[tuple[Product, int]]]] = {}
    for bom in boms:
        if bom.product_id not in out:
            out[bom.product_id] = (bom.id, [(item.product, item.quantity) for item in bom.items])
    return out


def unit_cost(db: Session, product_id: int, bom_map: dict[int, tuple[int, list[tuple[Product, int]]]] | None = None) -> float:
    """Rolled-up unit material cost for a product. A product with an active BOM
    costs the sum of its component costs (recursively); a raw item uses its
    recorded cost_price."""
    if bom_map is None:
        bom_map = active_bom_map(db)
    return _unit_cost(db, product_id, bom_map, set())


def _unit_cost(db: Session, product_id: int, bom_map: dict[int, tuple[int, list[tuple[Product, int]]]], stack: set[int]) -> float:
    entry = bom_map.get(product_id)
    if entry is None or product_id in stack:
        product = db.get(Product, product_id)
        return float(product.cost_price or 0) if product else 0.0
    stack.add(product_id)
    total = 0.0
    for component, qty in entry[1]:
        total += qty * _unit_cost(db, component.id, bom_map, stack)
    stack.discard(product_id)
    return round(total, 2)


def itemized_bom_cost(db: Session, product_id: int) -> list[dict]:
    """Level-1 BOM items with rolled-up component unit costs and extended costs."""
    bom_map = active_bom_map(db)
    entry = bom_map.get(product_id)
    if entry is None:
        return []
    rows = []
    for component, qty in entry[1]:
        component_unit = _unit_cost(db, component.id, bom_map, set())
        rows.append({
            "product_id": component.id,
            "product_name": component.display_name,
            "sku": component.sku,
            "quantity_per_unit": qty,
            "component_unit_cost": component_unit,
            "has_bom": component.id in bom_map,
            "extended_cost": round(component_unit * qty, 2),
        })
    return rows
