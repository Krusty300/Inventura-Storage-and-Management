"""Comprehensive seed script for the Inventory Management System.

Run from the backend directory:
    python seed.py

Wipes existing data and inserts realistic demo data across every entity:
users, settings, locations (two buildings, aisles A-F + north annex), a
20-category product tree, 12 suppliers (with lead times), customers,
~96 products (incl. variants, serialized items and manufactured bundles),
lot-tracked beverages (incl. expired/quarantined/sold lots), serial numbers
(every lifecycle status for two serialized products), LPNs, purchase orders,
receipts, ASNs, cycle counts (all statuses incl. variances), sales (incl.
refunds), stock movements, notifications, activity logs, document sequences,
BOMs, work orders (every status incl. serialized + genealogy manufacturing),
quality checks, lot genealogy links, and shipments across the full
picking/packing/shipping lifecycle (incl. shipment->invoice).

Stock is always posted through inventory.post_journal_entry so the ledger,
stock_lines and product.quantity stay consistent, and sales flow through
inventory.allocate_lots exactly like the checkout API does. Shipments
mirror the pick/pack/ship endpoints (transfer to staging, then SHIP).
"""

import random
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import Base, engine, SessionLocal, run_migrations
from app.models import (
    ASN, ASNItem, BOM, BOMItem, Category, Customer, CycleCount, CycleCountItem,
    DocumentSequence, LPN, Location, Lot, LotLink, Notification, Order, OrderItem,
    Product, QualityCheck, Receipt, ReceiptItem, Sale, SaleItem, SerialNumber,
    Shipment, ShipmentItem, StockLine, StockMovement, Supplier, User, UserSession,
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
    db.query(UserSession).delete()
    db.query(User).delete()
    try:
        db.execute(text("DELETE FROM sqlite_sequence"))
    except Exception:
        pass
    db.commit()


def days_ago(n, hour=10, minute=0):
    return datetime.now(timezone.utc) - timedelta(days=n, hours=hour, minutes=minute)


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
        User(username="jessica", email="jessica@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(15)),
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
        expiry_warning_days=30,
        low_stock_alerts=True,
        expiry_alerts=True,
        shipment_prefix="SHP",
        work_order_prefix="WO",
        sale_prefix="SALE",
        invoice_prefix="INV",
        po_prefix="PO",
        require_qc_before_ship=False,
        auto_allocate_stock=False,
        enforce_fefo=True,
        default_costing_method="weighted_average",
        fiscal_year_start_month=1,
        default_items_per_page=50,
        date_format="YYYY-MM-DD",
    )
    db.add(s)
    db.commit()
    return s


def create_locations(db):
    """Hierarchical warehouse: buildings -> aisles -> shelves -> bins."""
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
    add("Quarantine Area", "Q-AREA", "quarantine", root)

    aisle_specs = [
        ("A", "Electronics", ["A-01", "A-02", "A-03", "A-04"]),
        ("B", "Office Supplies", ["B-01", "B-02", "B-03"]),
        ("C", "Beverages", ["C-01", "C-02", "C-03"]),
        ("D", "Cleaning", ["D-01", "D-02"]),
        ("E", "Electronics Overflow", ["E-01", "E-02"]),
        ("F", "Office Overflow", ["F-01", "F-02"]),
    ]
    bin_counts = {
        "A-01": 3, "A-02": 3, "A-03": 3, "A-04": 3,
        "B-01": 3, "B-02": 3, "B-03": 2,
        "C-01": 3, "C-02": 3, "C-03": 2,
        "D-01": 3, "D-02": 2,
        "E-01": 3, "E-02": 2,
        "F-01": 3, "F-02": 2,
    }
    for aisle_letter, _label, shelves in aisle_specs:
        aisle = add(f"Aisle {aisle_letter}", f"AISLE-{aisle_letter}", "aisle", root)
        for shelf_code in shelves:
            shelf = add(f"Shelf {shelf_code}", shelf_code, "shelf", aisle)
            for i in range(1, bin_counts[shelf_code] + 1):
                bin_code = f"{shelf_code}-0{i}"
                add(f"Bin {bin_code}", bin_code, "bin", shelf)

    # Second building: north annex with N1/N2 shelves (overflow / bulk storage).
    north = add("North Annex", "WH-NORTH", "storage")
    for shelf_code in ("N1", "N2"):
        shelf = add(f"Shelf {shelf_code}", shelf_code, "shelf", north)
        for i in range(1, 3):
            bin_code = f"{shelf_code}-0{i}"
            add(f"Bin {bin_code}", bin_code, "bin", shelf)

    db.commit()
    return locs


def create_categories(db):
    data = [
        ("Electronics", "Computers, phones, audio and accessories", None),
        ("Computers", "Desktops, laptops and peripherals", None),
        ("Phones", "Smartphones, chargers and accessories", None),
        ("Audio", "Speakers, headphones and sound gear", None),
        ("Networking", "Routers, switches and connectivity", None),
        ("Storage Media", "USB drives, memory cards and hard drives", None),
        ("Batteries", "Batteries, power banks and surge protection", None),
        ("Cables & Adapters", "Cables, hubs and adapters", None),
        ("Office Supplies", "Everyday consumables for the office", None),
        ("Paper Products", "Paper, envelopes and sticky notes", None),
        ("Writing Instruments", "Pens, markers and highlighters", None),
        ("Packaging", "Shipping and packaging materials", None),
        ("Filing & Storage", "Folders, binders and storage boxes", None),
        ("Beverages", "Drinks for the break room", None),
        ("Coffee & Tea", "Hot beverages", None),
        ("Soft Drinks", "Chilled beverages", None),
        ("Bottled Water", "Still and sparkling water", None),
        ("Snacks", "Break room snacks", None),
        ("Cleaning Supplies", "Janitorial and hygiene products", None),
        ("Safety & PPE", "Gloves, masks and personal protection", None),
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
        "Networking": "Electronics", "Storage Media": "Electronics",
        "Batteries": "Electronics", "Cables & Adapters": "Electronics",
        "Paper Products": "Office Supplies", "Writing Instruments": "Office Supplies",
        "Packaging": "Office Supplies", "Filing & Storage": "Office Supplies",
        "Coffee & Tea": "Beverages", "Soft Drinks": "Beverages",
        "Bottled Water": "Beverages", "Snacks": "Beverages",
        "Safety & PPE": "Cleaning Supplies",
    }
    for sub, par in subs.items():
        cats[sub].parent_id = cats[par].id
    db.commit()
    return cats


def create_suppliers(db):
    data = [
        ("TechSource Distribution", "Karen Liu", "sales@techsource.example", "555-0101",
         "1200 Commerce Way, Portland, OR", "Electronics wholesaler, ships nationwide.", 7, True),
        ("GlobalOffice Partners", "Robert Chen", "orders@globaloffice.example", "555-0102",
         "88 Business Park Dr, Austin, TX", "Office supplies with bulk discounts.", 5, True),
        ("Beverage Wholesale Co", "Maria Gomez", "hello@beveragewholesale.example", "555-0103",
         "450 Harbor Blvd, Seattle, WA", "Local distributor for coffee and drinks.", 3, True),
        ("CleanSupplies Ltd", "David Okafor", "contact@cleansupplies.example", "555-0104",
         "12 Industrial Rd, Chicago, IL", "Janitorial supplies and hygiene products.", 4, True),
        ("ACME Paper Co", "Helen Zhang", "info@acmepaper.example", "555-0105",
         "300 Mill Street, Dayton, OH", "Paper and packaging specialist.", 6, True),
        ("Sunrise Electronics", "Tom Nakamura", "sales@sunriseelec.example", "555-0106",
         "77 Tech Park Ave, San Jose, CA", "Components and consumer electronics.", 9, True),
        ("PrimeData Systems", "Alice Foster", "b2b@primedata.example", "555-0107",
         "55 Innovation Ct, Denver, CO", "IT equipment and peripherals.", 8, True),
        ("DrinksDirect", "Omar Haddad", "support@drinksdirect.example", "555-0108",
         "909 Canopy St, Miami, FL", "Soft drinks and energy beverages.", 4, True),
        ("NexusGear Components", "Priya Patel", "orders@nexusgear.example", "555-0109",
         "210 Circuit Blvd, Austin, TX", "Cables, storage and networking gear.", 6, True),
        ("PackRight Supplies", "Luis Mendes", "sales@packright.example", "555-0110",
         "77 Box Lane, Columbus, OH", "Packaging and mailroom essentials.", 5, True),
        ("SnackLine Foods", "Emily Tran", "orders@snackline.example", "555-0111",
         "430 Cracker Rd, Denver, CO", "Snack and vending distribution.", 4, True),
        ("Quantum Manufacturing", "Greg Hale", "hello@quantummfg.example", "555-0112",
         "9 Industrial Pkwy, Reno, NV", "Contract manufacturer (currently on hold).", 12, False),
    ]
    suppliers = []
    for name, contact, email, phone, addr, notes, lead, active in data:
        s = Supplier(name=name, contact_person=contact, email=email, phone=phone,
                     address=addr, notes=notes, lead_time_days=lead, is_active=active,
                     created_at=days_ago(38))
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
        ("Riverside Hotel", "555-0209", "purchasing@riversidehotel.example",
         "1 Riverfront Plaza, Springfield", "frequent", "Housekeeping and snack orders."),
        ("Harborview Bistro", "555-0210", "kitchen@harborview.example",
         "88 Harbor Rd, Lakeside", "frequent", "Weekly beverage and coffee orders."),
        ("Alice Nguyen", "555-0211", "alice.nguyen@example.com",
         "321 Maple Dr, Riverton", "walk-in", ""),
        ("Midtown Bookstore", "555-0212", "store@midtownbooks.example",
         "450 Main Ave, Springfield", "frequent", "Stationery and packing supplies."),
        ("Solar Peak Energy", "555-0213", "ops@solarmax.example",
         "77 Energy Way, Lakeside", "frequent", "IT equipment and safety gear."),
        ("Old Warehouse Co", "555-0214", "office@oldwh.example",
         "5 Dusty Rd, Riverton", "walk-in", "Inactive account - no orders for a year."),
    ]
    customers = []
    for name, phone, email, addr, ctype, notes in data:
        active = name != "Old Warehouse Co"
        c = Customer(name=name, phone=phone, email=email, address=addr,
                     customer_type=ctype, notes=notes, is_active=active,
                     created_at=days_ago(36))
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
         "Computers", "TechSource Distribution", 89.99, 45.00, 15, "A-01-01", "490000000001"),
        ("TECH-002", "Wireless Mouse M300", "Silent 2.4G wireless mouse",
         "Computers", "PrimeData Systems", 24.99, 12.50, 15, "A-01-02", "490000000002"),
        ("TECH-003", "Mechanical Keyboard K87", "Tenkeyless hot-swap mechanical keyboard",
         "Computers", "PrimeData Systems", 59.99, 32.00, 10, "A-01-03", "490000000003"),
        ("TECH-010", "24\" IPS Monitor", "Full HD IPS desktop monitor",
         "Computers", "PrimeData Systems", 199.99, 120.00, 5, "E-01-01", "490000000010"),
        ("TECH-011", "USB-C Hub 7-in-1", "Aluminum USB-C hub with HDMI and SD",
         "Computers", "PrimeData Systems", 39.99, 20.00, 10, "E-01-02", "490000000011"),
        ("TECH-012", "Laptop Sleeve 13\"", "Padded neoprene laptop sleeve",
         "Computers", "TechSource Distribution", 24.99, 11.00, 12, "E-01-03", "490000000012"),
        ("TECH-014", "External SSD 1TB", "USB 3.2 portable solid state drive",
         "Computers", "NexusGear Components", 119.99, 70.00, 8, "E-02-02", "490000000014"),
        ("TECH-036", "Mechanical Keyboard TKL RGB", "Hot-swap RGB mechanical keyboard",
         "Computers", "PrimeData Systems", 79.99, 42.00, 5, "A-01-02", "490000000036"),
        ("TECH-037", "Ergonomic Mouse Vertical", "Vertical grip wireless mouse",
         "Computers", "PrimeData Systems", 34.99, 18.00, 10, "A-01-03", "490000000037"),
        ("TECH-040", "Workstation Bundle", "Mouse, hub and dock workstation bundle",
         "Computers", "PrimeData Systems", 1499.99, 950.00, 2, "N1-01", "490000000040"),
        ("TECH-041", "USB-C Starter Kit", "Charger, cables and power bank starter kit",
         "Computers", "TechSource Distribution", 89.99, 45.00, 5, "E-01-01", "490000000041"),
        ("TECH-004", "Smartphone Charger 65W", "GaN fast charger with USB-C",
         "Phones", "TechSource Distribution", 34.99, 18.00, 20, "A-02-01", "490000000004"),
        ("TECH-005", "USB-C Cable 2m", "Braided USB-C to USB-C cable",
         "Phones", "TechSource Distribution", 12.99, 5.00, 30, "A-02-02", "490000000005"),
        ("TECH-006", "Phone Stand Alu", "Adjustable aluminum phone stand",
         "Phones", "Sunrise Electronics", 14.99, 7.20, 15, "A-02-03", "490000000006"),
        ("TECH-016", "Power Bank 20000mAh", "20K mAh fast-charge power bank",
         "Phones", "Sunrise Electronics", 49.99, 26.00, 10, "E-02-02", "490000000016"),
        ("TECH-017", "Car Charger 45W", "Dual-port USB-C car charger",
         "Phones", "TechSource Distribution", 19.99, 9.00, 10, "E-01-01", "490000000017"),
        ("TECH-018", "Screen Protector 3pk", "Tempered glass screen protector set",
         "Phones", "TechSource Distribution", 9.99, 2.50, 30, "E-01-03", "490000000018"),
        ("TECH-007", "Bluetooth Speaker Mini", "Portable IPX7 waterproof speaker",
         "Audio", "TechSource Distribution", 44.99, 25.00, 12, "A-03-01", "490000000007"),
        ("TECH-008", "Noise-Cancelling Headphones", "Over-ear ANC wireless headphones",
         "Audio", "PrimeData Systems", 149.99, 85.00, 5, "A-03-02", "490000000008"),
        ("TECH-009", "Studio Mic Kit", "USB condenser mic with pop filter",
         "Audio", "Sunrise Electronics", 99.99, 55.00, 8, "A-03-03", "490000000009"),
        ("TECH-013", "1080p Webcam", "Full HD webcam with privacy shutter",
         "Audio", "Sunrise Electronics", 44.99, 22.00, 8, "E-02-01", "490000000013"),
        ("TECH-019", "Bluetooth Speaker Max", "High-output portable party speaker",
         "Audio", "TechSource Distribution", 129.99, 70.00, 4, "E-02-01", "490000000019"),
        ("TECH-033", "HDMI Cable 2m", "4K HDMI 2.1 cable",
         "Audio", "TechSource Distribution", 11.99, 3.80, 20, "E-01-01", "490000000033"),
        ("TECH-020", "WiFi Router AX3000", "Dual-band WiFi 6 router",
         "Networking", "NexusGear Components", 89.99, 48.00, 8, "N1-01", "490000000020"),
        ("TECH-021", "Ethernet Cable 10m", "Cat6 shielded ethernet cable",
         "Networking", "NexusGear Components", 12.99, 4.00, 20, "N1-02", "490000000021"),
        ("TECH-022", "8-Port Network Switch", "Gigabit unmanaged network switch",
         "Networking", "NexusGear Components", 34.99, 18.00, 8, "N1-01", "490000000022"),
        ("TECH-023", "WiFi Extender", "Dual-band range extender",
         "Networking", "Sunrise Electronics", 39.99, 19.00, 8, "N1-02", "490000000023"),
        ("TECH-024", "USB Drive 64GB", "USB 3.0 flash drive",
         "Storage Media", "NexusGear Components", 12.99, 5.50, 30, "E-02-02", "490000000024"),
        ("TECH-026", "microSD Card 128GB", "A2 U3 microSD memory card",
         "Storage Media", "NexusGear Components", 19.99, 9.00, 20, "N2-02", "490000000026"),
        ("TECH-027", "External HDD 2TB", "USB 3.0 portable hard drive",
         "Storage Media", "NexusGear Components", 79.99, 45.00, 6, "N2-01", "490000000027"),
        ("TECH-028", "AA Batteries 24pk", "Alkaline AA batteries, 24 pack",
         "Batteries", "Sunrise Electronics", 14.99, 7.00, 25, "E-01-02", "490000000028"),
        ("TECH-029", "AAA Batteries 24pk", "Alkaline AAA batteries, 24 pack",
         "Batteries", "Sunrise Electronics", 13.99, 6.50, 25, "E-02-02", "490000000029"),
        ("TECH-031", "Rechargeable Battery Kit", "AA/AAA rechargeable kit with charger",
         "Batteries", "Sunrise Electronics", 29.99, 16.00, 10, "E-01-03", "490000000031"),
        ("TECH-032", "Power Strip 6-Outlet", "Surge-protected power strip",
         "Batteries", "PrimeData Systems", 24.99, 12.00, 10, "E-02-01", "490000000032"),
        ("TECH-034", "USB-A to USB-C Adapter", "2-pack USB-A to USB-C adapters",
         "Cables & Adapters", "TechSource Distribution", 7.99, 2.20, 40, "E-01-02", "490000000034"),
        ("TECH-035", "DisplayPort Cable 2m", "DP 1.4 cable for monitors",
         "Cables & Adapters", "NexusGear Components", 13.99, 4.50, 15, "E-02-02", "490000000035"),
        ("OFF-010", "A4 Paper Ream (500)", "80gsm multi-purpose copy paper",
         "Paper Products", "ACME Paper Co", 6.99, 3.80, 50, "B-01-01", "490000000042"),
        ("OFF-011", "Sticky Notes 3x3", "Assorted color sticky notes, 12 pads",
         "Paper Products", "GlobalOffice Partners", 3.49, 1.20, 40, "B-01-02", "490000000043"),
        ("OFF-012", "Letter Envelopes Pack", "Self-seal envelopes, pack of 100",
         "Paper Products", "ACME Paper Co", 8.99, 4.50, 30, "B-01-03", "490000000044"),
        ("OFF-016", "A4 Paper 5-Ream Case", "Five-ream case of copy paper",
         "Paper Products", "ACME Paper Co", 29.99, 17.00, 15, "F-01-01", "490000000048"),
        ("OFF-018", "Mailing Labels 100pk", "Avery-style mailing labels",
         "Paper Products", "PackRight Supplies", 14.99, 6.50, 20, "F-01-03", "490000000050"),
        ("OFF-013", "Gel Pens 12pk", "Smooth-writing gel pens, 0.5mm",
         "Writing Instruments", "GlobalOffice Partners", 9.99, 4.20, 30, "B-02-01", "490000000045"),
        ("OFF-014", "Highlighter 5pk", "Chisel tip fluorescent highlighters",
         "Writing Instruments", "GlobalOffice Partners", 7.49, 3.10, 30, "B-02-02", "490000000046"),
        ("OFF-015", "Whiteboard Markers 8pk", "Low-odor dry erase markers",
         "Writing Instruments", "ACME Paper Co", 11.99, 5.80, 20, "B-02-03", "490000000047"),
        ("OFF-019", "Ballpoint Pens 50pk", "Classic ballpoint pens, box of 50",
         "Writing Instruments", "GlobalOffice Partners", 19.99, 9.50, 15, "F-02-01", "490000000051"),
        ("OFF-020", "Permanent Markers 8pk", "Permanent markers, 8 assorted colors",
         "Writing Instruments", "ACME Paper Co", 12.99, 5.90, 20, "F-02-02", "490000000052"),
        ("OFF-017", "Kraft Mailer 10pk", "Padded kraft shipping mailers",
         "Packaging", "PackRight Supplies", 9.99, 4.00, 30, "F-01-02", "490000000049"),
        ("OFF-021", "Packing Tape 6pk", "Clear packing tape, 6 rolls",
         "Packaging", "PackRight Supplies", 18.99, 9.00, 15, "B-03-01", "490000000053"),
        ("OFF-022", "Bubble Wrap 100ft", "Bubble cushioning roll",
         "Packaging", "PackRight Supplies", 24.99, 12.00, 10, "B-03-02", "490000000054"),
        ("OFF-023", "Shipping Boxes 12x9x6 25pk", "Corrugated shipping boxes, 25 pack",
         "Packaging", "PackRight Supplies", 29.99, 15.00, 10, "B-03-01", "490000000055"),
        ("OFF-024", "Poly Mailers 50pk", "Self-seal poly mailers, 50 pack",
         "Packaging", "PackRight Supplies", 19.99, 9.00, 25, "F-01-02", "490000000056"),
        ("OFF-025", "Hanging Folders 25pk", "Letter-size hanging folders",
         "Filing & Storage", "GlobalOffice Partners", 22.99, 11.00, 15, "F-01-03", "490000000057"),
        ("OFF-026", "Binder 2\" 12pk", "Two-inch ring binders, 12 pack",
         "Filing & Storage", "GlobalOffice Partners", 34.99, 18.00, 10, "F-02-01", "490000000058"),
        ("OFF-027", "Document Trays 3pk", "Stackable mesh document trays",
         "Filing & Storage", "GlobalOffice Partners", 24.99, 12.50, 10, "F-02-02", "490000000059"),
        ("OFF-028", "File Box 4pk", "Lid-and-base file storage boxes",
         "Filing & Storage", "PackRight Supplies", 21.99, 10.00, 8, "N1-02", "490000000060"),
        ("OFF-030", "Desk Kit", "Pens, highlighters and folders desk starter kit",
         "Filing & Storage", "GlobalOffice Partners", 49.99, 22.00, 5, "F-02-02", "490000000061"),
        ("BEV-016", "Ground Coffee 1kg", "Medium roast whole bean coffee",
         "Coffee & Tea", "Beverage Wholesale Co", 18.99, 11.00, 20, "C-01-01", "490000000016"),
        ("BEV-017", "Green Tea Box 20", "Organic green tea bags, 20 count",
         "Coffee & Tea", "Beverage Wholesale Co", 9.49, 5.50, 20, "C-01-02", "490000000017"),
        ("BEV-018", "Espresso Capsules 10", "Compatible espresso pods, 10 pack",
         "Coffee & Tea", "Beverage Wholesale Co", 12.99, 7.80, 15, "C-01-03", "490000000018"),
        ("BEV-022", "Instant Coffee Jar", "Freeze-dried instant coffee, 200g",
         "Coffee & Tea", "Beverage Wholesale Co", 11.99, 6.00, 15, "C-03-01", "490000000022"),
        ("BEV-023", "Herbal Tea Box 20", "Caffeine-free herbal tea, 20 count",
         "Coffee & Tea", "Beverage Wholesale Co", 8.99, 4.50, 15, "C-03-02", "490000000023"),
        ("BEV-024", "Coffee Filters 100pk", "White paper drip coffee filters",
         "Coffee & Tea", "Beverage Wholesale Co", 6.99, 2.80, 20, "N1-01", "490000000024"),
        ("BEV-036", "Coffee Gift Box", "Coffee, filters and mug gift presentation",
         "Coffee & Tea", "Beverage Wholesale Co", 45.99, 22.00, 4, "C-03-02", "490000000036"),
        ("BEV-020", "Cola 12pk", "Classic cola, 330ml cans",
         "Soft Drinks", "DrinksDirect", 7.99, 4.20, 40, "C-02-02", "490000000020"),
        ("BEV-021", "Energy Drink 24pk", "Sugar-free energy drink, 250ml",
         "Soft Drinks", "DrinksDirect", 29.99, 16.50, 15, "C-02-03", "490000000021"),
        ("BEV-025", "Iced Tea 24pk", "Lemon iced tea, 330ml cans",
         "Soft Drinks", "DrinksDirect", 16.99, 9.00, 20, "N1-02", "490000000025"),
        ("BEV-026", "Fruit Juice 12pk", "Mixed fruit juice, 250ml cartons",
         "Soft Drinks", "DrinksDirect", 18.99, 10.00, 15, "C-03-02", "490000000026"),
        ("BEV-027", "Cola Zero 12pk", "Zero-sugar cola, 330ml cans",
         "Soft Drinks", "DrinksDirect", 7.99, 4.20, 30, "C-02-03", "490000000027"),
        ("BEV-019", "Sparkling Water 24pk", "Naturally sparkling mineral water",
         "Bottled Water", "DrinksDirect", 14.99, 8.00, 30, "C-02-01", "490000000019"),
        ("BEV-035", "Mineral Water 24pk", "Still mineral water, 500ml bottles",
         "Bottled Water", "DrinksDirect", 12.99, 6.50, 40, "C-02-01", "490000000035"),
        ("BEV-031", "Granola Bars 24pk", "Oat and honey granola bars",
         "Snacks", "SnackLine Foods", 21.99, 11.50, 15, "N2-01", "490000000031"),
        ("BEV-032", "Potato Chips 24pk", "Sea salt potato chips, single bags",
         "Snacks", "SnackLine Foods", 25.99, 14.00, 15, "N2-02", "490000000032"),
        ("BEV-033", "Mixed Nuts 1kg", "Roasted salted mixed nuts",
         "Snacks", "SnackLine Foods", 17.99, 9.50, 10, "N2-01", "490000000033"),
        ("BEV-034", "Chocolate Bar 10pk", "Milk chocolate bars, 10 pack",
         "Snacks", "SnackLine Foods", 19.99, 10.00, 15, "N2-02", "490000000034"),
        ("BEV-037", "Snack Box", "Granola, nuts and chocolate break room box",
         "Snacks", "SnackLine Foods", 34.99, 15.00, 5, "N2-01", "490000000037"),
        ("BEV-030", "Beverage Combo Pack", "Coffee, tea and espresso combo box",
         "Coffee & Tea", "Beverage Wholesale Co", 24.99, 10.50, 10, "C-03-01", "490000000030"),
        ("CLN-022", "All-Purpose Cleaner 1L", "Multi-surface disinfectant spray",
         "Cleaning Supplies", "CleanSupplies Ltd", 5.99, 2.40, 30, "D-01-01", "490000000022"),
        ("CLN-023", "Microfiber Cloths 10pk", "Reusable lint-free cleaning cloths",
         "Cleaning Supplies", "CleanSupplies Ltd", 12.99, 6.00, 20, "D-01-02", "490000000023"),
        ("CLN-024", "Hand Sanitizer 500ml", "Alcohol gel hand sanitizer pump",
         "Cleaning Supplies", "CleanSupplies Ltd", 4.99, 1.80, 30, "D-01-03", "490000000024"),
        ("CLN-025", "Paper Towels 12pk", "Multi-fold paper towels, 12 packs",
         "Cleaning Supplies", "CleanSupplies Ltd", 18.99, 9.50, 15, "D-02-01", "490000000025"),
        ("CLN-026", "Trash Bags 40pk", "Heavy-duty trash bags, 40 pack",
         "Cleaning Supplies", "CleanSupplies Ltd", 11.99, 5.20, 20, "D-02-02", "490000000026"),
        ("CLN-027", "Dish Soap 1L", "Gentle dish soap, 1L bottle",
         "Cleaning Supplies", "CleanSupplies Ltd", 5.49, 2.20, 25, "F-02-01", "490000000027"),
        ("CLN-028", "Glass Cleaner 500ml", "Streak-free glass cleaner",
         "Cleaning Supplies", "CleanSupplies Ltd", 4.79, 1.90, 25, "F-02-02", "490000000028"),
        ("CLN-029", "Disposable Gloves 100pk", "Powder-free nitrile gloves",
         "Safety & PPE", "CleanSupplies Ltd", 15.99, 7.00, 10, "N2-02", "490000000029"),
        ("CLN-030", "Dust Masks 50pk", "Disposable protective dust masks",
         "Safety & PPE", "CleanSupplies Ltd", 9.99, 4.00, 20, "N2-01", "490000000030"),
    ]
    products = []
    by_sku = {}
    lot_info = {
        # sku -> (primary_batch, expiry_offset_days, [extra_lot_specs...])
        "BEV-016": ("B-9161", 150, []),
        "BEV-017": ("B-8170", 25, []),
        "BEV-018": ("B-8180", 45, []),
        "BEV-019": ("B-8191", 70, []),
        "BEV-020": ("B-8201", 50, []),
        "BEV-021": ("B-8211", 12, []),
        "BEV-022": ("B-8221", 40, []),
        "BEV-023": ("B-8231", 35, []),
        "BEV-024": ("B-8241", 120, []),
        "BEV-025": ("B-8251", 45, []),
        "BEV-026": ("B-8261", 20, []),
        "BEV-027": ("B-8271", 55, []),
        "BEV-030": ("FG-3001", 90, []),
        "BEV-031": ("B-8311", 75, []),
        "BEV-032": ("B-8321", 30, []),
        "BEV-033": ("B-8331", 65, []),
        "BEV-034": ("B-8341", 90, []),
        "BEV-035": ("B-8351", 60, []),
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

    # Variant demo 1: earbuds parent holds no stock, variants hold stock at A-04-01.
    parent1 = Product(
        sku="TECH-015", name="Wireless Earbuds Pro",
        description="True wireless earbuds with active noise cancelling",
        category_id=cat["Audio"].id, supplier_id=sup["PrimeData Systems"].id,
        unit_price=79.99, cost_price=42.00, quantity=0, reorder_level=12,
        location="A-04-01", location_id=locs["A-04-01"].id, barcode="490000000015",
        is_active=True, created_at=days_ago(18),
    )
    db.add(parent1)
    db.commit()
    db.refresh(parent1)
    for sku, attrs, barcode in [
        ("TECH-015-BLK", {"Color": "Black"}, "490000000062"),
        ("TECH-015-WHT", {"Color": "White"}, "490000000063"),
        ("TECH-015-GRN", {"Color": "Green"}, "490000000064"),
    ]:
        v = Product(
            sku=sku, name=parent1.name, category_id=parent1.category_id,
            supplier_id=parent1.supplier_id, parent_id=parent1.id, attributes=attrs,
            unit_price=79.99, cost_price=42.00, quantity=0, reorder_level=5,
            location="A-04-01", location_id=locs["A-04-01"].id, barcode=barcode,
            is_active=True, created_at=days_ago(18),
        )
        db.add(v)
        db.commit()
        db.refresh(v)
        products.append(v)
        by_sku[sku] = v
    products.append(parent1)
    by_sku["TECH-015"] = parent1

    # Variant demo 2: travel mug variants at F-02-01.
    parent2 = Product(
        sku="BEV-029", name="Insulated Travel Mug",
        description="Double-wall insulated travel mug, 400ml",
        category_id=cat["Coffee & Tea"].id, supplier_id=sup["Beverage Wholesale Co"].id,
        unit_price=19.99, cost_price=9.00, quantity=0, reorder_level=10,
        location="F-02-01", location_id=locs["F-02-01"].id, barcode="490000000029",
        is_active=True, created_at=days_ago(16),
    )
    db.add(parent2)
    db.commit()
    db.refresh(parent2)
    for sku, attrs, barcode in [
        ("BEV-029-BLK", {"Color": "Black"}, "490000000065"),
        ("BEV-029-STEEL", {"Color": "Steel"}, "490000000066"),
        ("BEV-029-TEAL", {"Color": "Teal"}, "490000000067"),
    ]:
        v = Product(
            sku=sku, name=parent2.name, category_id=parent2.category_id,
            supplier_id=parent2.supplier_id, parent_id=parent2.id, attributes=attrs,
            unit_price=19.99, cost_price=9.00, quantity=0, reorder_level=4,
            location="F-02-01", location_id=locs["F-02-01"].id, barcode=barcode,
            is_active=True, created_at=days_ago(16),
        )
        db.add(v)
        db.commit()
        db.refresh(v)
        products.append(v)
        by_sku[sku] = v
    products.append(parent2)
    by_sku["BEV-029"] = parent2

    # Serialized product 1: smart watch.
    serial_prod = Product(
        sku="TECH-030", name="Smart Watch Pro",
        description="GPS smart watch with health monitoring",
        category_id=cat["Phones"].id, supplier_id=sup["PrimeData Systems"].id,
        unit_price=249.99, cost_price=140.00, quantity=0, reorder_level=5,
        is_serialized=True, location="A-04-02", location_id=locs["A-04-02"].id,
        barcode="490000000038", is_active=True, created_at=days_ago(25),
    )
    db.add(serial_prod)
    db.commit()
    db.refresh(serial_prod)
    products.append(serial_prod)
    by_sku["TECH-030"] = serial_prod

    # Serialized product 2: laptop.
    laptop = Product(
        sku="TECH-038", name="ProLaptop X1",
        description="14\" business laptop, 16GB RAM, 512GB SSD",
        category_id=cat["Computers"].id, supplier_id=sup["PrimeData Systems"].id,
        unit_price=1299.99, cost_price=820.00, quantity=0, reorder_level=3,
        is_serialized=True, location="A-04-03", location_id=locs["A-04-03"].id,
        barcode="490000000068", is_active=True, created_at=days_ago(22),
    )
    db.add(laptop)
    db.commit()
    db.refresh(laptop)
    products.append(laptop)
    by_sku["TECH-038"] = laptop

    # Serialized product 3: USB-C dock.
    dock = Product(
        sku="TECH-039", name="USB-C Dock Pro",
        description="Dual 4K display USB-C docking station",
        category_id=cat["Cables & Adapters"].id, supplier_id=sup["NexusGear Components"].id,
        unit_price=79.99, cost_price=42.00, quantity=0, reorder_level=8,
        is_serialized=True, location="E-01-02", location_id=locs["E-01-02"].id,
        barcode="490000000069", is_active=True, created_at=days_ago(18),
    )
    db.add(dock)
    db.commit()
    db.refresh(dock)
    products.append(dock)
    by_sku["TECH-039"] = dock

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
        ("BEV-017", "B-7100", -5, "expired", "Beverage Wholesale Co"),
        ("BEV-018", "B-8180", 45, "in_stock", "Beverage Wholesale Co"),
        ("BEV-018", "B-8190", 60, "in_stock", "Beverage Wholesale Co"),
        ("BEV-019", "B-8191", 70, "in_stock", "DrinksDirect"),
        ("BEV-020", "B-8201", 50, "in_stock", "DrinksDirect"),
        ("BEV-020", "B-8202", 80, "in_stock", "DrinksDirect"),
        ("BEV-021", "B-8211", 12, "in_stock", "DrinksDirect"),
        ("BEV-021", "B-8222", -3, "expired", "DrinksDirect"),
        ("BEV-022", "B-8221", 40, "in_stock", "Beverage Wholesale Co"),
        ("BEV-022", "B-8223", 90, "in_stock", "Beverage Wholesale Co"),
        ("BEV-023", "B-8231", 35, "in_stock", "Beverage Wholesale Co"),
        ("BEV-024", "B-8241", 120, "in_stock", "Beverage Wholesale Co"),
        ("BEV-025", "B-8251", 45, "in_stock", "DrinksDirect"),
        ("BEV-025", "B-8252", 70, "in_stock", "DrinksDirect"),
        ("BEV-026", "B-8261", 20, "in_stock", "DrinksDirect"),
        ("BEV-027", "B-8271", 55, "in_stock", "DrinksDirect"),
        ("BEV-030", "FG-3001", 90, "in_stock", "Beverage Wholesale Co"),
        ("BEV-030", "FG-3002", 95, "sold", "Beverage Wholesale Co"),
        ("BEV-031", "B-8311", 75, "in_stock", "SnackLine Foods"),
        ("BEV-032", "B-8321", 30, "in_stock", "SnackLine Foods"),
        ("BEV-033", "B-8331", 65, "in_stock", "SnackLine Foods"),
        ("BEV-034", "B-8341", 90, "in_stock", "SnackLine Foods"),
        ("BEV-035", "B-8351", 60, "in_stock", "DrinksDirect"),
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
    """Create loose serials (receive movements) for the three serialized products."""
    admin = next(u for u in users if u.role == "admin")
    plans = [
        ("TECH-030", "SW", 15, "A-04-02", 25, "RCP-0006", "Initial stock - Smart Watch Pro"),
        ("TECH-038", "LP", 12, "A-04-03", 20, "RCP-0007", "Initial stock - ProLaptop X1"),
        ("TECH-039", "DK", 6, "E-01-02", 15, "RCP-0008", "Initial stock - USB-C Dock Pro"),
    ]
    result: dict[str, list[SerialNumber]] = {}
    for sku, prefix, count, bin_code, created_days, ref, note in plans:
        product = by_sku[sku]
        bin_id = locs[bin_code].id
        serials = []
        created = days_ago(created_days, hour=9)
        for i in range(1, count + 1):
            s = SerialNumber(product_id=product.id, serial_number=f"{prefix}-{i:04d}",
                             location_id=bin_id, status=inventory.SERIAL_STATUS_IN_STOCK,
                             created_at=created)
            db.add(s)
            db.commit()
            db.refresh(s)
            serials.append(s)
        for i, s in enumerate(serials):
            _post(db, admin, product, 1, inventory.RECEIVE,
                  created + timedelta(hours=i), to_loc=bin_id, serial_id=s.id,
                  ref_type="receipt", ref=ref, notes=note)
        result[sku] = serials
    db.commit()
    return result


def create_serialized_lots(db, users, by_sku, locs):
    """Serialized lot batches plus unit-level status coverage.

    Smart watch: SW-BATCH-1 is fully shipped later via SHP-0008 (lot flips to
    ``sold``); SW-BATCH-2 stays in stock. Laptop: LP-BATCH-1 stays in stock,
    LP-BATCH-2 is shipped via SHP-0013. Loose serials get one unit per
    lifecycle status (reserved, quarantined, inactive, scrapped) through the
    same journal-entry paths the API uses.
    """
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")

    def _make_batches(product, bin_code, batches, ref, created_days):
        bin_id = locs[bin_code].id
        created = days_ago(created_days, hour=9)
        batch_lists = []
        for i, (lot_number, numbers) in enumerate(batches):
            lot = Lot(product_id=product.id, lot_number=lot_number, status="in_stock",
                      received_date=created.date(), created_at=created)
            db.add(lot)
            db.flush()
            serials = []
            for j, sn in enumerate(numbers):
                serial = SerialNumber(product_id=product.id, serial_number=sn,
                                      lot_id=lot.id, location_id=bin_id,
                                      status=inventory.SERIAL_STATUS_IN_STOCK,
                                      created_at=created)
                db.add(serial)
                db.flush()
                _post(db, admin, product, 1, inventory.RECEIVE,
                      created + timedelta(hours=j), to_loc=bin_id,
                      lot=lot.id, serial_id=serial.id,
                      ref_type="receipt", ref=ref,
                      notes=f"Serialized lot {lot_number}")
                serials.append(serial)
            batch_lists.append(serials)
        return tuple(batch_lists)

    def _status_plans(product, bin_code, plans, day):
        bin_id = locs[bin_code].id
        for serial in db.query(SerialNumber).filter(
            SerialNumber.product_id == product.id, SerialNumber.lot_id.is_(None)
        ).all():
            plan = plans.get(serial.serial_number)
            if not plan:
                continue
            mtype, loc_code, expected, ref_type, ref, notes = plan
            if mtype == inventory.ISSUE:
                _post(db, worker, product, -1, mtype, days_ago(day, hour=11),
                      from_loc=bin_id, to_loc=locs[loc_code].id,
                      serial_id=serial.id, ref_type=ref_type, ref=ref, notes=notes)
            else:
                _post(db, worker, product, -1, mtype, days_ago(day, hour=11),
                      from_loc=locs[loc_code].id, serial_id=serial.id,
                      ref_type=ref_type, ref=ref, notes=notes)
            db.refresh(serial)
            assert serial.status == expected, (serial.serial_number, serial.status, expected)

    watch = by_sku["TECH-030"]
    watch_batch1, watch_batch2 = _make_batches(
        watch, "A-04-02",
        [("SW-BATCH-1", ("SW-B0101", "SW-B0102", "SW-B0103")),
         ("SW-BATCH-2", ("SW-B0201", "SW-B0202"))],
        "RCP-0009", 20)
    _status_plans(watch, "A-04-02", {
        "SW-0005": (inventory.ISSUE, "WIP", inventory.SERIAL_STATUS_RESERVED,
                    "work_order", "WO-REV", "Reserved for assembly"),
        "SW-0006": (inventory.ADJUSTMENT, "A-04-02", inventory.SERIAL_STATUS_QUARANTINED,
                    "adjustment", "SER-ADJ", "Off-spec unit quarantined"),
        "SW-0007": (inventory.DEACTIVATE, "A-04-02", inventory.SERIAL_STATUS_INACTIVE,
                    "adjustment", "SER-ADJ", "Unit deactivated from inventory"),
        "SW-0008": (inventory.SCRAP, "A-04-02", inventory.SERIAL_STATUS_SCRAPPED,
                    "adjustment", "SER-ADJ", "Unit scrapped after damage"),
    }, 18)

    laptop = by_sku["TECH-038"]
    laptop_batch1, laptop_batch2 = _make_batches(
        laptop, "A-04-03",
        [("LP-BATCH-1", ("LP-B0101", "LP-B0102")),
         ("LP-BATCH-2", ("LP-B0201", "LP-B0202"))],
        "RCP-0010", 16)
    _status_plans(laptop, "A-04-03", {
        "LP-0005": (inventory.ISSUE, "WIP", inventory.SERIAL_STATUS_RESERVED,
                    "work_order", "WO-REV", "Reserved for config"),
        "LP-0006": (inventory.ADJUSTMENT, "A-04-03", inventory.SERIAL_STATUS_QUARANTINED,
                    "adjustment", "SER-ADJ", "Failed QC - quarantined"),
        "LP-0007": (inventory.DEACTIVATE, "A-04-03", inventory.SERIAL_STATUS_INACTIVE,
                    "adjustment", "SER-ADJ", "Deactivated demo unit"),
        "LP-0008": (inventory.SCRAP, "A-04-03", inventory.SERIAL_STATUS_SCRAPPED,
                    "adjustment", "SER-ADJ", "Scrapped after transit damage"),
    }, 13)

    db.commit()
    return {
        "watch_batch1": watch_batch1,
        "watch_batch2": watch_batch2,
        "laptop_batch1": laptop_batch1,
        "laptop_batch2": laptop_batch2,
    }


def create_lpns(db, locs):
    specs = [
        ("PAL-1001", "pallet", "B-03-01", "active"),
        ("PAL-1002", "pallet", "B-03-02", "active"),
        ("BOX-3001", "carton", "A-04-02", "active"),
        ("PAL-1003", "pallet", "R-DOCK", "active"),
        ("CTN-3002", "carton", "C-01-02", "active"),
        ("PAL-1004", "pallet", "D-01-01", "active"),
        ("BOX-3003", "carton", "A-03-03", "active"),
        ("PAL-1005", "pallet", "B-01-03", "active"),
        ("BOX-3004", "carton", "STAGE", "active"),
        ("CTN-3005", "carton", "N1-01", "active"),
        ("PAL-1006", "pallet", "SHIP", "active"),
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
    worker = next(u for u in users if u.role == "worker")
    plans = [
        ("OFF-010", "PAL-1001", "B-03-01", 40, None),
        ("OFF-012", "PAL-1002", "B-03-02", 20, None),
        ("TECH-003", "BOX-3001", "A-04-02", 6, None),
        ("BEV-017", "CTN-3002", "C-01-02", 10, "B-8170"),
        ("CLN-022", "PAL-1004", "D-01-01", 30, None),
        ("TECH-009", "BOX-3003", "A-03-03", 4, None),
        ("OFF-016", "PAL-1005", "B-01-03", 12, None),
        ("BEV-024", "CTN-3005", "N1-01", 10, "B-8241"),
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
        (9, "pending", "PrimeData Systems", "Peripherals order",
         [("TECH-002", 30, 11.00), ("TECH-003", 20, 29.00)]),
        (8, "received", "DrinksDirect", "Soft drinks replenishment",
         [("BEV-020", 24, 4.00), ("BEV-021", 12, 15.00)]),
        (6, "pending", "TechSource Distribution", "Accessories restock",
         [("TECH-005", 80, 4.20), ("TECH-006", 20, 6.00)]),
        (30, "cancelled", "Sunrise Electronics", "Cancelled - wrong pricing",
         [("TECH-009", 10, 50.00)]),
        (5, "pending", "ACME Paper Co", "Paper reorder",
         [("OFF-010", 120, 3.20)]),
        (10, "received", "NexusGear Components", "Storage and networking",
         [("TECH-014", 20, 68.00), ("TECH-020", 15, 46.00), ("TECH-021", 50, 3.60)]),
        (8, "received", "SnackLine Foods", "Break room snacks",
         [("BEV-031", 40, 10.50), ("BEV-032", 30, 13.00), ("BEV-033", 20, 8.80)]),
        (7, "received", "PackRight Supplies", "Packaging restock",
         [("OFF-021", 30, 8.00), ("OFF-022", 20, 11.00), ("OFF-023", 15, 13.50)]),
        (6, "received", "DrinksDirect", "Water and juice",
         [("BEV-019", 40, 7.50), ("BEV-026", 25, 9.00), ("BEV-035", 50, 6.00)]),
        (5, "received", "Beverage Wholesale Co", "Coffee and tea",
         [("BEV-022", 30, 5.50), ("BEV-023", 30, 4.00), ("BEV-024", 40, 2.40)]),
        (4, "pending", "GlobalOffice Partners", "Filing restock",
         [("OFF-025", 40, 10.00), ("OFF-026", 20, 16.50)]),
        (11, "cancelled", "CleanSupplies Ltd", "Cancelled - stock found",
         [("CLN-029", 20, 6.50)]),
        (3, "pending", "NexusGear Components", "Networking reorder",
         [("TECH-022", 20, 17.00), ("TECH-024", 50, 5.00)]),
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
        (9, "NexusGear Components", "PO-0011", "Storage and networking receiving",
         [("TECH-014", 20, 68.00, "E-02-02", None),
          ("TECH-020", 15, 46.00, "N1-01", None),
          ("TECH-021", 50, 3.60, "N1-02", None)]),
        (7, "SnackLine Foods", "PO-0012", "Snacks receiving",
         [("BEV-031", 40, 10.50, "N2-01", "B-8311"),
          ("BEV-032", 30, 13.00, "N2-02", "B-8321"),
          ("BEV-033", 20, 8.80, "N2-01", "B-8331")]),
        (6, "PackRight Supplies", "PO-0013", "Packaging receiving",
         [("OFF-021", 30, 8.00, "B-03-01", None),
          ("OFF-022", 20, 11.00, "B-03-02", None),
          ("OFF-023", 15, 13.50, "B-03-01", None)]),
        (5, "DrinksDirect", "PO-0014", "Water and juice receiving",
         [("BEV-019", 40, 7.50, "C-02-01", "B-8191"),
          ("BEV-026", 25, 9.00, "C-03-02", "B-8261"),
          ("BEV-035", 50, 6.00, "C-02-01", "B-8351")]),
        (4, "Beverage Wholesale Co", "PO-0015", "Coffee and tea receiving",
         [("BEV-022", 30, 5.50, "C-03-01", "B-8221"),
          ("BEV-023", 30, 4.00, "C-03-02", "B-8231"),
          ("BEV-024", 40, 2.40, "N1-01", "B-8241")]),
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
              supplier_id=sup["DrinksDirect"].id, user_id=admin.id,
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

    # 4) Pending - networking from NexusGear (matches pending PO-0018).
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["NexusGear Components"].id, user_id=admin.id,
              expected_arrival=date.today() + timedelta(days=7),
              notes="Networking reorder - in transit",
              created_at=days_ago(1, hour=10))
    db.add(asn)
    db.flush()
    for sku, qty, cost, bin_code in [("TECH-022", 20, 17.00, "N1-01"),
                                     ("TECH-024", 50, 5.00, "E-02-02")]:
        db.add(ASNItem(asn_id=asn.id, product_id=by_sku[sku].id, expected_qty=qty,
                       unit_cost=cost, location_id=locs[bin_code].id))
    asns.append(asn)
    asn_counter += 1

    # 5) Cancelled - gloves from CleanSupplies (matches cancelled PO-0017).
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["CleanSupplies Ltd"].id, user_id=admin.id,
              expected_arrival=days_ago(9).date(), notes="Cancelled - stock found",
              status="cancelled", created_at=days_ago(12, hour=9))
    db.add(asn)
    db.flush()
    db.add(ASNItem(asn_id=asn.id, product_id=by_sku["CLN-029"].id,
                   expected_qty=20, unit_cost=6.50, location_id=locs["N2-02"].id))
    asns.append(asn)
    asn_counter += 1

    # 6) Pending - paper from ACME (matches pending PO-0010).
    asn = ASN(asn_number=f"ASN-{asn_counter:04d}",
              supplier_id=sup["ACME Paper Co"].id, user_id=admin.id,
              expected_arrival=date.today() + timedelta(days=3),
              notes="Paper reorder - truck dispatched",
              created_at=days_ago(1, hour=8))
    db.add(asn)
    db.flush()
    db.add(ASNItem(asn_id=asn.id, product_id=by_sku["OFF-010"].id,
                   expected_qty=120, unit_cost=3.20, location_id=locs["B-01-01"].id))
    asns.append(asn)
    asn_counter += 1

    db.commit()
    return asns


def create_opening_stock(db, users, by_sku, lots, locs):
    worker = next(u for u in users if u.role == "worker")
    opening = {
        # sku -> [(bin_code, qty, lot_number | None)]
        "TECH-001": [("A-01-01", 60, None)],
        "TECH-002": [("A-01-02", 40, None)],
        "TECH-003": [("A-01-03", 25, None)],
        "TECH-010": [("E-01-01", 12, None)],
        "TECH-011": [("E-01-02", 25, None)],
        "TECH-012": [("E-01-03", 20, None)],
        "TECH-014": [("E-02-02", 30, None)],
        "TECH-036": [("A-01-02", 14, None)],
        "TECH-037": [("A-01-03", 16, None)],
        "TECH-040": [("N1-01", 0, None)],
        "TECH-041": [("E-01-01", 0, None)],
        "TECH-004": [("A-02-01", 35, None)],
        "TECH-005": [("A-02-02", 160, None)],
        "TECH-006": [("A-02-03", 40, None)],
        "TECH-016": [("E-02-02", 30, None)],
        "TECH-017": [("E-01-01", 25, None)],
        "TECH-018": [("E-01-03", 40, None)],
        "TECH-007": [("A-03-01", 30, None)],
        "TECH-008": [("A-03-02", 5, None)],
        "TECH-009": [("A-03-03", 15, None)],
        "TECH-013": [("E-02-01", 18, None)],
        "TECH-019": [("E-02-01", 10, None)],
        "TECH-033": [("E-01-01", 25, None)],
        "TECH-020": [("N1-01", 20, None)],
        "TECH-021": [("N1-02", 60, None)],
        "TECH-022": [("N1-01", 15, None)],
        "TECH-023": [("N1-02", 12, None)],
        "TECH-024": [("E-02-02", 30, None)],
        "TECH-026": [("N2-02", 25, None)],
        "TECH-027": [("N2-01", 15, None)],
        "TECH-028": [("E-01-02", 30, None)],
        "TECH-029": [("E-02-02", 30, None)],
        "TECH-031": [("E-01-03", 12, None)],
        "TECH-032": [("E-02-01", 20, None)],
        "TECH-034": [("E-01-02", 50, None)],
        "TECH-035": [("E-02-02", 20, None)],
        "OFF-010": [("B-01-01", 80, None)],
        "OFF-011": [("B-01-02", 80, None)],
        "OFF-012": [("B-01-03", 40, None)],
        "OFF-016": [("F-01-01", 30, None)],
        "OFF-018": [("F-01-03", 40, None)],
        "OFF-013": [("B-02-01", 60, None)],
        "OFF-014": [("B-02-02", 50, None)],
        "OFF-015": [("B-02-03", 45, None)],
        "OFF-019": [("F-02-01", 30, None)],
        "OFF-020": [("F-02-02", 35, None)],
        "OFF-017": [("F-01-02", 20, None)],
        "OFF-021": [("B-03-01", 40, None)],
        "OFF-022": [("B-03-02", 25, None)],
        "OFF-023": [("B-03-01", 20, None)],
        "OFF-024": [("F-01-02", 50, None)],
        "OFF-025": [("F-01-03", 40, None)],
        "OFF-026": [("F-02-01", 15, None)],
        "OFF-027": [("F-02-02", 20, None)],
        "OFF-028": [("N1-02", 12, None)],
        "OFF-030": [("F-02-02", 0, None)],
        "BEV-016": [("C-01-01", 40, "B-9161"), ("C-01-01", 2, "B-8150")],  # expired lot still on hand
        "BEV-017": [("C-01-02", 30, "B-8170"), ("C-01-02", 5, "Q-7090")],  # quarantined lot still on hand
        "BEV-018": [("C-01-03", 20, "B-8180"), ("C-01-03", 15, "B-8190")],
        "BEV-019": [("C-02-01", 30, "B-8191")],
        "BEV-020": [("C-02-02", 40, "B-8201"), ("C-02-02", 20, "B-8202")],
        "BEV-021": [("C-02-03", 20, "B-8211"), ("C-02-03", 4, "B-8222")],  # expired on hand
        "BEV-022": [("C-03-01", 20, "B-8221"), ("C-03-01", 10, "B-8223")],
        "BEV-023": [("C-03-02", 25, "B-8231")],
        "BEV-024": [("N1-01", 30, "B-8241")],
        "BEV-025": [("N1-02", 25, "B-8251"), ("N1-02", 15, "B-8252")],
        "BEV-026": [("C-03-02", 20, "B-8261")],
        "BEV-027": [("C-02-03", 25, "B-8271")],
        "BEV-030": [("C-03-01", 4, "FG-3001")],
        "BEV-031": [("N2-01", 30, "B-8311")],
        "BEV-032": [("N2-02", 25, "B-8321")],
        "BEV-033": [("N2-01", 15, "B-8331")],
        "BEV-034": [("N2-02", 20, "B-8341")],
        "BEV-035": [("C-02-01", 40, "B-8351")],
        "BEV-036": [("C-03-02", 0, None)],
        "BEV-037": [("N2-01", 0, None)],
        "TECH-015-BLK": [("A-04-01", 18, None)],
        "TECH-015-WHT": [("A-04-01", 12, None)],
        "TECH-015-GRN": [("A-04-01", 5, None)],
        "BEV-029-BLK": [("F-02-01", 15, None)],
        "BEV-029-STEEL": [("F-02-01", 18, None)],
        "BEV-029-TEAL": [("F-02-01", 8, None)],
        "CLN-022": [("D-01-01", 70, None)],
        "CLN-023": [("D-01-02", 30, None)],
        "CLN-024": [("D-01-03", 45, None)],
        "CLN-025": [("D-02-01", 25, None)],
        "CLN-026": [("D-02-02", 40, None)],
        "CLN-027": [("F-02-01", 25, None)],
        "CLN-028": [("F-02-02", 30, None)],
        "CLN-029": [("N2-02", 20, None)],
        "CLN-030": [("N2-01", 30, None)],
    }
    for sku, bins in opening.items():
        for bin_code, qty, lot_num in bins:
            if qty <= 0:
                continue
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
        ("CLN-022", 8, "D-01-01", "D-01-02", None, 5),
        ("TECH-005", 20, "A-02-02", "A-02-03", None, 4),
        ("OFF-010", 15, "B-01-01", "B-03-01", None, 3),
        ("BEV-019", 6, "C-02-01", "C-03-01", "B-8191", 2),
    ]
    transfers = []
    for idx, (sku, qty, from_bin, to_bin, lot_num, days) in enumerate(plans):
        out, inbound = inventory.transfer_stock(
            db, product_id=by_sku[sku].id, user_id=worker.id, quantity=qty,
            from_location_id=locs[from_bin].id, to_location_id=locs[to_bin].id,
            lot_id=lots[sku][lot_num].id if lot_num else None,
            reference_type="transfer", reference=f"TRF-{idx + 1:04d}",
            notes=f"Replenishment to {to_bin}",
        )
        out.created_at = days_ago(days, hour=14)
        inbound.created_at = days_ago(days, hour=14, minute=5)
        transfers.append((out, inbound))
    db.commit()
    return transfers


def _sell(db, worker, product, qty, customer, created, invoice):
    """Allocate lots and post the sale movements for one line (returns nothing)."""
    allocation = inventory.allocate_lots(db, product_id=product.id, quantity=qty)
    for lot_id, take, location_id, lpn_id in allocation:
        _post(db, worker, product, -take, inventory.SALE,
              created + timedelta(minutes=random.randint(1, 25)),
              from_loc=location_id, lot=lot_id, lpn=lpn_id,
              ref_type="sale", ref=invoice,
              notes=f"Sale to {customer.name}")
    return allocation


def _make_sale(db, worker, customer, created, items, settings, invoice=None):
    """Create a Sale + items and post stock out. Returns a record dict."""
    tax_rate = settings.tax_rate if settings else 0.0
    subtotal = 0.0
    sale_items = []
    for sku, qty in items:
        product = db.query(Product).filter(Product.sku == sku).first()
        subtotal += float(product.unit_price) * qty
        sale_items.append((product, qty))
    tax = subtotal * tax_rate / 100
    invoice = invoice or f"INV-{sale_records_counter[0]:04d}"
    sale = Sale(
        invoice_number=invoice, customer_id=customer.id, user_id=worker.id,
        subtotal=round(subtotal, 2), tax_amount=round(tax, 2),
        total_amount=round(subtotal + tax, 2),
        status="completed", payment_method=random.choice(["cash", "card", "transfer"]),
        created_at=created,
    )
    db.add(sale)
    db.flush()
    for product, qty in sale_items:
        db.add(SaleItem(sale_id=sale.id, product_id=product.id, quantity=qty,
                        unit_price=float(product.unit_price)))
        _sell(db, worker, product, qty, customer, created, sale.invoice_number)
    return {
        "id": sale.id, "invoice": sale.invoice_number, "customer": customer,
        "created_at": created, "items": [(p.id, q) for p, q in sale_items],
    }


def create_sales(db, users, customers, products, by_sku):
    """A large, time-spread book of deterministic sales + two refunds.

    Sales flow through inventory.allocate_lots exactly like checkout. Two
    fully-refunded sales restore stock through sale_return movements like the
    refund endpoint does.
    """
    worker = next(u for u in users if u.role == "worker")
    settings = db.query(Settings).first()
    customer_by_name = {c.name: c for c in customers}

    global sale_records_counter
    sale_records_counter = [1]

    # (days_ago, customer, [(sku, qty), ...])
    sale_plan = [
        (25, "Acme Retail Store", [("OFF-010", 6), ("OFF-011", 4), ("OFF-013", 5)]),
        (24, "Downtown Cafe", [("BEV-016", 4), ("BEV-017", 2), ("BEV-018", 3)]),
        (23, "TechNest Ltd", [("TECH-002", 3), ("TECH-005", 5), ("TECH-006", 2)]),
        (22, "City Office Hub", [("OFF-014", 4), ("OFF-015", 3), ("CLN-022", 6)]),
        (21, "FreshMart Grocery", [("BEV-020", 5), ("BEV-019", 4), ("BEV-021", 2)]),
        (20, "Jane Doe", [("TECH-004", 1), ("TECH-005", 2)]),
        (19, "Bright Learning Center", [("OFF-011", 5), ("OFF-013", 6), ("CLN-024", 4)]),
        (18, "Acme Retail Store", [("BEV-030", 2), ("BEV-016", 3), ("BEV-018", 2)]),
        (17, "TechNest Ltd", [("TECH-001", 2), ("TECH-003", 2), ("TECH-007", 2)]),
        (16, "City Office Hub", [("OFF-010", 8), ("OFF-012", 3), ("OFF-025", 3)]),
        (15, "Downtown Cafe", [("BEV-022", 3), ("BEV-023", 3), ("BEV-024", 4)]),
        (14, "John Smith", [("TECH-005", 3), ("TECH-034", 2), ("TECH-018", 2)]),
        (13, "FreshMart Grocery", [("BEV-035", 5), ("BEV-025", 3), ("BEV-026", 3)]),
        (12, "Acme Retail Store", [("CLN-025", 2), ("CLN-026", 3), ("CLN-022", 5)]),
        (11, "TechNest Ltd", [("TECH-008", 1), ("TECH-009", 2), ("TECH-013", 2)]),
        (10, "City Office Hub", [("OFF-017", 3), ("OFF-018", 4), ("OFF-024", 4)]),
        (9, "Downtown Cafe", [("BEV-020", 4), ("BEV-027", 3), ("BEV-031", 3)]),
        (8, "Bright Learning Center", [("OFF-019", 3), ("OFF-020", 3), ("CLN-027", 3)]),
        (7, "Acme Retail Store", [("TECH-010", 1), ("TECH-011", 2), ("TECH-014", 2)]),
        (7, "Jane Doe", [("BEV-029-STEEL", 1), ("TECH-033", 1), ("TECH-036", 1)]),
        (6, "TechNest Ltd", [("TECH-016", 2), ("TECH-017", 2), ("TECH-020", 2)]),
        (6, "City Office Hub", [("OFF-021", 3), ("OFF-022", 2), ("OFF-023", 2)]),
        (5, "FreshMart Grocery", [("BEV-032", 3), ("BEV-033", 3), ("BEV-034", 2)]),
        (5, "Downtown Cafe", [("BEV-035", 4), ("BEV-019", 3), ("BEV-026", 2)]),
        (4, "Acme Retail Store", [("TECH-021", 5), ("TECH-022", 1), ("TECH-024", 2)]),
        (4, "TechNest Ltd", [("TECH-027", 1), ("TECH-028", 2), ("TECH-029", 2)]),
        (3, "City Office Hub", [("OFF-026", 2), ("OFF-027", 2), ("OFF-028", 1)]),
        (3, "Bright Learning Center", [("CLN-028", 3), ("CLN-029", 2), ("CLN-030", 3)]),
        (2, "Acme Retail Store", [("TECH-015-BLK", 2), ("TECH-015-WHT", 1), ("TECH-037", 1)]),
        (2, "FreshMart Grocery", [("BEV-025", 3), ("BEV-031", 4), ("BEV-034", 2)]),
    ]

    sale_records = []
    for days, cust_name, items in sale_plan:
        customer = customer_by_name[cust_name]
        created = days_ago(days, hour=random.randint(10, 18))
        record = _make_sale(db, worker, customer, created, items, settings)
        sale_records.append(record)
        sale_records_counter[0] += 1

    # Refund 1: Cola 12pk sale fully refunded, restoring stock to its lot.
    created = days_ago(2, hour=12)
    customer = customer_by_name["FreshMart Grocery"]
    record = _make_sale(db, worker, customer, created, [("BEV-020", 3)], settings)
    invoice = record["invoice"]
    originals = db.query(StockMovement).filter(
        StockMovement.reference_type == "sale",
        StockMovement.reference == invoice,
        StockMovement.product_id == by_sku["BEV-020"].id,
        StockMovement.quantity_change < 0,
    ).order_by(StockMovement.id).all()
    restored = 0
    for m in originals:
        if restored >= 3:
            break
        take = min(-m.quantity_change, 3 - restored)
        _post(db, worker, by_sku["BEV-020"], take, "return",
              days_ago(1, hour=10),
              from_loc=m.from_location_id, lot=m.lot_id, lpn=m.lpn_id,
              ref_type="sale_return", ref=f"Refund {invoice}",
              notes="Sale refund")
        restored += take
    if restored < 3:
        _post(db, worker, by_sku["BEV-020"], 3 - restored, "return",
              days_ago(1, hour=10),
              ref_type="sale_return", ref=f"Refund {invoice}",
              notes="Sale refund")
    refunded_sale = db.get(Sale, record["id"])
    refunded_sale.status = "refunded"
    refunded_sale.updated_at = days_ago(1, hour=11)
    record["refunded"] = True
    sale_records.append(record)
    sale_records_counter[0] += 1

    # Refund 2: USB-C Cable sale fully refunded.
    created = days_ago(1, hour=15)
    customer = customer_by_name["Jane Doe"]
    record = _make_sale(db, worker, customer, created, [("TECH-005", 2)], settings)
    invoice = record["invoice"]
    originals = db.query(StockMovement).filter(
        StockMovement.reference_type == "sale",
        StockMovement.reference == invoice,
        StockMovement.product_id == by_sku["TECH-005"].id,
        StockMovement.quantity_change < 0,
    ).order_by(StockMovement.id).all()
    restored = 0
    for m in originals:
        if restored >= 2:
            break
        take = min(-m.quantity_change, 2 - restored)
        _post(db, worker, by_sku["TECH-005"], take, "return",
              days_ago(0, hour=9),
              from_loc=m.from_location_id, lot=m.lot_id, lpn=m.lpn_id,
              ref_type="sale_return", ref=f"Refund {invoice}",
              notes="Sale refund")
        restored += take
    refunded_sale = db.get(Sale, record["id"])
    refunded_sale.status = "refunded"
    refunded_sale.updated_at = days_ago(0, hour=10)
    record["refunded"] = True
    sale_records.append(record)
    sale_records_counter[0] += 1

    db.commit()
    return sale_records, sale_records_counter[0] - 1


sale_records_counter = [1]


def create_serialized_sales(db, users, customers, serials, by_sku, locs):
    """Unit-level sales of serialized products (watches + laptop)."""
    worker = next(u for u in users if u.role == "worker")
    settings = db.query(Settings).first()
    tax_rate = settings.tax_rate if settings else 0.0
    records = []
    counter = 1

    watch = by_sku["TECH-030"]
    for i, serial in enumerate(serials["TECH-030"][12:15]):
        customer = customers[i % len(customers)]
        created = days_ago(3 + i * 2, hour=15)
        price = float(watch.unit_price)
        tax = price * tax_rate / 100
        invoice = f"INV-S{counter:04d}"
        sale = Sale(invoice_number=invoice, customer_id=customer.id, user_id=worker.id,
                    subtotal=price, tax_amount=tax, total_amount=price + tax,
                    status="completed", payment_method="card",
                    notes=f"Serial {serial.serial_number}", created_at=created)
        db.add(sale)
        db.flush()
        db.add(SaleItem(sale_id=sale.id, product_id=watch.id, quantity=1,
                        unit_price=price))
        _post(db, worker, watch, -1, inventory.SALE,
              created + timedelta(minutes=5), from_loc=locs["A-04-02"].id,
              serial_id=serial.id,
              ref_type="sale", ref=invoice, notes=f"Serial {serial.serial_number}")
        records.append({"id": sale.id, "invoice": invoice, "serial": serial.serial_number})
        counter += 1

    laptop = by_sku["TECH-038"]
    serial = serials["TECH-038"][0]
    customer = customers[3 % len(customers)]
    created = days_ago(5, hour=14)
    price = float(laptop.unit_price)
    tax = price * tax_rate / 100
    invoice = f"INV-S{counter:04d}"
    sale = Sale(invoice_number=invoice, customer_id=customer.id, user_id=worker.id,
                subtotal=price, tax_amount=tax, total_amount=price + tax,
                status="completed", payment_method="transfer",
                notes=f"Serial {serial.serial_number}", created_at=created)
    db.add(sale)
    db.flush()
    db.add(SaleItem(sale_id=sale.id, product_id=laptop.id, quantity=1, unit_price=price))
    _post(db, worker, laptop, -1, inventory.SALE,
          created + timedelta(minutes=5), from_loc=locs["A-04-03"].id,
          serial_id=serial.id,
          ref_type="sale", ref=invoice, notes=f"Serial {serial.serial_number}")
    records.append({"id": sale.id, "invoice": invoice, "serial": serial.serial_number})
    counter += 1

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
    _post(db, worker, by_sku["TECH-005"], 4, "return",
          days_ago(3, hour=10), to_loc=locs["A-02-02"].id,
          ref_type="sale_return", ref="RMA-1003",
          notes="Wrong length cable returned")
    _post(db, admin, by_sku["BEV-016"], -2, "adjustment",
          days_ago(5, hour=16), to_loc=locs["C-01-01"].id,
          lot=lots["BEV-016"]["B-9161"].id,
          ref="Adjustment (damaged)", notes="Bags burst in storage")
    _post(db, admin, by_sku["BEV-018"], -1, "adjustment",
          days_ago(4, hour=14), to_loc=locs["C-01-03"].id,
          lot=lots["BEV-018"]["B-8180"].id,
          ref="Adjustment (damaged)", notes="Pod box crushed")
    _post(db, admin, by_sku["CLN-022"], 5, "adjustment",
          days_ago(3, hour=9), to_loc=locs["D-01-01"].id,
          ref="Adjustment (recount)", notes="Cycle count correction")
    _post(db, admin, by_sku["OFF-015"], 2, "adjustment",
          days_ago(2, hour=16), to_loc=locs["B-02-03"].id,
          ref="Adjustment (recount)", notes="Found unrecorded stock")
    db.commit()


def create_cycle_counts(db, users, by_sku, locs):
    worker = next(u for u in users if u.role == "worker")
    cc_specs = [
        # (number, days_ago, bin_code, status, sku, counted_delta | None, notes)
        ("CC-0001", 4, "A-01-01", "completed", "TECH-001", +1, "Shelf count discrepancy"),
        ("CC-0002", 3, "D-01-01", "completed", "CLN-022", -2, "Found fewer than expected"),
        ("CC-0003", 1, "B-02-03", "pending", "OFF-015", None, "Scheduled count"),
        ("CC-0004", 0, "C-02-02", "pending", "BEV-020", None, "Scheduled count"),
        ("CC-0005", 1, "A-01-03", "in_progress", "TECH-003", +1, "Partially counted - awaiting recount"),
        ("CC-0006", 0, "D-01-02", "cancelled", "CLN-023", None, "Cancelled before counting"),
        ("CC-0007", 2, "A-02-02", "completed", "TECH-005", 0, "Count matched"),
        ("CC-0008", 0, "A-03-02", "pending", "TECH-008", None, "Scheduled count"),
        ("CC-0009", 1, "B-01-01", "completed", "OFF-010", -1, "Found fewer than expected"),
        ("CC-0010", 0, "C-01-01", "in_progress", "BEV-016", None, "Partial count started"),
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
    """Manufacturing demo: ten BOMs across tech, office and beverage bundles."""
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
        (6, "TECH-040", "BOM - Workstation Bundle", [
            ("TECH-002", 1), ("TECH-011", 1), ("TECH-039", 1),
        ]),
        (7, "OFF-030", "BOM - Desk Kit", [
            ("OFF-013", 2), ("OFF-014", 2), ("OFF-025", 1),
        ]),
        (8, "BEV-036", "BOM - Coffee Gift Box", [
            ("BEV-016", 1), ("BEV-024", 1), ("BEV-029-STEEL", 1),
        ]),
        (9, "BEV-037", "BOM - Snack Box", [
            ("BEV-031", 2), ("BEV-033", 1), ("BEV-034", 1),
        ]),
        (10, "TECH-041", "BOM - USB-C Starter Kit", [
            ("TECH-004", 1), ("TECH-005", 2), ("TECH-016", 1),
        ]),
    ]
    for idx, (num, out_sku, name, components) in enumerate(specs):
        bom = BOM(product_id=by_sku[out_sku].id, name=name,
                  description="Demo multi-level bill of materials",
                  created_at=days_ago(14 - idx))
        db.add(bom)
        db.flush()
        for pos, (sku, qty) in enumerate(components):
            db.add(BOMItem(bom_id=bom.id, product_id=by_sku[sku].id,
                           quantity=qty, position=pos))
        boms.append(bom)
    db.commit()
    return boms


def create_work_orders(db, users, by_sku, boms, locs):
    """Work orders across every status: completed (backflush/FG lot, lot
    genealogy, serialized, mixed bulk+serialized), planned, released,
    in_progress, and cancelled."""
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
    # Backflush: actually issue every required component to WIP so the ledger,
    # component stock and item.quantity_issued stay in sync (mirrors the
    # complete/backflush endpoint).
    for item in boms[1].items:
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(
            db, product_id=item.product_id, quantity=item.quantity * 20)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(8, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0001",
                  notes="Issued to WO-0001 (backflushed)")
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
            if lot_id is not None:
                consumed[lot_id] = consumed.get(lot_id, 0) + take
    # The FG-3001 lot already exists (seeded opening stock), so receive the
    # manufactured units onto it and link its consumed parents for genealogy.
    fg_lot = db.query(Lot).filter(
        Lot.product_id == by_sku["BEV-030"].id, Lot.lot_number == "FG-3001"
    ).first()
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

    def issue_components(wo, ts):
        """Release/start WOs: issue every required bulk component to WIP."""
        wip = locs["WIP"]
        for item in wo.items:
            remaining = item.quantity_required - item.quantity_issued
            if remaining <= 0:
                continue
            product = db.get(Product, item.product_id)
            allocation = inventory.allocate_lots(db, product_id=item.product_id, quantity=remaining)
            for lot_id, take, source_location, lpn_id in allocation:
                _post(db, worker, product, -take, inventory.ISSUE,
                      ts, from_loc=source_location, to_loc=wip.id,
                      lot=lot_id, lpn=lpn_id,
                      ref_type="work_order", ref=wo.wo_number,
                      notes=f"Issued to {wo.wo_number}")
            item.quantity_issued += remaining
        wo.wip_location_id = wip.id

    # WO-0005 (released): components issued to WIP, awaiting start.
    released = WorkOrder(
        wo_number="WO-0005",
        product_id=by_sku["TECH-004"].id,  # Smartphone Charger 65W
        quantity=5, bom_id=boms[1].id, status="released", priority="high",
        notes="Released - components issued to WIP", created_by=admin.id,
        created_at=days_ago(1, hour=9),
    )
    db.add(released)
    db.flush()
    for item in boms[1].items:
        db.add(WorkOrderItem(
            work_order_id=released.id, product_id=item.product_id,
            quantity_required=item.quantity * 5, quantity_issued=0,
        ))
    issue_components(released, days_ago(1, hour=10))
    wos.append(released)

    # WO-0006 (in_progress): released and started.
    in_progress = WorkOrder(
        wo_number="WO-0006",
        product_id=by_sku["TECH-001"].id,  # Laptop Stand Pro
        quantity=3, bom_id=boms[0].id, status="in_progress", priority="normal",
        notes="In production on the line", created_by=admin.id,
        started_at=days_ago(1, hour=11),
        created_at=days_ago(2, hour=10),
    )
    db.add(in_progress)
    db.flush()
    for item in boms[0].items:
        db.add(WorkOrderItem(
            work_order_id=in_progress.id, product_id=item.product_id,
            quantity_required=item.quantity * 3, quantity_issued=0,
        ))
    issue_components(in_progress, days_ago(1, hour=10))
    wos.append(in_progress)

    # WO-0007 (cancelled): planned then cancelled before any issue.
    cancelled = WorkOrder(
        wo_number="WO-0007",
        product_id=by_sku["BEV-030"].id,  # Beverage Combo Pack
        quantity=2, bom_id=boms[4].id, status="cancelled", priority="low",
        notes="Cancelled - no demand", created_by=admin.id,
        created_at=days_ago(1, hour=8),
    )
    db.add(cancelled)
    db.flush()
    for item in boms[4].items:
        db.add(WorkOrderItem(
            work_order_id=cancelled.id, product_id=item.product_id,
            quantity_required=item.quantity * 2, quantity_issued=0,
        ))
    wos.append(cancelled)

    # WO-0008 (completed): Desk Kit backflush from office stock.
    desk = WorkOrder(
        wo_number="WO-0008",
        product_id=by_sku["OFF-030"].id,
        quantity=10, bom_id=boms[6].id, status="completed",
        notes="Backflushed demo run - office kitting", created_by=admin.id,
        started_at=days_ago(4, hour=9), completed_at=days_ago(3, hour=15),
        created_at=days_ago(5, hour=9),
    )
    db.add(desk)
    db.flush()
    for item in boms[6].items:
        db.add(WorkOrderItem(
            work_order_id=desk.id, product_id=item.product_id,
            quantity_required=item.quantity * 10, quantity_issued=item.quantity * 10,
        ))
    for item in boms[6].items:
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(
            db, product_id=item.product_id, quantity=item.quantity * 10)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(4, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0008",
                  notes="Issued to WO-0008 (backflushed)")
    _post(db, worker, by_sku["OFF-030"], 10, inventory.RECEIVE,
          days_ago(3, hour=15), to_loc=locs["F-02-02"].id,
          ref_type="work_order", ref="WO-0008",
          notes="Received from WO-0008 (backflushed)")
    wos.append(desk)

    # WO-0009 (completed): Coffee Gift Box with lot genealogy.
    gift = WorkOrder(
        wo_number="WO-0009",
        product_id=by_sku["BEV-036"].id,
        quantity=6, bom_id=boms[7].id, status="completed",
        notes="Lot genealogy demo - coffee gift boxes", created_by=admin.id,
        started_at=days_ago(3, hour=9), completed_at=days_ago(2, hour=15),
        created_at=days_ago(4, hour=9),
    )
    db.add(gift)
    db.flush()
    for item in boms[7].items:
        db.add(WorkOrderItem(
            work_order_id=gift.id, product_id=item.product_id,
            quantity_required=item.quantity * 6, quantity_issued=item.quantity * 6,
        ))
    consumed_gift: dict[int, int] = {}
    for item in boms[7].items:
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(
            db, product_id=item.product_id, quantity=item.quantity * 6)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(3, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0009", notes="Issued to WO-0009")
            if lot_id is not None:
                consumed_gift[lot_id] = consumed_gift.get(lot_id, 0) + take
    fg_gift = Lot(product_id=by_sku["BEV-036"].id, lot_number="FG-9001", status="in_stock",
                  received_date=days_ago(2).date())
    db.add(fg_gift)
    db.flush()
    _post(db, worker, by_sku["BEV-036"], 6, inventory.RECEIVE,
          days_ago(2, hour=15), to_loc=locs["C-03-02"].id, lot=fg_gift.id,
          ref_type="work_order", ref="WO-0009", notes="Received from WO-0009")
    for parent_lot_id, qty in consumed_gift.items():
        db.add(LotLink(parent_lot_id=parent_lot_id, child_lot_id=fg_gift.id,
                       work_order_id=gift.id, quantity=qty))
    wos.append(gift)

    # WO-0010 (completed): Workstation Bundle consuming a serialized dock.
    bundle = WorkOrder(
        wo_number="WO-0010",
        product_id=by_sku["TECH-040"].id,
        quantity=2, bom_id=boms[5].id, status="completed",
        notes="Serialized component consumption demo", created_by=admin.id,
        started_at=days_ago(2, hour=9), completed_at=days_ago(1, hour=15),
        created_at=days_ago(3, hour=9),
    )
    db.add(bundle)
    db.flush()
    for item in boms[5].items:
        db.add(WorkOrderItem(
            work_order_id=bundle.id, product_id=item.product_id,
            quantity_required=item.quantity * 2, quantity_issued=item.quantity * 2,
        ))
    for item in boms[5].items:
        if item.product_id == by_sku["TECH-039"].id:
            serials = inventory.allocate_serials(
                db, product_id=item.product_id, quantity=item.quantity * 2)
            for serial in serials:
                _post(db, worker, by_sku["TECH-039"], -1, inventory.ISSUE,
                      days_ago(2, hour=10), from_loc=serial.location_id,
                      to_loc=locs["WIP"].id, lot=serial.lot_id, serial_id=serial.id,
                      ref_type="work_order", ref="WO-0010",
                      notes="Serialized dock issued to WO-0010")
            continue
        product = db.get(Product, item.product_id)
        allocation = inventory.allocate_lots(
            db, product_id=item.product_id, quantity=item.quantity * 2)
        for lot_id, take, source_location, lpn_id in allocation:
            _post(db, worker, product, -take, inventory.ISSUE,
                  days_ago(2, hour=10), from_loc=source_location, to_loc=locs["WIP"].id,
                  lot=lot_id, lpn=lpn_id,
                  ref_type="work_order", ref="WO-0010", notes="Issued to WO-0010")
    _post(db, worker, by_sku["TECH-040"], 2, inventory.RECEIVE,
          days_ago(1, hour=15), to_loc=locs["N1-01"].id,
          ref_type="work_order", ref="WO-0010", notes="Received from WO-0010")
    wos.append(bundle)

    # WO-0011 (in_progress): USB-C Starter Kit on the line.
    starter = WorkOrder(
        wo_number="WO-0011",
        product_id=by_sku["TECH-041"].id,
        quantity=4, bom_id=boms[9].id, status="in_progress", priority="high",
        notes="Kitting on the line", created_by=admin.id,
        started_at=days_ago(1, hour=11),
        created_at=days_ago(2, hour=9),
    )
    db.add(starter)
    db.flush()
    for item in boms[9].items:
        db.add(WorkOrderItem(
            work_order_id=starter.id, product_id=item.product_id,
            quantity_required=item.quantity * 4, quantity_issued=0,
        ))
    issue_components(starter, days_ago(1, hour=10))
    wos.append(starter)

    # WO-0012 (planned): Snack Box scheduled.
    snack = WorkOrder(
        wo_number="WO-0012",
        product_id=by_sku["BEV-037"].id,
        quantity=8, bom_id=boms[8].id, status="planned", priority="normal",
        notes="Scheduled after next snack delivery", created_by=admin.id,
        created_at=days_ago(1, hour=14),
    )
    db.add(snack)
    db.flush()
    for item in boms[8].items:
        db.add(WorkOrderItem(
            work_order_id=snack.id, product_id=item.product_id,
            quantity_required=item.quantity * 8, quantity_issued=0,
        ))
    wos.append(snack)

    db.commit()
    return wos


def create_quality_checks(db, users, by_sku):
    """QC records: passes, one fail (quarantine) and a pending inspection."""
    admin = next(u for u in users if u.role == "admin")
    specs = [
        ("QC-0001", "BEV-016", "B-9161", "pass", "Sensory + moisture check passed", 6),
        ("QC-0002", "BEV-017", "Q-7090", "fail", "Lot quarantined after off-spec inspection", 4),
        ("QC-0003", "BEV-020", "B-8201", "pass", "Can integrity + taste panel passed", 5),
        ("QC-0004", "BEV-021", "B-8211", "pending", "Awaiting lab results", 1),
        ("QC-0005", "BEV-018", "B-8180", "pass", "Capsule pressure test passed", 3),
        ("QC-0006", "BEV-019", "B-8191", "pass", "Bottling batch verified", 2),
    ]
    checks = []
    for qc_number, sku, lot_number, result, notes, day in specs:
        lot = db.query(Lot).filter(
            Lot.product_id == by_sku[sku].id, Lot.lot_number == lot_number
        ).first()
        check = QualityCheck(
            qc_number=qc_number, product_id=by_sku[sku].id, lot_id=lot.id,
            batch_number=lot_number, result=result, notes=notes, checked_by=admin.id,
            checked_at=days_ago(day, hour=11) if result != "pending" else None,
            created_at=days_ago(day, hour=10),
        )
        db.add(check)
        db.flush()
        checks.append(check)
    db.commit()
    return checks


def create_shipments(db, users, customers, by_sku, locs, serial_batches=None):
    """Shipments across the full fulfillment lifecycle.

    Mirrors the pick/pack/ship endpoints: picking transfers stock to the
    shipping dock, shipping posts SHIP journal entries. Two shipped shipments
    are turned into invoices (the create-sale flow), serialized shipments
    exercise unit-level serial tracking, and two shipments ship entire
    serialized lots (SW-BATCH-1 / LP-BATCH-2) so those lots flip to sold.
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

    # Shipped: serialized lot batch (SW-BATCH-1). The lot flips to 'sold'
    # once none of its units remain in stock.
    if serial_batches and serial_batches.get("watch_batch1"):
        batch1_serials = serial_batches["watch_batch1"]
        s8 = new_shipment("SHP-0008", "TechNest Ltd", carrier="DHL",
                          tracking="DHL 9988 7766 55", notes="Serialized lot sale - SW-BATCH-1",
                          created_days=1)
        add_items(s8, [("TECH-030", len(batch1_serials))])
        for serial in batch1_serials:
            movements = inventory.transfer_stock(
                db, product_id=serial.product_id, user_id=worker.id, quantity=1,
                from_location_id=serial.location_id, to_location_id=shipping.id,
                lot_id=serial.lot_id, serial_id=serial.id,
                transfer_id=s8.id, reference_type="shipment",
                reference=s8.shipment_number,
                notes=f"Picked to {s8.shipment_number}",
            )
            for m in movements:
                m.created_at = days_ago(1, hour=11)
        for item in s8.items:
            item.quantity_picked = item.quantity_ordered
        s8.staging_location_id = shipping.id
        s8.status = "picking"
        s8.updated_at = days_ago(1, hour=11)
        for item in s8.items:
            item.quantity_packed = item.quantity_picked
        s8.status = "packed"
        s8.updated_at = days_ago(1, hour=12)
        for serial in batch1_serials:
            m = inventory.post_journal_entry(
                db, product_id=serial.product_id, user_id=worker.id,
                quantity_change=-1, movement_type=inventory.SHIP,
                from_location_id=shipping.id, lot_id=serial.lot_id,
                serial_id=serial.id,
                reference_type="shipment", reference=s8.shipment_number,
                notes=f"Shipped on {s8.shipment_number}",
            )
            m.created_at = days_ago(1, hour=13)
            inventory.sync_serialized_lot_status(db, serial.lot_id)
        for item in s8.items:
            item.quantity_shipped = item.quantity_picked
        s8.status = "shipped"
        s8.ship_date = days_ago(1, hour=13)
        s8.shipped_at = days_ago(1, hour=13)
        s8.updated_at = days_ago(1, hour=13)
        db.flush()

    # Shipped + invoice: laptop shipped with serial tracking.
    s9 = new_shipment("SHP-0009", "Solar Peak Energy", carrier="DHL",
                      tracking="DHL 1122 3344 55", notes="Laptop order - invoiced",
                      created_days=2)
    add_items(s9, [("TECH-038", 1)])
    pick(s9, [("TECH-038", 1)], days_ago(1, hour=13))
    pack(s9, days_ago(1, hour=15))
    ship(s9, days_ago(0, hour=9))
    subtotal = 0.0
    sale_items = []
    for item in s9.items:
        qty = item.quantity_shipped
        price = float(item.product.unit_price or 0.0)
        subtotal += qty * price
        sale_items.append((item.product_id, qty, price))
    tax = subtotal * tax_rate / 100
    invoice = next_document_number(db, "invoice", "INV-")
    sale = Sale(invoice_number=invoice, customer_id=s9.customer_id, user_id=worker.id,
                subtotal=round(subtotal, 2), tax_amount=round(tax, 2),
                total_amount=round(subtotal + tax, 2), status="completed",
                payment_method="transfer",
                notes=f"Invoice created from shipment {s9.shipment_number}",
                created_at=days_ago(0, hour=10))
    db.add(sale)
    db.flush()
    for pid, qty, price in sale_items:
        db.add(SaleItem(sale_id=sale.id, product_id=pid, quantity=qty, unit_price=price))
    s9.sale_id = sale.id

    # Picking: laptop picked to staging, awaiting pack.
    s10 = new_shipment("SHP-0010", "TechNest Ltd", notes="Laptop for deployment",
                       created_days=1)
    add_items(s10, [("TECH-038", 1)])
    pick(s10, [("TECH-038", 1)], days_ago(0, hour=11))

    # Draft: mixed stationery + beverage order.
    s11 = new_shipment("SHP-0011", "Riverside Hotel", notes="Housekeeping order",
                       created_days=1)
    add_items(s11, [("OFF-011", 8), ("OFF-018", 5), ("BEV-020", 6)])

    # Shipped: lot-tracked beverage order.
    s12 = new_shipment("SHP-0012", "Harborview Bistro", carrier="FedEx",
                       tracking="FEDEX 8812 0098 21", notes="Beverage restock",
                       created_days=1)
    add_items(s12, [("BEV-016", 3), ("BEV-018", 2), ("BEV-020", 4)])
    pick(s12, [("BEV-016", 3), ("BEV-018", 2), ("BEV-020", 4)], days_ago(0, hour=13))
    pack(s12, days_ago(0, hour=15))
    ship(s12, days_ago(0, hour=16))

    # Shipped: serialized laptop lot batch (LP-BATCH-2) -> lot flips to sold.
    if serial_batches and serial_batches.get("laptop_batch2"):
        batch_serials = serial_batches["laptop_batch2"]
        s13 = new_shipment("SHP-0013", "Midtown Bookstore", carrier="DHL",
                           tracking="DHL 5566 7788 99", notes="Serialized lot sale - LP-BATCH-2",
                           created_days=1)
        add_items(s13, [("TECH-038", len(batch_serials))])
        for serial in batch_serials:
            movements = inventory.transfer_stock(
                db, product_id=serial.product_id, user_id=worker.id, quantity=1,
                from_location_id=serial.location_id, to_location_id=shipping.id,
                lot_id=serial.lot_id, serial_id=serial.id,
                transfer_id=s13.id, reference_type="shipment",
                reference=s13.shipment_number,
                notes=f"Picked to {s13.shipment_number}",
            )
            for m in movements:
                m.created_at = days_ago(0, hour=12)
        for item in s13.items:
            item.quantity_picked = item.quantity_ordered
        s13.staging_location_id = shipping.id
        s13.status = "picking"
        s13.updated_at = days_ago(0, hour=12)
        for item in s13.items:
            item.quantity_packed = item.quantity_picked
        s13.status = "packed"
        s13.updated_at = days_ago(0, hour=13)
        for serial in batch_serials:
            m = inventory.post_journal_entry(
                db, product_id=serial.product_id, user_id=worker.id,
                quantity_change=-1, movement_type=inventory.SHIP,
                from_location_id=shipping.id, lot_id=serial.lot_id,
                serial_id=serial.id,
                reference_type="shipment", reference=s13.shipment_number,
                notes=f"Shipped on {s13.shipment_number}",
            )
            m.created_at = days_ago(0, hour=14)
            inventory.sync_serialized_lot_status(db, serial.lot_id)
        for item in s13.items:
            item.quantity_shipped = item.quantity_picked
        s13.status = "shipped"
        s13.ship_date = days_ago(0, hour=14)
        s13.shipped_at = days_ago(0, hour=14)
        s13.updated_at = days_ago(0, hour=14)
        db.flush()

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


def seed_document_sequences(db, sales_count, orders, receipts, asns, ccs, transfers, lpns, boms, wos, qcs):
    rows = [
        ("invoice", sales_count + 1),
        ("purchase_order", len(orders) + 1),
        ("receipt", len(receipts) + 1),
        ("asn", len(asns) + 1),
        ("cycle_count", len(ccs) + 1),
        ("lpn", len(lpns) + 1),
        ("transfer", len(transfers) + 1),
        ("work_order", len(wos) + 1),
        ("bom", len(boms) + 1),
        ("quality_check", len(qcs) + 1),
        # Shipments are created after this runs, so their counter is fixed here.
        ("shipment", 14),
    ]
    for name, next_value in rows:
        db.add(DocumentSequence(name=name, next_value=next_value))
    db.commit()


def create_notifications(db, users, products, sale_records, shipments, wos):
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

    for s in shipments:
        if s.status == "shipped":
            notes.append(Notification(
                user_id=admin.id, type="info", title=f"Shipment {s.shipment_number} shipped",
                message=f"{len(s.items)} item(s) sent via {s.carrier or 'courier'}.",
                link="/shipments", is_read=False, created_at=s.shipped_at or days_ago(0),
            ))

    for wo in wos:
        if wo.status == "completed":
            notes.append(Notification(
                user_id=admin.id, type="info", title=f"Work order {wo.wo_number} completed",
                message=f"{wo.quantity} x {wo.product.name} received into stock.",
                link="/work-orders", is_read=False, created_at=wo.completed_at or days_ago(0),
            ))

    quarantined_lot = db.query(Lot).filter(Lot.status == "quarantined").first()
    if quarantined_lot:
        notes.append(Notification(
            user_id=admin.id, type="warning", title="Lot quarantined",
            message=f"Lot {quarantined_lot.lot_number} ({quarantined_lot.product.name}) is quarantined.",
            link="/lots", is_read=False, created_at=days_ago(4, hour=14),
        ))

    expired_lot = db.query(Lot).filter(Lot.status == "expired").first()
    if expired_lot:
        notes.append(Notification(
            user_id=admin.id, type="danger", title="Lot expired",
            message=f"Lot {expired_lot.lot_number} ({expired_lot.product.name}) has expired.",
            link="/lots", is_read=False, created_at=days_ago(2, hour=9),
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


def create_activity_logs(db, users, orders, receipts, asns, ccs, sale_records, by_sku, wos):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    refunded = [s for s in sale_records if s.get("refunded")]
    logs = [
        (admin, "create", "location", 1, "Created location 'Main Warehouse'", 60),
        (admin, "create", "location", 2, "Created location 'North Annex'", 40),
        (admin, "create", "category", 1, "Created category 'Electronics'", 40),
        (admin, "create", "supplier", 1, "Created supplier 'TechSource Distribution'", 38),
        (admin, "create", "customer", 1, "Created customer 'Acme Retail Store'", 36),
        (admin, "create", "product", 1, "Created product 'Laptop Stand Pro'", 30),
        (admin, "create", "product", by_sku["TECH-030"].id, "Created serialized product 'Smart Watch Pro'", 25),
        (admin, "create", "product", by_sku["TECH-038"].id, "Created serialized product 'ProLaptop X1'", 22),
        (admin, "create", "product", by_sku["TECH-039"].id, "Created serialized product 'USB-C Dock Pro'", 18),
        (worker, "create", "order", orders[0].id, f"Created order '{orders[0].order_number}'", 28),
        (worker, "update", "order", orders[0].id, f"Order '{orders[0].order_number}' status changed to 'received'", 27),
        (worker, "create", "receipt", receipts[0].id, f"Receipt '{receipts[0].receipt_number}' for 48 unit(s)", 27),
        (worker, "create", "stock_movement", 1, "in movement of 8 x 'Laptop Stand Pro'", 27),
        (admin, "create", "lpn", 1, "Created LPN 'PAL-1001'", 30),
        (admin, "move", "lpn", 2, "Moved LPN 'PAL-1002'", 22),
        (admin, "create", "asn", asns[0].id, f"Created ASN '{asns[0].asn_number}'", 2),
        (worker, "create", "asn", asns[2].id, f"Received ASN '{asns[2].asn_number}' (36 unit(s))", 7),
        (worker, "complete", "cycle_count", ccs[0].id, f"Completed cycle count '{ccs[0].cc_number}' (variance +1)", 4),
        (worker, "create", "cycle_count", ccs[4].id, f"Started cycle count '{ccs[4].cc_number}' (in progress)", 1),
        (worker, "cancel", "cycle_count", ccs[5].id, f"Cancelled cycle count '{ccs[5].cc_number}'", 0),
        (worker, "create", "sale", sale_records[0]["id"], f"Sale '{sale_records[0]['invoice']}'", 25),
        (worker, "create", "stock_movement", 3, "out movement of 4 x 'Wireless Mouse M300'", 2),
        (admin, "create", "customer", 8, "Created customer 'Bright Learning Center'", 1),
        (admin, "update", "stock_movement", 2, "Updated stock movement #2", 1),
    ]
    if wos:
        logs += [
            (worker, "complete", "work_order", wos[0].id, "Completed work order 'WO-0001' (received 20 x 'Smartphone Charger 65W')", 7),
            (worker, "complete", "work_order", wos[2].id, "Completed work order 'WO-0003' (lot genealogy demo)", 5),
            (worker, "complete", "work_order", wos[3].id, "Completed work order 'WO-0004' (received 2 x 'Smart Watch Pro')", 3),
            (worker, "release", "work_order", wos[4].id, "Released work order 'WO-0005' (components issued to WIP)", 1),
            (worker, "start", "work_order", wos[5].id, "Started work order 'WO-0006'", 1),
            (worker, "cancel", "work_order", wos[6].id, "Cancelled work order 'WO-0007'", 0),
            (worker, "complete", "work_order", wos[7].id, "Completed work order 'WO-0008' (received 10 x 'Desk Kit')", 3),
            (worker, "complete", "work_order", wos[8].id, "Completed work order 'WO-0009' (received 6 x 'Coffee Gift Box')", 2),
            (worker, "complete", "work_order", wos[9].id, "Completed work order 'WO-0010' (consumed serialized docks)", 1),
            (worker, "start", "work_order", wos[10].id, "Started work order 'WO-0011'", 1),
            (admin, "create", "work_order", wos[11].id, "Planned work order 'WO-0012'", 1),
        ]
    for s in refunded:
        logs.append(
            (worker, "update", "sale", s["id"],
             f"Refunded sale '{s['invoice']}' (stock restored)", 1),
        )
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
        serial_batches = create_serialized_lots(db, users, by_sku, locs)
        lpns = create_lpns(db, locs)
        orders = create_orders(db, users, suppliers, by_sku)
        receipts = create_receipts(db, users, suppliers, by_sku, lots, locs)
        asns = create_asns(db, users, suppliers, by_sku, lots, locs)
        create_opening_stock(db, users, by_sku, lots, locs)
        create_lpn_stock(db, users, by_sku, lots, lpns, locs)
        transfers = create_transfers(db, users, by_sku, lots, locs)
        sale_records, sales_count = create_sales(db, users, customers, products, by_sku)
        serial_sales = create_serialized_sales(db, users, customers, serials, by_sku, locs)
        create_returns_and_adjustments(db, users, by_sku, lots, locs)
        ccs = create_cycle_counts(db, users, by_sku, locs)
        boms = create_boms(db, by_sku)
        wos = create_work_orders(db, users, by_sku, boms, locs)
        qcs = create_quality_checks(db, users, by_sku)
        seed_document_sequences(db, sales_count + len(serial_sales), orders, receipts,
                                asns, ccs, transfers, lpns, boms, wos, qcs)
        shipments = create_shipments(db, users, customers, by_sku, locs,
                                     serial_batches=serial_batches)
        create_notifications(db, users, products, sale_records, shipments, wos)
        create_activity_logs(db, users, orders, receipts, asns, ccs, sale_records, by_sku, wos)
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
        print(f"  Sales             : {db.query(Sale).count()}")
        print(f"  Stock Lines       : {db.query(StockLine).count()}")
        print(f"  Stock Movements   : {db.query(StockMovement).count()}")
        print(f"  Activity Logs     : {db.query(ActivityLog).count()}")
        print(f"  Notifications     : {db.query(Notification).count()}")
        print("  Demo login        : admin / admin123")
        print("                     : michael / worker123")
        print("                     : sarah   / worker123")
        print("                     : david   / worker123")
        print("                     : jessica / worker123")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
