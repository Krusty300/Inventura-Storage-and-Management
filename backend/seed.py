"""Comprehensive seed script for the Inventory Management System.

Run from the backend directory:
    python seed.py

Wipes existing data and inserts realistic demo data across every entity:
users, settings, locations, categories, suppliers, customers, products,
variants, lots, serial numbers, LPNs, purchase orders, receipts, ASNs,
cycle counts, sales (incl. refunds), stock movements, notifications,
activity logs, document sequences, BOMs, work orders (incl. serialized
manufacturing), quality checks, lot genealogy links, and shipments across
the full picking/packing/shipping lifecycle (incl. shipment->invoice).

Stock is always posted through inventory.post_journal_entry so the ledger,
stock_lines and product.quantity stay consistent, and sales flow through
inventory.allocate_lots exactly like the checkout API does. Shipments
mirror the pick/pack/ship endpoints (transfer to staging, then SHIP).
"""

import random
from datetime import date, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import Base, engine, SessionLocal, run_migrations
from app.models import (
    ASN, ASNItem, BOM, BOMItem, Category, Customer, CycleCount, CycleCountItem,
    DocumentSequence, LPN, Location, Lot, LotLink, Notification, Order, OrderItem,
    Product, QualityCheck, Receipt, ReceiptItem, Sale, SaleItem, SerialNumber,
    Shipment, ShipmentItem, StockLine, StockMovement, Supplier, User,
    WorkOrder, WorkOrderItem,
)
from app.models.activity_log import ActivityLog
from app.models.settings import Settings
from app.services import inventory
from app.services.auth import hash_password
from app.services.sequences import next_document_number

random.seed(42)


def wipe_all(db):
    db.query(StockMovement).delete()
    db.query(StockLine).delete()
    db.query(LotLink).delete()
    db.query(WorkOrderItem).delete()
    db.query(WorkOrder).delete()
    db.query(QualityCheck).delete()
    db.query(BOMItem).delete()
    db.query(BOM).delete()
    db.query(SerialNumber).delete()
    db.query(ASNItem).delete()
    db.query(ASN).delete()
    db.query(ReceiptItem).delete()
    db.query(Receipt).delete()
    db.query(CycleCountItem).delete()
    db.query(CycleCount).delete()
    db.query(Lot).delete()
    db.query(LPN).delete()
    db.query(ShipmentItem).delete()
    db.query(Shipment).delete()
    db.query(SaleItem).delete()
    db.query(Sale).delete()
    db.query(OrderItem).delete()
    db.query(Order).delete()
    db.query(Product).delete()
    db.query(Location).delete()
    db.query(Notification).delete()
    db.query(ActivityLog).delete()
    db.query(Customer).delete()
    db.query(Supplier).delete()
    db.query(Category).delete()
    db.query(DocumentSequence).delete()
    db.query(Settings).delete()
    db.query(User).delete()
    try:
        db.execute(text("DELETE FROM sqlite_sequence"))
    except Exception:
        pass
    db.commit()


def days_ago(n, hour=10, minute=0):
    return datetime.now() - timedelta(days=n, hours=hour, minutes=minute)


def _sellable(db: Session, product_id: int) -> int:
    """Quantity available for sale: stock lines with no lot or an in-stock lot."""
    return int(db.execute(
        select(func.coalesce(func.sum(StockLine.quantity), 0))
        .outerjoin(Lot, StockLine.lot_id == Lot.id)
        .where(
            StockLine.product_id == product_id,
            StockLine.quantity > 0,
            (StockLine.lot_id.is_(None)) | (Lot.status == "in_stock"),
        )
    ).scalar() or 0)


def _post(db, user, product, qty, mtype, ts, to_loc=None, from_loc=None,
          lot=None, lpn=None, serial_id=None, ref_type="", ref="", notes=""):
    """Post one journal entry and backdate it."""
    movement = inventory.post_journal_entry(
        db, product_id=product.id, user_id=user.id,
        quantity_change=qty, movement_type=mtype,
        to_location_id=to_loc, from_location_id=from_loc,
        lot_id=lot, lpn_id=lpn, serial_id=serial_id,
        reference_type=ref_type, reference=ref, notes=notes,
    )
    movement.created_at = ts
    return movement


def create_users(db):
    users = [
        User(username="admin", email="admin@inventory.com",
             password_hash=hash_password("admin123"), role="admin", created_at=days_ago(45)),
        User(username="michael", email="michael@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(40)),
        User(username="sarah", email="sarah@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(35)),
        User(username="david", email="david@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(30)),
    ]
    db.add_all(users)
    db.commit()
    for u in users:
        db.refresh(u)
    return users


def create_settings(db):
    s = Settings(
        store_name="Joey's Inventory",
        address="123 Main Street, Springfield",
        phone="555-0100",
        email="store@inventory.com",
        currency_symbol="$",
        tax_rate=7.5,
        default_reorder_level=10,
    )
    db.add(s)
    db.commit()
    return s


def create_locations(db):
    """Hierarchical warehouse: building -> aisles -> shelves -> bins."""
    locs: dict[str, Location] = {}

    def add(name, code, ltype, parent=None):
        loc = Location(name=name, code=code, location_type=ltype,
                       parent_id=parent.id if parent else None, is_active=True,
                       created_at=days_ago(60))
        db.add(loc)
        db.flush()
        locs[code] = loc
        return loc

    root = add("Main Warehouse", "WH-MAIN", "storage")
    add("Receiving Dock", "R-DOCK", "receiving", root)
    add("Staging Area", "STAGE", "storage", root)
    add("Shipping Dock", "SHIP", "shipping", root)
    add("Work In Progress", "WIP", "wip", root)

    aisle_specs = [
        ("A", "Electronics", ["A-01", "A-02", "A-03", "A-04"]),
        ("B", "Office Supplies", ["B-01", "B-02", "B-03"]),
        ("C", "Beverages", ["C-01", "C-02", "C-03"]),
        ("D", "Cleaning", ["D-01", "D-02"]),
    ]
    for aisle_letter, _label, shelves in aisle_specs:
        aisle = add(f"Aisle {aisle_letter}", f"AISLE-{aisle_letter}", "aisle", root)
        for shelf_code in shelves:
            shelf = add(f"Shelf {shelf_code}", shelf_code, "shelf", aisle)
            bin_count = 3 if shelf_code in ("A-01", "A-02", "A-03", "A-04", "B-01", "B-02", "C-01", "C-02", "D-01") else 2
            for i in range(1, bin_count + 1):
                bin_code = f"{shelf_code}-0{i}"
                add(f"Bin {bin_code}", bin_code, "bin", shelf)

    db.commit()
    return locs


def create_categories(db):
    data = [
        ("Electronics", "", None),
        ("Computers", "Desktops, laptops and peripherals", None),
        ("Phones", "Smartphones, chargers and accessories", None),
        ("Audio", "Speakers, headphones and sound gear", None),
        ("Office Supplies", "Everyday consumables for the office", None),
        ("Paper Products", "Paper, envelopes and sticky notes", None),
        ("Writing Instruments", "Pens, markers and highlighters", None),
        ("Beverages", "Drinks for the break room", None),
        ("Coffee & Tea", "Hot beverages", None),
        ("Soft Drinks", "Chilled beverages", None),
        ("Cleaning Supplies", "Janitorial and hygiene products", None),
    ]
    cats = {}
    for name, desc, parent in data:
        c = Category(name=name, description=desc, parent_id=parent, created_at=days_ago(40))
        db.add(c)
        db.commit()
        db.refresh(c)
        cats[name] = c
    subs = {
        "Computers": "Electronics", "Phones": "Electronics", "Audio": "Electronics",
        "Paper Products": "Office Supplies", "Writing Instruments": "Office Supplies",
        "Coffee & Tea": "Beverages", "Soft Drinks": "Beverages",
    }
    for sub, par in subs.items():
        cats[sub].parent_id = cats[par].id
    db.commit()
    return cats


def create_suppliers(db):
    data = [
        ("TechSource Distribution", "Karen Liu", "sales@techsource.example", "555-0101",
         "1200 Commerce Way, Portland, OR", "Electronics wholesaler, ships nationwide."),
        ("GlobalOffice Partners", "Robert Chen", "orders@globaloffice.example", "555-0102",
         "88 Business Park Dr, Austin, TX", "Office supplies with bulk discounts."),
        ("Beverage Wholesale Co", "Maria Gomez", "hello@beveragewholesale.example", "555-0103",
         "450 Harbor Blvd, Seattle, WA", "Local distributor for coffee and drinks."),
        ("CleanSupplies Ltd", "David Okafor", "contact@cleansupplies.example", "555-0104",
         "12 Industrial Rd, Chicago, IL", "Janitorial supplies and hygiene products."),
        ("ACME Paper Co", "Helen Zhang", "info@acmepaper.example", "555-0105",
         "300 Mill Street, Dayton, OH", "Paper and packaging specialist."),
        ("Sunrise Electronics", "Tom Nakamura", "sales@sunriseelec.example", "555-0106",
         "77 Tech Park Ave, San Jose, CA", "Components and consumer electronics."),
        ("PrimeData Systems", "Alice Foster", "b2b@primedata.example", "555-0107",
         "55 Innovation Ct, Denver, CO", "IT equipment and peripherals."),
        ("DrinksDirect", "Omar Haddad", "support@drinksdirect.example", "555-0108",
         "909 Canopy St, Miami, FL", "Soft drinks and energy beverages."),
    ]
    suppliers = []
    for name, contact, email, phone, addr, notes in data:
        s = Supplier(name=name, contact_person=contact, email=email, phone=phone,
                     address=addr, notes=notes, created_at=days_ago(38))
        db.add(s)
        db.commit()
        db.refresh(s)
        suppliers.append(s)
    return suppliers


def create_customers(db):
    data = [
        ("Acme Retail Store", "555-0201", "purchasing@acmeretail.example",
         "12 Main St, Springfield", "frequent", "Monthly bulk buyer."),
        ("Downtown Cafe", "555-0202", "orders@downtowncafe.example",
         "340 Elm Ave, Springfield", "frequent", "Weekly coffee and cup orders."),
        ("FreshMart Grocery", "555-0203", "buyer@freshmart.example",
         "800 Market Blvd, Lakeside", "frequent", "Large grocery account."),
        ("Jane Doe", "555-0204", "jane.doe@example.com",
         "55 Oak Lane, Springfield", "walk-in", ""),
        ("TechNest Ltd", "555-0205", "it@technest.example",
         "910 Innovation Dr, Riverton", "frequent", "Buys electronics quarterly."),
        ("City Office Hub", "555-0206", "procurement@cityoffice.example",
         "77 Civic Center, Springfield", "frequent", "Office supplies for 200 staff."),
        ("John Smith", "555-0207", "john.smith@example.com",
         "23 Birch St, Lakeside", "walk-in", ""),
        ("Bright Learning Center", "555-0208", "admin@brightlearning.example",
         "150 School Rd, Riverton", "frequent", "Seasonal school supply orders."),
    ]
    customers = []
    for name, phone, email, addr, ctype, notes in data:
        c = Customer(name=name, phone=phone, email=email, address=addr,
                     customer_type=ctype, notes=notes, is_active=True, created_at=days_ago(36))
        db.add(c)
        db.commit()
        db.refresh(c)
        customers.append(c)
    return customers


def build_products(db, cats, suppliers, locs):
    sup = {s.name: s for s in suppliers}
    cat = {c.name: c for c in cats.values()}
    rows = [
        # sku, name, desc, category, supplier, unit, cost, reorder, bin, barcode
        ("TECH-001", "Laptop Stand Pro", "Ergonomic aluminum laptop stand",
         "Computers", "TechSource Distribution", 89.99, 45.00, 10, "A-01-01", "490000000001"),
        ("TECH-002", "Wireless Mouse M300", "Silent 2.4G wireless mouse",
         "Computers", "PrimeData Systems", 24.99, 12.50, 15, "A-01-02", "490000000002"),
        ("TECH-003", "Mechanical Keyboard K87", "Tenkeyless hot-swap mechanical keyboard",
         "Computers", "PrimeData Systems", 59.99, 32.00, 10, "A-01-03", "490000000003"),
        ("TECH-004", "Smartphone Charger 65W", "GaN fast charger with USB-C",
         "Phones", "TechSource Distribution", 34.99, 18.00, 20, "A-02-01", "490000000004"),
        ("TECH-005", "USB-C Cable 2m", "Braided USB-C to USB-C cable",
         "Phones", "TechSource Distribution", 12.99, 5.00, 30, "A-02-02", "490000000005"),
        ("TECH-006", "Phone Stand Alu", "Adjustable aluminum phone stand",
         "Phones", "Sunrise Electronics", 14.99, 7.20, 10, "A-02-03", "490000000006"),
        ("TECH-007", "Bluetooth Speaker Mini", "Portable IPX7 waterproof speaker",
         "Audio", "TechSource Distribution", 44.99, 25.00, 12, "A-03-01", "490000000007"),
        ("TECH-008", "Noise-Cancelling Headphones", "Over-ear ANC wireless headphones",
         "Audio", "PrimeData Systems", 149.99, 85.00, 5, "A-03-02", "490000000008"),
        ("TECH-009", "Studio Mic Kit", "USB condenser mic with pop filter",
         "Audio", "Sunrise Electronics", 99.99, 55.00, 6, "A-03-03", "490000000009"),
        ("OFF-010", "A4 Paper Ream (500)", "80gsm multi-purpose copy paper",
         "Paper Products", "ACME Paper Co", 6.99, 3.80, 50, "B-01-01", "490000000010"),
        ("OFF-011", "Sticky Notes 3x3", "Assorted color sticky notes, 12 pads",
         "Paper Products", "GlobalOffice Partners", 3.49, 1.20, 40, "B-01-02", "490000000011"),
        ("OFF-012", "Letter Envelopes Pack", "Self-seal envelopes, pack of 100",
         "Paper Products", "ACME Paper Co", 8.99, 4.50, 25, "B-01-03", "490000000012"),
        ("OFF-013", "Gel Pens 12pk", "Smooth-writing gel pens, 0.5mm",
         "Writing Instruments", "GlobalOffice Partners", 9.99, 4.20, 30, "B-02-01", "490000000013"),
        ("OFF-014", "Highlighter 5pk", "Chisel tip fluorescent highlighters",
         "Writing Instruments", "GlobalOffice Partners", 7.49, 3.10, 20, "B-02-02", "490000000014"),
        ("OFF-015", "Whiteboard Markers 8pk", "Low-odor dry erase markers",
         "Writing Instruments", "ACME Paper Co", 11.99, 5.80, 15, "B-02-03", "490000000015"),
        ("BEV-016", "Ground Coffee 1kg", "Medium roast whole bean coffee",
         "Coffee & Tea", "Beverage Wholesale Co", 18.99, 11.00, 15, "C-01-01", "490000000016"),
        ("BEV-017", "Green Tea Box 20", "Organic green tea bags, 20 count",
         "Coffee & Tea", "Beverage Wholesale Co", 9.49, 5.50, 20, "C-01-02", "490000000017"),
        ("BEV-018", "Espresso Capsules 10", "Compatible espresso pods, 10 pack",
         "Coffee & Tea", "Beverage Wholesale Co", 12.99, 7.80, 15, "C-01-03", "490000000018"),
        ("BEV-019", "Sparkling Water 24pk", "Naturally sparkling mineral water",
         "Soft Drinks", "DrinksDirect", 14.99, 8.00, 10, "C-02-01", "490000000019"),
        ("BEV-030", "Beverage Combo Pack", "Coffee, tea and espresso combo box",
         "Coffee & Tea", "Beverage Wholesale Co", 24.99, 10.50, 5, "C-03-01", "490000000031"),
        ("BEV-020", "Cola 12pk", "Classic cola, 330ml cans",
         "Soft Drinks", "DrinksDirect", 7.99, 4.20, 40, "C-02-02", "490000000020"),
        ("BEV-021", "Energy Drink 24pk", "Sugar-free energy drink, 250ml",
         "Soft Drinks", "DrinksDirect", 29.99, 16.50, 12, "C-02-03", "490000000021"),
        ("CLN-022", "All-Purpose Cleaner 1L", "Multi-surface disinfectant spray",
         "Cleaning Supplies", "CleanSupplies Ltd", 5.99, 2.40, 50, "D-01-01", "490000000022"),
        ("CLN-023", "Microfiber Cloths 10pk", "Reusable lint-free cleaning cloths",
         "Cleaning Supplies", "CleanSupplies Ltd", 12.99, 6.00, 20, "D-01-02", "490000000023"),
        ("CLN-024", "Hand Sanitizer 500ml", "Alcohol gel hand sanitizer pump",
         "Cleaning Supplies", "CleanSupplies Ltd", 4.99, 1.80, 30, "D-01-03", "490000000024"),
    ]
    products = []
    by_sku = {}
    lot_info = {
        # sku -> (batch_number, expiry_offset_days, extra_lots)
        "BEV-016": ("B-9161", 150, [("B-8150", -3, "expired")]),
        "BEV-017": ("B-8170", 25, [("Q-7090", 80, "quarantined")]),
        "BEV-018": ("B-8180", 45, []),
        "BEV-021": ("B-8211", 12, []),
    }
    for sku, name, desc, cat_name, sup_name, unit, cost, reorder, bin_code, barcode in rows:
        batch, expiry_off, extra = lot_info.get(sku, ("", None, []))
        p = Product(sku=sku, name=name, description=desc, category_id=cat[cat_name].id,
                    supplier_id=sup[sup_name].id, unit_price=unit, cost_price=cost,
                    quantity=0, reorder_level=reorder, location=bin_code,
                    location_id=locs[bin_code].id, barcode=barcode,
                    batch_number=batch,
                    expiry_date=date.today() + timedelta(days=expiry_off) if expiry_off is not None else None,
                    is_active=True, created_at=days_ago(random.randint(20, 30)))
        db.add(p)
        db.commit()
        db.refresh(p)
        products.append(p)
        by_sku[sku] = p

    # Variant demo: parent holds no stock, variants hold stock at A-04-01.
    parent = Product(
        sku="TECH-025", name="Wireless Earbuds Pro",
        description="True wireless earbuds with active noise cancelling",
        category_id=cat["Audio"].id, supplier_id=sup["PrimeData Systems"].id,
        unit_price=129.99, cost_price=72.00, quantity=0, reorder_level=10,
        location="A-04-01", location_id=locs["A-04-01"].id, barcode="490000000025",
        is_active=True, created_at=days_ago(18),
    )
    db.add(parent)
    db.commit()
    db.refresh(parent)
    for sku, attrs, barcode in [
        ("TECH-025-BLK", {"Color": "Black"}, "490000000026"),
        ("TECH-025-WHT", {"Color": "White"}, "490000000027"),
        ("TECH-025-GRN", {"Color": "Green"}, "490000000028"),
    ]:
        v = Product(
            sku=sku, name=parent.name, category_id=parent.category_id,
            supplier_id=parent.supplier_id, parent_id=parent.id, attributes=attrs,
            unit_price=129.99, cost_price=72.00, quantity=0, reorder_level=5,
            location="A-04-01", location_id=locs["A-04-01"].id, barcode=barcode,
            is_active=True, created_at=days_ago(18),
        )
        db.add(v)
        db.commit()
        db.refresh(v)
        products.append(v)
        by_sku[sku] = v
    products.append(parent)
    by_sku["TECH-025"] = parent

    # Serialized product.
    serial_prod = Product(
        sku="TECH-030", name="Smart Watch Pro",
        description="GPS smart watch with health monitoring",
        category_id=cat["Phones"].id, supplier_id=sup["Sunrise Electronics"].id,
        unit_price=249.99, cost_price=140.00, quantity=0, reorder_level=3,
        is_serialized=True, location="A-04-02", location_id=locs["A-04-02"].id,
        barcode="490000000030", is_active=True, created_at=days_ago(25),
    )
    db.add(serial_prod)
    db.commit()
    db.refresh(serial_prod)
    products.append(serial_prod)
    by_sku["TECH-030"] = serial_prod

    db.commit()
    return products, by_sku


def create_lots(db, by_sku, suppliers):
    sup = {s.name: s for s in suppliers}
    lots: dict[str, dict[str, Lot]] = {}
    specs = [
        ("BEV-016", "B-9161", 150, "in_stock", "Beverage Wholesale Co"),
        ("BEV-016", "B-8150", -3, "expired", "Beverage Wholesale Co"),
        ("BEV-017", "B-8170", 25, "in_stock", "Beverage Wholesale Co"),
        ("BEV-017", "Q-7090", 80, "quarantined", "Beverage Wholesale Co"),
        ("BEV-018", "B-8180", 45, "in_stock", "Beverage Wholesale Co"),
        ("BEV-021", "B-8211", 12, "in_stock", "DrinksDirect"),
    ]
    for sku, lot_number, expiry_off, status, sup_name in specs:
        lot = Lot(product_id=by_sku[sku].id, lot_number=lot_number,
                  supplier_id=sup[sup_name].id,
                  expiry_date=date.today() + timedelta(days=expiry_off),
                  received_date=days_ago(random.randint(20, 30)).date(),
                  status=status, created_at=days_ago(random.randint(20, 30)))
        db.add(lot)
        db.commit()
        db.refresh(lot)
        lots.setdefault(sku, {})[lot_number] = lot
    return lots


def create_serialized_stock(db, users, by_sku, locs):
    """Create serials and post receive movements for the serialized product."""
    admin = next(u for u in users if u.role == "admin")
    product = by_sku["TECH-030"]
    bin_id = locs["A-04-02"].id
    serials = []
    created = days_ago(25, hour=9)
    for i in range(1, 16):
        s = SerialNumber(product_id=product.id, serial_number=f"SW-{i:04d}",
                         location_id=bin_id, status=inventory.SERIAL_STATUS_IN_STOCK,
                         created_at=created)
        db.add(s)
        db.commit()
        db.refresh(s)
        serials.append(s)
    for i, s in enumerate(serials):
        _post(db, admin, product, 1, inventory.RECEIVE,
              created + timedelta(hours=i), to_loc=bin_id, serial_id=s.id,
              ref_type="receipt", ref="RCP-0006",
              notes="Initial stock - Smart Watch Pro")
    db.commit()
    return serials


def create_lpns(db, locs):
    specs = [
        ("PAL-1001", "pallet", "B-03-01", "active"),
        ("PAL-1002", "pallet", "B-03-02", "active"),
        ("BOX-3001", "carton", "A-04-02", "active"),
        ("PAL-1003", "pallet", "R-DOCK", "active"),
    ]
    lpns = {}
    for number, ltype, bin_code, status in specs:
        lpn = LPN(lpn_number=number, lpn_type=ltype, location_id=locs[bin_code].id,
                  status=status, created_at=days_ago(30))
        db.add(lpn)
        db.commit()
        db.refresh(lpn)
        lpns[number] = lpn
    return lpns


def create_lpn_stock(db, users, by_sku, lots, lpns, locs):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    plans = [
        ("OFF-010", "PAL-1001", "B-03-01", 40, None),
        ("OFF-012", "PAL-1002", "B-03-02", 20, None),
        ("TECH-003", "BOX-3001", "A-04-02", 6, None),
    ]
    for sku, lpn_num, bin_code, qty, lot_num in plans:
        _post(db, worker, by_sku[sku], qty, inventory.RECEIVE,
              days_ago(22, hour=13), to_loc=locs[bin_code].id,
              lot=lots[sku][lot_num].id if lot_num else None,
              lpn=lpns[lpn_num].id,
              ref_type="lpn", ref=f"Loaded {lpn_num}",
              notes=f"Stock loaded onto {lpn_num}")
    db.commit()


def create_orders(db, users, suppliers, by_sku):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    sup = {s.name: s for s in suppliers}

    order_specs = [
        (28, "received", "TechSource Distribution", "Initial electronics order",
         [("TECH-001", 8, 40.00), ("TECH-004", 25, 16.50), ("TECH-007", 15, 22.00)]),
        (24, "received", "ACME Paper Co", "Office paper replenishment",
         [("OFF-010", 100, 3.20), ("OFF-012", 40, 3.90)]),
        (21, "received", "GlobalOffice Partners", "Stationery restock",
         [("OFF-011", 80, 1.00), ("OFF-013", 50, 3.60), ("OFF-014", 40, 2.70)]),
        (16, "received", "Beverage Wholesale Co", "Break room coffee",
         [("BEV-016", 15, 9.50), ("BEV-017", 30, 4.80), ("BEV-018", 20, 6.50)]),
        (12, "received", "CleanSupplies Ltd", "Janitorial restock",
         [("CLN-022", 60, 2.00), ("CLN-023", 30, 5.20), ("CLN-024", 40, 1.50)]),
        (8, "pending", "PrimeData Systems", "Peripherals order",
         [("TECH-002", 30, 11.00), ("TECH-003", 20, 29.00)]),
        (5, "pending", "DrinksDirect", "Soft drinks replenishment",
         [("BEV-020", 60, 3.80), ("BEV-021", 12, 15.00)]),
        (3, "pending", "TechSource Distribution", "Accessories restock",
         [("TECH-005", 80, 4.20), ("TECH-006", 20, 6.00)]),
        (2, "cancelled", "Sunrise Electronics", "Cancelled - wrong pricing",
         [("TECH-009", 10, 50.00)]),
        (1, "pending", "ACME Paper Co", "Paper reorder",
         [("OFF-010", 120, 3.20)]),
    ]

    orders = []
    po_counter = 1
    for created, status, sup_name, notes, items in order_specs:
        total = sum(q * price for _, q, price in items)
        order = Order(order_number=f"PO-{po_counter:04d}", supplier_id=sup[sup_name].id,
                      user_id=admin.id if status == "pending" else worker.id,
                      status=status, total_amount=total, notes=notes,
                      created_at=days_ago(created, hour=9))
        db.add(order)
        db.commit()
        db.refresh(order)
        for sku, qty, price in items:
            db.add(OrderItem(order_id=order.id, product_id=by_sku[sku].id,
                             quantity=qty, unit_price=price))
        orders.append(order)
        po_counter += 1
    db.commit()
    return orders


def create_receipts(db, users, suppliers, by_sku, lots, locs):
    """Receipts drive the receive movements for the received purchase orders."""
    worker = next(u for u in users if u.role == "worker")
    sup = {s.name: s for s in suppliers}
    specs = [
        # (days_ago, supplier, reference, notes, [(sku, qty, cost, bin, lot_num)])
        (27, "TechSource Distribution", "PO-0001", "Electronics receiving",
         [("TECH-001", 8, 40.00, "A-01-01", None),
          ("TECH-004", 25, 16.50, "A-02-01", None),
          ("TECH-007", 15, 22.00, "A-03-01", None)]),
        (23, "ACME Paper Co", "PO-0002", "Paper receiving",
         [("OFF-010", 100, 3.20, "B-01-01", None),
          ("OFF-012", 40, 3.90, "B-01-03", None)]),
        (20, "GlobalOffice Partners", "PO-0003", "Stationery receiving",
         [("OFF-011", 80, 1.00, "B-01-02", None),
          ("OFF-013", 50, 3.60, "B-02-01", None),
          ("OFF-014", 40, 2.70, "B-02-02", None)]),
        (15, "Beverage Wholesale Co", "PO-0004", "Coffee and tea receiving",
         [("BEV-016", 15, 9.50, "C-01-01", "B-9161"),
          ("BEV-017", 30, 4.80, "C-01-02", "B-8170"),
          ("BEV-018", 20, 6.50, "C-01-03", "B-8180")]),
        (11, "CleanSupplies Ltd", "PO-0005", "Janitorial receiving",
         [("CLN-022", 60, 2.00, "D-01-01", None),
          ("CLN-023", 30, 5.20, "D-01-02", None),
          ("CLN-024", 40, 1.50, "D-01-03", None)]),
    ]
    receipts = []
    rcp_counter = 1
    for created, sup_name, reference, notes, items in specs:
        total_qty = sum(q for _, q, _, _, _ in items)
        total_cost = sum(q * cost for _, q, cost, _, _ in items)
        receipt = Receipt(receipt_number=f"RCP-{rcp_counter:04d}",
                          supplier_id=sup[sup_name].id, user_id=worker.id,
                          reference=reference, notes=notes,
                          total_quantity=total_qty, total_cost=total_cost,
                          created_at=days_ago(created, hour=11))
        db.add(receipt)
        db.flush()
        for sku, qty, cost, bin_code, lot_num in items:
            lot = lots[sku][lot_num].id if lot_num else None
            db.add(ReceiptItem(receipt_id=receipt.id, product_id=by_sku[sku].id,
                               quantity=qty, unit_cost=cost, lot_id=lot,
                               location_id=locs[bin_code].id))
            _post(db, worker, by_sku[sku], qty, inventory.RECEIVE,
                  days_ago(created, hour=12), to_loc=locs[bin_code].id, lot=lot,
                  ref_type="receipt", ref=receipt.receipt_number, notes=notes)
        receipts.append(receipt)
        rcp_counter += 1
    db.commit()
    return receipts


def create_asns(db, users, suppliers, by_sku, lots, locs):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    sup = {s.name: s for s in suppliers}
    asns = []
    asn_counter = 1

    # 1) Pending - accessories from TechSource (matches pending PO-0008).
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["TechSource Distribution"].id, user_id=admin.id,
              expected_arrival=date.today() + timedelta(days=5),
              notes="Accessories restock - awaiting carrier",
              created_at=days_ago(2, hour=9))
    db.add(asn)
    db.flush()
    for sku, qty, cost, bin_code in [("TECH-005", 80, 4.20, "A-02-02"),
                                     ("TECH-006", 20, 6.00, "A-02-03")]:
        db.add(ASNItem(asn_id=asn.id, product_id=by_sku[sku].id, expected_qty=qty,
                       unit_cost=cost, location_id=locs[bin_code].id))
    asns.append(asn)
    asn_counter += 1

    # 2) Partial - keyboards/mice from PrimeData (matches pending PO-0006).
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["PrimeData Systems"].id, user_id=admin.id,
              expected_arrival=date.today() + timedelta(days=2),
              notes="Partial delivery - backorder remaining",
              created_at=days_ago(6, hour=10))
    db.add(asn)
    db.flush()
    db.add(ASNItem(asn_id=asn.id, product_id=by_sku["TECH-002"].id,
                   expected_qty=30, unit_cost=11.00, location_id=locs["A-01-02"].id))
    db.add(ASNItem(asn_id=asn.id, product_id=by_sku["TECH-003"].id,
                   expected_qty=20, unit_cost=29.00, location_id=locs["A-01-03"].id))
    db.flush()
    item = db.query(ASNItem).filter(ASNItem.asn_id == asn.id,
                                    ASNItem.product_id == by_sku["TECH-002"].id).first()
    item.received_qty = 15
    _post(db, worker, by_sku["TECH-002"], 15, inventory.RECEIVE,
          days_ago(5, hour=12), to_loc=locs["A-01-02"].id,
          ref_type="asn", ref=asn.asn_number, notes=asn.notes)
    asns.append(asn)
    asn_counter += 1

    # 3) Fully received - soft drinks from DrinksDirect.
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["DrinksDirect"].id, user_id=worker.id,
              expected_arrival=days_ago(7).date(), notes="Soft drinks delivery",
              status="received", received_at=days_ago(7, hour=14),
              created_at=days_ago(10, hour=9))
    db.add(asn)
    db.flush()
    for sku, qty, cost, bin_code, lot_num in [("BEV-020", 24, 4.00, "C-02-02", None),
                                              ("BEV-021", 12, 15.00, "C-02-03", "B-8211")]:
        lot = lots[sku][lot_num].id if lot_num else None
        db.add(ASNItem(asn_id=asn.id, product_id=by_sku[sku].id, expected_qty=qty,
                       received_qty=qty, unit_cost=cost, location_id=locs[bin_code].id))
        _post(db, worker, by_sku[sku], qty, inventory.RECEIVE,
              days_ago(7, hour=13), to_loc=locs[bin_code].id,
              lot=lot,
              ref_type="asn", ref=asn.asn_number, notes=asn.notes)
    asns.append(asn)
    asn_counter += 1

    db.commit()
    return asns


def create_opening_stock(db, users, by_sku, lots, locs):
    worker = next(u for u in users if u.role == "worker")
    opening = {
        # sku -> [(bin_code, qty, lot_number | None)]
        "TECH-002": [("A-01-02", 40, None)],
        "TECH-003": [("A-01-03", 25, None)],
        "TECH-004": [("A-02-01", 35, None)],
        "TECH-005": [("A-02-02", 120, None)],
        "TECH-006": [("A-02-03", 35, None)],
        "TECH-007": [("A-03-01", 15, None)],
        "TECH-008": [("A-03-02", 3, None)],
        "TECH-009": [("A-03-03", 12, None)],
        "OFF-011": [("B-01-02", 70, None)],
        "OFF-012": [("B-01-03", 20, None)],
        "OFF-013": [("B-02-01", 40, None)],
        "OFF-014": [("B-02-02", 35, None)],
        "OFF-015": [("B-02-03", 45, None)],
        "BEV-016": [("C-01-01", 2, "B-8150")],          # expired lot still on hand
        "BEV-017": [("C-01-02", 5, "Q-7090")],          # quarantined lot still on hand
        "BEV-018": [("C-01-03", 20, "B-8180")],
        "BEV-020": [("C-02-02", 76, None)],
        "CLN-022": [("D-01-01", 70, None)],
        "CLN-023": [("D-01-02", 30, None)],
        "CLN-024": [("D-01-03", 45, None)],
        "TECH-025-BLK": [("A-04-01", 18, None)],
        "TECH-025-WHT": [("A-04-01", 12, None)],
        "TECH-025-GRN": [("A-04-01", 5, None)],
    }
    for sku, bins in opening.items():
        for bin_code, qty, lot_num in bins:
            _post(db, worker, by_sku[sku], qty, inventory.RECEIVE,
                  days_ago(random.randint(26, 30), hour=8),
                  to_loc=locs[bin_code].id,
                  lot=lots[sku][lot_num].id if lot_num else None,
                  ref_type="opening", ref="Initial stock",
                  notes="Opening balance")
    db.commit()


def create_transfers(db, users, by_sku, lots, locs):
    worker = next(u for u in users if u.role == "worker")
    plans = [
        ("OFF-011", 10, "B-01-02", "B-03-01", None, 9),
        ("BEV-018", 5, "C-01-03", "C-03-01", "B-8180", 6),
    ]
    for sku, qty, from_bin, to_bin, lot_num, days in plans:
        out, inbound = inventory.transfer_stock(
            db, product_id=by_sku[sku].id, user_id=worker.id, quantity=qty,
            from_location_id=locs[from_bin].id, to_location_id=locs[to_bin].id,
            lot_id=lots[sku][lot_num].id if lot_num else None,
            reference_type="transfer", reference=f"TRF-{plans.index((sku, qty, from_bin, to_bin, lot_num, days)) + 1:04d}",
            notes=f"Replenishment to {to_bin}",
        )
        out.created_at = days_ago(days, hour=14)
        inbound.created_at = days_ago(days, hour=14, minute=5)
    db.commit()


def create_sales(db, users, customers, products, by_sku):
    """Sales that flow through inventory.allocate_lots exactly like checkout."""
    worker = next(u for u in users if u.role == "worker")
    settings = db.query(Settings).first()
    tax_rate = settings.tax_rate if settings else 0.0

    pool = []
    for p in products:
        if p.is_serialized:
            continue
        sellable = _sellable(db, p.id)
        if sellable <= 0:
            continue
        qty = max(1, min(4, sellable // 10))
        pool.append((p, qty))
    random.shuffle(pool)

    sale_records = []
    counter = 1
    customer_idx = 0
    while pool:
        group = []
        while pool and len(group) < random.randint(2, 4):
            group.append(pool.pop())
        customer = customers[customer_idx % len(customers)]
        customer_idx += 1
        subtotal = 0.0
        for p, qty in group:
            subtotal += float(p.unit_price) * qty
        tax = subtotal * tax_rate / 100
        created = days_ago(random.randint(2, 20), hour=random.randint(10, 18))
        invoice = f"INV-{counter:04d}"
        sale = Sale(
            invoice_number=invoice, customer_id=customer.id, user_id=worker.id,
            subtotal=subtotal, tax_amount=tax, total_amount=subtotal + tax,
            status="completed", payment_method=random.choice(["cash", "card", "transfer"]),
            created_at=created,
        )
        db.add(sale)
        db.flush()
        for p, qty in group:
            db.add(SaleItem(sale_id=sale.id, product_id=p.id, quantity=qty,
                            unit_price=float(p.unit_price)))
            allocation = inventory.allocate_lots(db, product_id=p.id, quantity=qty)
            for lot_id, take, location_id, lpn_id in allocation:
                _post(db, worker, p, -take, "out",
                      created + timedelta(minutes=random.randint(1, 25)),
                      from_loc=location_id, lot=lot_id, lpn=lpn_id,
                      ref_type="sale", ref=invoice,
                      notes=f"Sale to {customer.name}")
        sale_records.append({
            "id": sale.id, "invoice": invoice, "customer": customer,
            "created_at": created, "items": [(p.id, qty) for p, qty in group],
        })
        counter += 1
    db.commit()
    return sale_records, counter - 1


def create_serialized_sales(db, users, customers, serials, by_sku, locs):
    """Three single-unit sales of the serialized product."""
    worker = next(u for u in users if u.role == "worker")
    product = by_sku["TECH-030"]
    settings = db.query(Settings).first()
    tax_rate = settings.tax_rate if settings else 0.0
    records = []
    for i, serial in enumerate(serials[12:15]):
        customer = customers[i % len(customers)]
        created = days_ago(3 + i * 2, hour=15)
        price = float(product.unit_price)
        tax = price * tax_rate / 100
        invoice = f"INV-S{i + 1:04d}"
        sale = Sale(invoice_number=invoice, customer_id=customer.id, user_id=worker.id,
                    subtotal=price, tax_amount=tax, total_amount=price + tax,
                    status="completed", payment_method="card",
                    notes=f"Serial {serial.serial_number}", created_at=created)
        db.add(sale)
        db.flush()
        db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=1,
                        unit_price=price))
        _post(db, worker, product, -1, inventory.SALE,
              created + timedelta(minutes=5), from_loc=locs["A-04-02"].id,
              serial_id=serial.id,
              ref_type="sale", ref=invoice, notes=f"Serial {serial.serial_number}")
        records.append({"id": sale.id, "invoice": invoice, "serial": serial.serial_number})
    db.commit()
    return records


def create_returns_and_adjustments(db, users, by_sku, lots, locs):
    worker = next(u for u in users if u.role == "worker")
    admin = next(u for u in users if u.role == "admin")
    _post(db, worker, by_sku["TECH-002"], 2, "return",
          days_ago(4, hour=15), to_loc=locs["A-01-02"].id,
          ref_type="sale_return", ref="RMA-1001",
          notes="Damaged unit returned by customer")
    _post(db, worker, by_sku["OFF-013"], 3, "return",
          days_ago(6, hour=11), to_loc=locs["B-02-01"].id,
          ref_type="sale_return", ref="RMA-1002",
          notes="Defective pens returned")
    _post(db, admin, by_sku["BEV-016"], -2, "adjustment",
          days_ago(5, hour=16), to_loc=locs["C-01-01"].id,
          lot=lots["BEV-016"]["B-9161"].id,
          ref="Adjustment (damaged)", notes="Bags burst in storage")
    _post(db, admin, by_sku["CLN-022"], 5, "adjustment",
          days_ago(3, hour=9), to_loc=locs["D-01-01"].id,
          ref="Adjustment (recount)", notes="Cycle count correction")
    db.commit()


def create_cycle_counts(db, users, by_sku, locs):
    worker = next(u for u in users if u.role == "worker")
    cc_specs = [
        # (number, days_ago, bin_code, status, sku, counted_delta | None, notes)
        ("CC-0001", 4, "A-01-01", "completed", "TECH-001", +1, "Shelf count discrepancy"),
        ("CC-0002", 3, "D-01-01", "completed", "CLN-022", -2, "Found fewer than expected"),
        ("CC-0003", 1, "B-02-03", "pending", "OFF-015", None, "Scheduled count"),
        ("CC-0004", 0, "C-02-02", "pending", "BEV-020", None, "Scheduled count"),
    ]
    ccs = []
    for number, days, bin_code, status, sku, delta, notes in cc_specs:
        bin_id = locs[bin_code].id
        cc = CycleCount(cc_number=number, location_id=bin_id, created_by=worker.id,
                        status=status, notes=notes,
                        created_at=days_ago(days + 2, hour=9))
        db.add(cc)
        db.flush()
        expected = inventory.on_hand(db, product_id=by_sku[sku].id, location_id=bin_id)
        item = CycleCountItem(cycle_count_id=cc.id, product_id=by_sku[sku].id,
                              expected_qty=expected,
                              counted_qty=expected + delta if delta is not None else None,
                              variance=delta or 0,
                              status=("ok" if delta in (0, None) else "mismatch"))
        db.add(item)
        if delta:
            _post(db, worker, by_sku[sku], delta, inventory.COUNT,
                  days_ago(days, hour=10), to_loc=bin_id,
                  ref=f"Cycle count {number}",
                  notes=f"Counted {expected + delta}, expected {expected}")
        if status == "completed":
            cc.completed_at = days_ago(days, hour=11)
        ccs.append(cc)
    db.commit()
    return ccs


def create_boms(db, by_sku):
    """Manufacturing demo: a tech kit assembled from stocked components."""
    boms = []
    specs = [
        # (number, output sku, name, [(component sku, qty), ...])
        (1, "TECH-001", "BOM - Laptop Stand Pro", [
            ("TECH-006", 2), ("TECH-005", 1),
        ]),
        (2, "TECH-004", "BOM - Smartphone Charger 65W", [
            ("TECH-005", 2),
        ]),
        (3, "TECH-008", "BOM - Noise-Cancelling Headphones", [
            ("TECH-007", 1), ("TECH-005", 1),
        ]),
        (4, "TECH-030", "BOM - Smart Watch Pro", [
            ("TECH-004", 1), ("TECH-005", 1),
        ]),
        (5, "BEV-030", "BOM - Beverage Combo Pack", [
            ("BEV-016", 1), ("BEV-017", 1), ("BEV-018", 1),
        ]),
    ]
    for idx, (num, out_sku, name, components) in enumerate(specs):
        bom = BOM(product_id=by_sku[out_sku].id, name=name,
                  description="Demo multi-level bill of materials",
                  created_at=days_ago(12 - idx))
        db.add(bom)
        db.flush()
        for pos, (sku, qty) in enumerate(components):
            db.add(BOMItem(bom_id=bom.id, product_id=by_sku[sku].id,
                           quantity=qty, position=pos))
        boms.append(bom)
    db.commit()
    return boms


def create_work_orders(db, users, by_sku, boms, locs):
    """One completed WO (with backflush + FG lot) and one planned WO."""
    worker = next(u for u in users if u.role == "worker")
    admin = next(u for u in users if u.role == "admin")
    wos = []

    completed = WorkOrder(
        wo_number="WO-0001",
        product_id=by_sku["TECH-004"].id,  # Smartphone Charger 65W
        quantity=20, bom_id=boms[1].id, status="completed",
        notes="Backflushed demo run", created_by=admin.id,
        started_at=days_ago(8, hour=9), completed_at=days_ago(7, hour=14),
        created_at=days_ago(9, hour=9),
    )
    db.add(completed)
    db.flush()
    for item in boms[1].items:
        db.add(WorkOrderItem(
            work_order_id=completed.id, product_id=item.product_id,
            quantity_required=item.quantity * 20, quantity_issued=item.quantity * 20,
        ))
    # Receive the finished good (20 chargers) into A-02-01 with a lot.
    lot = Lot(product_id=by_sku["TECH-004"].id, lot_number="FG-4001", status="in_stock",
              received_date=days_ago(7).date())
    db.add(lot)
    db.flush()
    _post(db, worker, by_sku["TECH-004"], 20, inventory.RECEIVE,
          days_ago(7, hour=14), to_loc=locs["A-02-01"].id, lot=lot.id,
          ref="WO-0001", ref_type="work_order", notes="Received from WO-0001 (backflushed)")
    wos.append(completed)

    planned = WorkOrder(
        wo_number="WO-0002",
        product_id=by_sku["TECH-001"].id,  # Laptop Stand Pro
        quantity=15, bom_id=boms[0].id, status="planned",
        notes="Scheduled production run", created_by=admin.id,
        created_at=days_ago(2, hour=10),
    )
    db.add(planned)
    db.flush()
    for item in boms[0].items:
        db.add(WorkOrderItem(
            work_order_id=planned.id, product_id=item.product_id,
            quantity_required=item.quantity * 15, quantity_issued=0,
        ))
    wos.append(planned)

    # WO-0003 (completed): manufacture the Beverage Combo Pack from tracked
    # beverage lots, producing an FG lot and parent->child lot genealogy links.
    combo = WorkOrder(
        wo_number="WO-0003",
        product_id=by_sku["BEV-030"].id,
        quantity=3, bom_id=boms[4].id, status="completed",
        notes="Lot genealogy demo - consumed tracked beverage lots", created_by=admin.id,
        started_at=days_ago(6, hour=9), completed_at=days_ago(5, hour=14),
        created_at=days_ago(7, hour=9),
    )
    db.add(combo)
    db.flush()
    for item in boms[4].items:
        db.add(WorkOrderItem(
            work_order_id=combo.id, product_id=item.product_id,
            quantity_required=item.quantity * 3, quantity_issued=item.quantity * 3,
        ))
    consumed: dict[int, int] = {}
    for item in boms[4].items:
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=item.quantity * 3)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(6, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0003", notes="Issued to WO-0003")
            consumed[lot_id] = consumed.get(lot_id, 0) + take
    fg_lot = Lot(product_id=by_sku["BEV-030"].id, lot_number="FG-3001", status="in_stock",
                 received_date=days_ago(5).date())
    db.add(fg_lot)
    db.flush()
    _post(db, worker, by_sku["BEV-030"], 3, inventory.RECEIVE,
          days_ago(5, hour=14), to_loc=locs["C-03-01"].id, lot=fg_lot.id,
          ref_type="work_order", ref="WO-0003", notes="Received from WO-0003")
    for parent_lot_id, qty in consumed.items():
        db.add(LotLink(parent_lot_id=parent_lot_id, child_lot_id=fg_lot.id,
                       work_order_id=combo.id, quantity=qty))
    wos.append(combo)

    # WO-0004 (completed): serialized manufacturing of Smart Watch Pro,
    # registering two serial numbers (SW-2001 / SW-2002) as it completes.
    watch_wo = WorkOrder(
        wo_number="WO-0004",
        product_id=by_sku["TECH-030"].id,
        quantity=2, bom_id=boms[3].id, status="completed",
        notes="Serialized manufacturing demo - SW-2001, SW-2002", created_by=admin.id,
        started_at=days_ago(4, hour=9), completed_at=days_ago(3, hour=14),
        created_at=days_ago(5, hour=9),
    )
    db.add(watch_wo)
    db.flush()
    for item in boms[3].items:
        db.add(WorkOrderItem(
            work_order_id=watch_wo.id, product_id=item.product_id,
            quantity_required=item.quantity * 2, quantity_issued=item.quantity * 2,
        ))
    for item in boms[3].items:
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=item.quantity * 2)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(4, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0004", notes="Issued to WO-0004")
    for sn in ("SW-2001", "SW-2002"):
        serial = SerialNumber(product_id=by_sku["TECH-030"].id, serial_number=sn,
                              status="in_stock", location_id=locs["A-04-02"].id,
                              created_at=days_ago(3, hour=13))
        db.add(serial)
        db.flush()
        _post(db, worker, by_sku["TECH-030"], 1, inventory.RECEIVE,
              days_ago(3, hour=14), to_loc=locs["A-04-02"].id, serial_id=serial.id,
              ref_type="work_order", ref="WO-0004", notes="Received from WO-0004")
    wos.append(watch_wo)

    db.commit()
    return wos


def create_quality_checks(db, users, by_sku):
    """QC records: one passing inspection and one failed (quarantine) result."""
    admin = next(u for u in users if u.role == "admin")
    coffee = db.query(Lot).filter(
        Lot.product_id == by_sku["BEV-016"].id, Lot.status == "in_stock"
    ).first()
    tea = db.query(Lot).filter(
        Lot.product_id == by_sku["BEV-017"].id, Lot.status == "quarantined"
    ).first()

    passed = QualityCheck(
        qc_number="QC-0001", product_id=by_sku["BEV-016"].id, lot_id=coffee.id,
        batch_number=coffee.lot_number, result="pass",
        notes="Sensory + moisture check passed", checked_by=admin.id,
        checked_at=days_ago(6, hour=11), created_at=days_ago(6, hour=10),
    )
    db.add(passed)

    failed = QualityCheck(
        qc_number="QC-0002", product_id=by_sku["BEV-017"].id, lot_id=tea.id,
        batch_number=tea.lot_number, result="fail",
        notes="Lot quarantined after off-spec inspection", checked_by=admin.id,
        checked_at=days_ago(4, hour=15), created_at=days_ago(4, hour=14),
    )
    db.add(failed)
    db.commit()
    return [passed, failed]


def create_shipments(db, users, customers, by_sku, locs):
    """Shipments across the full fulfillment lifecycle.

    Mirrors the pick/pack/ship endpoints: picking transfers stock to the
    shipping dock, shipping posts SHIP journal entries. One shipped shipment
    is turned into an invoice (the create-sale flow), and a serialized
    shipment exercises unit-level serial tracking.
    """
    worker = next(u for u in users if u.role == "worker")
    cust = {c.name: c for c in customers}
    shipping = locs["SHIP"]
    settings = db.query(Settings).first()
    tax_rate = settings.tax_rate if settings else 0.0
    shipments = []

    def new_shipment(number, customer_name, carrier="", tracking="", notes="", created_days=5):
        s = Shipment(shipment_number=number, customer_id=cust[customer_name].id,
                     carrier=carrier, tracking_number=tracking, notes=notes,
                     created_by=worker.id, created_at=days_ago(created_days, hour=9))
        db.add(s)
        db.flush()
        shipments.append(s)
        return s

    def add_items(s, items):
        for sku, qty in items:
            db.add(ShipmentItem(shipment_id=s.id, product_id=by_sku[sku].id,
                                quantity_ordered=qty))
        db.flush()

    def pick(s, items, ts):
        for sku, qty in items:
            product = by_sku[sku]
            if product.is_serialized:
                serials = inventory.allocate_serials(db, product_id=product.id, quantity=qty)
                for serial in serials:
                    movements = inventory.transfer_stock(
                        db, product_id=product.id, user_id=worker.id, quantity=1,
                        from_location_id=serial.location_id, to_location_id=shipping.id,
                        lot_id=serial.lot_id, serial_id=serial.id,
                        transfer_id=s.id, reference_type="shipment",
                        reference=s.shipment_number,
                        notes=f"Picked to {s.shipment_number}",
                    )
                    for m in movements:
                        m.created_at = ts
            else:
                allocation = inventory.allocate_lots(db, product_id=product.id, quantity=qty)
                for lot_id, take, source_location, lpn_id in allocation:
                    movements = inventory.transfer_stock(
                        db, product_id=product.id, user_id=worker.id, quantity=take,
                        from_location_id=source_location, to_location_id=shipping.id,
                        lot_id=lot_id, lpn_id=lpn_id,
                        transfer_id=s.id, reference_type="shipment",
                        reference=s.shipment_number,
                        notes=f"Picked to {s.shipment_number}",
                    )
                    for m in movements:
                        m.created_at = ts
        for item in s.items:
            item.quantity_picked = item.quantity_ordered
        s.staging_location_id = shipping.id
        s.status = "picking"
        s.updated_at = ts

    def pack(s, ts):
        for item in s.items:
            item.quantity_packed = item.quantity_picked
        s.status = "packed"
        s.updated_at = ts

    def ship(s, ts):
        for item in s.items:
            to_ship = item.quantity_picked - item.quantity_shipped
            if to_ship <= 0:
                continue
            product = item.product
            if product and product.is_serialized:
                serials = inventory.allocate_serials(
                    db, product_id=item.product_id, quantity=to_ship, location_id=shipping.id)
                for serial in serials:
                    m = inventory.post_journal_entry(
                        db, product_id=item.product_id, user_id=worker.id,
                        quantity_change=-1, movement_type=inventory.SHIP,
                        from_location_id=shipping.id, lot_id=serial.lot_id,
                        serial_id=serial.id,
                        reference_type="shipment", reference=s.shipment_number,
                        notes=f"Shipped on {s.shipment_number}",
                    )
                    m.created_at = ts
            else:
                allocation = inventory.allocate_lots(
                    db, product_id=item.product_id, quantity=to_ship, location_id=shipping.id)
                for lot_id, take, source_location, lpn_id in allocation:
                    m = inventory.post_journal_entry(
                        db, product_id=item.product_id, user_id=worker.id,
                        quantity_change=-take, movement_type=inventory.SHIP,
                        from_location_id=source_location, lot_id=lot_id, lpn_id=lpn_id,
                        reference_type="shipment", reference=s.shipment_number,
                        notes=f"Shipped on {s.shipment_number}",
                    )
                    m.created_at = ts
            item.quantity_shipped = item.quantity_picked
        s.status = "shipped"
        s.ship_date = ts
        s.shipped_at = ts
        s.updated_at = ts

    # Shipped: weekly office restock (non-lot products).
    s1 = new_shipment("SHP-0001", "Acme Retail Store", carrier="UPS",
                      tracking="1Z999AA10123456784", notes="Weekly office restock",
                      created_days=5)
    add_items(s1, [("OFF-010", 5), ("CLN-022", 4), ("BEV-020", 3)])
    pick(s1, [("OFF-010", 5), ("CLN-022", 4), ("BEV-020", 3)], days_ago(4, hour=10))
    pack(s1, days_ago(4, hour=14))
    ship(s1, days_ago(3, hour=9))

    # Packed: lot-tracked beverage order staged but not yet shipped.
    s2 = new_shipment("SHP-0002", "Downtown Cafe", carrier="FedEx",
                      notes="Break room restock", created_days=3)
    add_items(s2, [("BEV-016", 2), ("BEV-018", 3)])
    pick(s2, [("BEV-016", 2), ("BEV-018", 3)], days_ago(2, hour=11))
    pack(s2, days_ago(1, hour=9))

    # Picking: picked to staging, awaiting pack.
    s3 = new_shipment("SHP-0003", "TechNest Ltd", notes="Electronics accessories",
                      created_days=2)
    add_items(s3, [("TECH-005", 4), ("TECH-006", 2)])
    pick(s3, [("TECH-005", 4), ("TECH-006", 2)], days_ago(1, hour=10))

    # Draft: no picking activity yet.
    s4 = new_shipment("SHP-0004", "City Office Hub", notes="Stationery order",
                      created_days=1)
    add_items(s4, [("OFF-013", 10), ("OFF-014", 10)])

    # Cancelled: cancelled before any picking.
    s5 = new_shipment("SHP-0005", "FreshMart Grocery", notes="Cancelled by customer",
                      created_days=1)
    add_items(s5, [("BEV-019", 6)])
    s5.status = "cancelled"
    s5.updated_at = days_ago(0, hour=8)

    # Shipped + invoice: serialized unit shipped with serial tracking.
    s6 = new_shipment("SHP-0006", "TechNest Ltd", carrier="DHL",
                      tracking="DHL 1234 5678 90", notes="Serialized device order",
                      created_days=3)
    add_items(s6, [("TECH-030", 2)])
    pick(s6, [("TECH-030", 2)], days_ago(2, hour=13))
    pack(s6, days_ago(2, hour=15))
    ship(s6, days_ago(1, hour=10))

    # Shipped + invoice created from the shipment (create-sale flow).
    s7 = new_shipment("SHP-0007", "Jane Doe", notes="Online order", created_days=4)
    add_items(s7, [("TECH-002", 2), ("TECH-006", 1)])
    pick(s7, [("TECH-002", 2), ("TECH-006", 1)], days_ago(4, hour=15))
    pack(s7, days_ago(4, hour=16))
    ship(s7, days_ago(3, hour=11))
    subtotal = 0.0
    sale_items = []
    for item in s7.items:
        qty = item.quantity_shipped
        price = float(item.product.unit_price or 0.0)
        subtotal += qty * price
        sale_items.append((item.product_id, qty, price))
    tax = subtotal * tax_rate / 100
    invoice = next_document_number(db, "invoice", "INV-")
    sale = Sale(invoice_number=invoice, customer_id=s7.customer_id, user_id=worker.id,
                subtotal=round(subtotal, 2), tax_amount=round(tax, 2),
                total_amount=round(subtotal + tax, 2), status="completed",
                payment_method="card",
                notes=f"Invoice created from shipment {s7.shipment_number}",
                created_at=days_ago(3, hour=12))
    db.add(sale)
    db.flush()
    for pid, qty, price in sale_items:
        db.add(SaleItem(sale_id=sale.id, product_id=pid, quantity=qty, unit_price=price))
    s7.sale_id = sale.id

    db.add(ActivityLog(user_id=worker.id, username=worker.username, action="create",
                       entity_type="shipment", entity_id=s1.id,
                       description="Created shipment 'SHP-0001' (12 units)",
                       created_at=days_ago(5, hour=9)))
    db.add(ActivityLog(user_id=worker.id, username=worker.username, action="ship",
                       entity_type="shipment", entity_id=s1.id,
                       description="Shipped 'SHP-0001' via UPS (1Z999AA10123456784)",
                       created_at=days_ago(3, hour=9)))
    db.commit()
    return shipments


def seed_document_sequences(db, sales_count, orders, receipts, asns, ccs, transfers):
    rows = [
        ("invoice", sales_count + 1),
        ("purchase_order", len(orders) + 1),
        ("receipt", len(receipts) + 1),
        ("asn", len(asns) + 1),
        ("cycle_count", len(ccs) + 1),
        ("lpn", 5),
        ("transfer", transfers + 1),
        ("work_order", 5),
        ("bom", 6),
        ("quality_check", 3),
        ("shipment", 8),
    ]
    for name, next_value in rows:
        db.add(DocumentSequence(name=name, next_value=next_value))
    db.commit()


def create_notifications(db, users, products, sale_records):
    admin = next(u for u in users if u.role == "admin")
    workers = [u for u in users if u.role == "worker"]
    notes = []

    quarantined = {}
    for pid, qty in inventory.quarantined_qty_by_product(db).items():
        quarantined[pid] = qty
    low_stock = []
    for p in products:
        if p.is_serialized or p.is_variant:
            continue
        sellable = p.quantity - quarantined.get(p.id, 0)
        if sellable <= p.reorder_level:
            low_stock.append((p, sellable))
    for p, sellable in low_stock:
        notes.append(Notification(
            user_id=admin.id, type="warning", title=f"Low stock: {p.name}",
            message=f"Only {sellable} left (reorder level {p.reorder_level}).",
            link="/products", is_read=False, created_at=days_ago(random.randint(0, 3)),
        ))

    expiring = date.today() + timedelta(days=30)
    for p in products:
        if p.expiry_date and p.expiry_date <= expiring and p.quantity > 0:
            notes.append(Notification(
                user_id=admin.id, type="warning",
                title=f"Expiring soon: {p.name}",
                message=f"Lot {p.batch_number or 'N/A'} expires on {p.expiry_date}.",
                link="/products", is_read=False, created_at=days_ago(random.randint(0, 2)),
            ))

    for s in sale_records[-4:]:
        notes.append(Notification(
            user_id=admin.id, type="success", title=f"New sale {s['invoice']}",
            message=s["customer"].name, link="/sales", is_read=False,
            created_at=s["created_at"],
        ))
    for w in workers:
        notes.append(Notification(
            user_id=w.id, type="info", title="Welcome to the warehouse",
            message="You are signed in with worker permissions.",
            link="/", is_read=False, created_at=days_ago(random.randint(1, 4)),
        ))
    db.add_all(notes)
    db.commit()
    return notes


def create_activity_logs(db, users, orders, receipts, asns, ccs, sale_records, by_sku):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    logs = [
        (admin, "create", "location", 1, "Created location 'Main Warehouse'", 60),
        (admin, "create", "category", 1, "Created category 'Electronics'", 40),
        (admin, "create", "supplier", 1, "Created supplier 'TechSource Distribution'", 38),
        (admin, "create", "customer", 1, "Created customer 'Acme Retail Store'", 36),
        (worker, "create", "product", 1, "Created product 'Laptop Stand Pro'", 30),
        (worker, "create", "product", by_sku["TECH-030"].id, "Created serialized product 'Smart Watch Pro'", 25),
        (worker, "create", "order", orders[0].id, f"Created order '{orders[0].order_number}'", 28),
        (worker, "update", "order", orders[0].id, f"Order '{orders[0].order_number}' status changed to 'received'", 27),
        (worker, "create", "receipt", receipts[0].id, f"Receipt '{receipts[0].receipt_number}' for 48 unit(s)", 27),
        (worker, "create", "stock_movement", 1, "in movement of 8 x 'Laptop Stand Pro'", 27),
        (worker, "create", "lpn", 1, "Created LPN 'PAL-1001'", 30),
        (worker, "move", "lpn", 2, "Moved LPN 'PAL-1002'", 22),
        (worker, "create", "asn", asns[0].id, f"Created ASN '{asns[0].asn_number}'", 2),
        (worker, "create", "asn", asns[2].id, f"Received ASN '{asns[2].asn_number}' (36 unit(s))", 7),
        (worker, "complete", "cycle_count", ccs[0].id, f"Completed cycle count '{ccs[0].cc_number}' (variance +1)", 4),
        (worker, "create", "sale", sale_records[0]["id"], f"Sale '{sale_records[0]['invoice']}'", 10),
        (worker, "create", "stock_movement", 3, "out movement of 4 x 'Wireless Mouse M300'", 2),
        (worker, "create", "customer", 8, "Created customer 'Bright Learning Center'", 1),
        (worker, "update", "stock_movement", 2, "Updated stock movement #2", 1),
    ]
    for user, action, entity, eid, desc, day in logs:
        db.add(ActivityLog(user_id=user.id, username=user.username, action=action,
                           entity_type=entity, entity_id=eid, description=desc,
                           created_at=days_ago(day, hour=random.randint(8, 17))))
    db.commit()


def main():
    run_migrations()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        wipe_all(db)
        users = create_users(db)
        create_settings(db)
        locs = create_locations(db)
        cats = create_categories(db)
        suppliers = create_suppliers(db)
        customers = create_customers(db)
        products, by_sku = build_products(db, cats, suppliers, locs)
        lots = create_lots(db, by_sku, suppliers)
        serials = create_serialized_stock(db, users, by_sku, locs)
        lpns = create_lpns(db, locs)
        orders = create_orders(db, users, suppliers, by_sku)
        receipts = create_receipts(db, users, suppliers, by_sku, lots, locs)
        asns = create_asns(db, users, suppliers, by_sku, lots, locs)
        create_opening_stock(db, users, by_sku, lots, locs)
        create_lpn_stock(db, users, by_sku, lots, lpns, locs)
        create_transfers(db, users, by_sku, lots, locs)
        sale_records, sales_count = create_sales(db, users, customers, products, by_sku)
        serial_sales = create_serialized_sales(db, users, customers, serials, by_sku, locs)
        create_returns_and_adjustments(db, users, by_sku, lots, locs)
        ccs = create_cycle_counts(db, users, by_sku, locs)
        boms = create_boms(db, by_sku)
        wos = create_work_orders(db, users, by_sku, boms, locs)
        qcs = create_quality_checks(db, users, by_sku)
        seed_document_sequences(db, sales_count + len(serial_sales), orders, receipts, asns, ccs, transfers=2)
        shipments = create_shipments(db, users, customers, by_sku, locs)
        create_notifications(db, users, products, sale_records)
        create_activity_logs(db, users, orders, receipts, asns, ccs, sale_records, by_sku)
        db.commit()

        print("=" * 60)
        print("SEED COMPLETE")
        print("=" * 60)
        print(f"  Users             : {len(users)}")
        print(f"  Categories        : {len(cats)}")
        print(f"  Suppliers         : {len(suppliers)}")
        print(f"  Customers         : {len(customers)}")
        print(f"  Locations         : {db.query(Location).count()}")
        print(f"  Products          : {len(products)}")
        print(f"  Lots              : {db.query(Lot).count()}")
        print(f"  Serial Numbers    : {db.query(SerialNumber).count()}")
        print(f"  LPNs              : {db.query(LPN).count()}")
        print(f"  Orders            : {len(orders)}")
        print(f"  Receipts          : {len(receipts)}")
        print(f"  ASNs              : {len(asns)}")
        print(f"  Cycle Counts      : {len(ccs)}")
        print(f"  BOMs              : {len(boms)}")
        print(f"  Work Orders       : {len(wos)}")
        print(f"  Quality Checks    : {len(qcs)}")
        print(f"  Lot Links         : {db.query(LotLink).count()}")
        print(f"  Shipments         : {len(shipments)}")
        print(f"  Sales             : {sales_count + len(serial_sales)}")
        print(f"  Stock Lines       : {db.query(StockLine).count()}")
        print(f"  Stock Movements   : {db.query(StockMovement).count()}")
        print(f"  Activity Logs     : {db.query(ActivityLog).count()}")
        print(f"  Notifications     : {db.query(Notification).count()}")
        print("  Demo login        : admin / admin123")
        print("                     : michael / worker123")
        print("                     : sarah   / worker123")
        print("                     : david   / worker123")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
