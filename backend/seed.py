"""Comprehensive seed script for the Inventory Management System.

Run from the backend directory:
    python seed.py

Wipes existing data and inserts realistic demo data across every entity:
users, categories, suppliers, customers, products, orders, stock movements,
and activity logs.
"""

import random
from datetime import datetime, timedelta

from app.database import Base, engine, SessionLocal, run_migrations
from app.models import (
    Category, Customer, LPN, Location, Lot, Notification, Order, OrderItem,
    Product, Sale, SaleItem, SerialNumber, StockLine, StockMovement, Supplier,
    User,
)
from app.models.activity_log import ActivityLog
from app.models.settings import Settings
from app.services import inventory
from app.services.auth import hash_password

random.seed(42)


def wipe_all(db):
    db.query(StockLine).delete()
    db.query(SerialNumber).delete()
    db.query(Lot).delete()
    db.query(LPN).delete()
    db.query(Location).delete()
    db.query(Notification).delete()
    db.query(SaleItem).delete()
    db.query(Sale).delete()
    db.query(OrderItem).delete()
    db.query(StockMovement).delete()
    db.query(Order).delete()
    db.query(ActivityLog).delete()
    db.query(Product).delete()
    db.query(Customer).delete()
    db.query(Supplier).delete()
    db.query(Category).delete()
    db.query(Settings).delete()
    db.query(User).delete()
    from sqlalchemy import text
    try:
        db.execute(text("DELETE FROM sqlite_sequence"))
    except Exception:
        pass
    db.commit()


def days_ago(n, hour=10, minute=0):
    return datetime.now() - timedelta(days=n, hours=hour, minutes=minute)


def create_users(db):
    users = [
        User(username="admin", email="admin@inventory.com",
             password_hash=hash_password("admin123"), role="admin", created_at=days_ago(45)),
        User(username="michael", email="michael@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(40)),
        User(username="sarah", email="sarah@inventory.com",
             password_hash=hash_password("worker123"), role="worker", created_at=days_ago(35)),
    ]
    db.add_all(users)
    db.commit()
    for u in users:
        db.refresh(u)
    return users


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
    # Wire up subcategories
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


def build_products(db, cats, suppliers):
    sup = {s.name: s for s in suppliers}
    cat = {c.name: c for c in cats.values()}
    rows = [
        # sku, name, desc, category, supplier, unit, cost, qty, reorder, location, barcode
        ("TECH-001", "Laptop Stand Pro", "Ergonomic aluminum laptop stand",
         "Computers", "TechSource Distribution", 89.99, 45.00, 5, 10, "A-01-01", "490000000001"),
        ("TECH-002", "Wireless Mouse M300", "Silent 2.4G wireless mouse",
         "Computers", "PrimeData Systems", 24.99, 12.50, 40, 15, "A-01-02", "490000000002"),
        ("TECH-003", "Mechanical Keyboard K87", "Tenkeyless hot-swap mechanical keyboard",
         "Computers", "PrimeData Systems", 59.99, 32.00, 25, 10, "A-01-03", "490000000003"),
        ("TECH-004", "Smartphone Charger 65W", "GaN fast charger with USB-C",
         "Phones", "TechSource Distribution", 34.99, 18.00, 60, 20, "A-02-01", "490000000004"),
        ("TECH-005", "USB-C Cable 2m", "Braided USB-C to USB-C cable",
         "Phones", "TechSource Distribution", 12.99, 5.00, 120, 30, "A-02-02", "490000000005"),
        ("TECH-006", "Phone Stand Alu", "Adjustable aluminum phone stand",
         "Phones", "Sunrise Electronics", 14.99, 7.20, 35, 10, "A-02-03", "490000000006"),
        ("TECH-007", "Bluetooth Speaker Mini", "Portable IPX7 waterproof speaker",
         "Audio", "TechSource Distribution", 44.99, 25.00, 30, 12, "A-03-01", "490000000007"),
        ("TECH-008", "Noise-Cancelling Headphones", "Over-ear ANC wireless headphones",
         "Audio", "PrimeData Systems", 149.99, 85.00, 3, 5, "A-03-02", "490000000008"),
        ("TECH-009", "Studio Mic Kit", "USB condenser mic with pop filter",
         "Audio", "Sunrise Electronics", 99.99, 55.00, 12, 6, "A-03-03", "490000000009"),
        ("OFF-010", "A4 Paper Ream (500)", "80gsm multi-purpose copy paper",
         "Paper Products", "ACME Paper Co", 6.99, 3.80, 200, 50, "B-01-01", "490000000010"),
        ("OFF-011", "Sticky Notes 3x3", "Assorted color sticky notes, 12 pads",
         "Paper Products", "GlobalOffice Partners", 3.49, 1.20, 150, 40, "B-01-02", "490000000011"),
        ("OFF-012", "Letter Envelopes Pack", "Self-seal envelopes, pack of 100",
         "Paper Products", "ACME Paper Co", 8.99, 4.50, 80, 25, "B-01-03", "490000000012"),
        ("OFF-013", "Gel Pens 12pk", "Smooth-writing gel pens, 0.5mm",
         "Writing Instruments", "GlobalOffice Partners", 9.99, 4.20, 90, 30, "B-02-01", "490000000013"),
        ("OFF-014", "Highlighter 5pk", "Chisel tip fluorescent highlighters",
         "Writing Instruments", "GlobalOffice Partners", 7.49, 3.10, 75, 20, "B-02-02", "490000000014"),
        ("OFF-015", "Whiteboard Markers 8pk", "Low-odor dry erase markers",
         "Writing Instruments", "ACME Paper Co", 11.99, 5.80, 45, 15, "B-02-03", "490000000015"),
        ("BEV-016", "Ground Coffee 1kg", "Medium roast whole bean coffee",
         "Coffee & Tea", "Beverage Wholesale Co", 18.99, 11.00, 8, 15, "C-01-01", "490000000016"),
        ("BEV-017", "Green Tea Box 20", "Organic green tea bags, 20 count",
         "Coffee & Tea", "Beverage Wholesale Co", 9.49, 5.50, 55, 20, "C-01-02", "490000000017"),
        ("BEV-018", "Espresso Capsules 10", "Compatible espresso pods, 10 pack",
         "Coffee & Tea", "Beverage Wholesale Co", 12.99, 7.80, 40, 15, "C-01-03", "490000000018"),
        ("BEV-019", "Sparkling Water 24pk", "Naturally sparkling mineral water",
         "Soft Drinks", "DrinksDirect", 14.99, 8.00, 0, 10, "C-02-01", "490000000019"),
        ("BEV-020", "Cola 12pk", "Classic cola, 330ml cans",
         "Soft Drinks", "DrinksDirect", 7.99, 4.20, 100, 40, "C-02-02", "490000000020"),
        ("BEV-021", "Energy Drink 24pk", "Sugar-free energy drink, 250ml",
         "Soft Drinks", "DrinksDirect", 29.99, 16.50, 6, 12, "C-02-03", "490000000021"),
        ("CLN-022", "All-Purpose Cleaner 1L", "Multi-surface disinfectant spray",
         "Cleaning Supplies", "CleanSupplies Ltd", 5.99, 2.40, 130, 50, "D-01-01", "490000000022"),
        ("CLN-023", "Microfiber Cloths 10pk", "Reusable lint-free cleaning cloths",
         "Cleaning Supplies", "CleanSupplies Ltd", 12.99, 6.00, 60, 20, "D-01-02", "490000000023"),
        ("CLN-024", "Hand Sanitizer 500ml", "Alcohol gel hand sanitizer pump",
         "Cleaning Supplies", "CleanSupplies Ltd", 4.99, 1.80, 85, 30, "D-01-03", "490000000024"),
    ]
    products = []
    perishable = {
        "Coffee & Tea": (60, 150),
        "Soft Drinks": (120, 240),
        "Cleaning Supplies": (200, 400),
    }
    forced_expiry = {
        "BEV-016": -3,    # already expired
        "BEV-021": 12,    # expiring soon
        "BEV-017": 25,    # expiring soon
        "BEV-018": 45,    # later this quarter
    }
    for sku, name, desc, cat_name, sup_name, unit, cost, qty, reorder, loc, barcode in rows:
        batch_number = ""
        expiry_date = None
        if cat_name in perishable:
            lo, hi = perishable[cat_name]
            batch_number = f"B{random.randint(1000, 9999)}"
            days = forced_expiry.get(sku)
            expiry_date = datetime.today().date() + timedelta(days=days if days is not None else random.randint(lo, hi))
        p = Product(sku=sku, name=name, description=desc, category_id=cat[cat_name].id,
                    supplier_id=sup[sup_name].id, unit_price=unit, cost_price=cost,
                    quantity=qty, reorder_level=reorder, location=loc, barcode=barcode,
                    batch_number=batch_number, expiry_date=expiry_date,
                    is_active=True, created_at=days_ago(random.randint(20, 30)))
        db.add(p)
        db.commit()
        db.refresh(p)
        products.append(p)
    return products


def create_variant_demo(db, cats, suppliers):
    cat = {c.name: c for c in cats.values()}
    sup = {s.name: s for s in suppliers}
    parent = Product(
        sku="TECH-025", name="Wireless Earbuds Pro",
        description="True wireless earbuds with active noise cancelling",
        category_id=cat["Audio"].id, supplier_id=sup["PrimeData Systems"].id,
        unit_price=129.99, cost_price=72.00, quantity=0, reorder_level=10,
        location="A-03-04", barcode="490000000025", is_active=True,
        created_at=days_ago(18),
    )
    db.add(parent)
    db.commit()
    db.refresh(parent)
    variant_specs = [
        ("TECH-025-BLK", {"Color": "Black"}, 18, "490000000026"),
        ("TECH-025-WHT", {"Color": "White"}, 12, "490000000027"),
        ("TECH-025-GRN", {"Color": "Green"}, 5, "490000000028"),
    ]
    created = []
    for sku, attrs, qty, barcode in variant_specs:
        v = Product(
            sku=sku, name=parent.name, category_id=parent.category_id,
            supplier_id=parent.supplier_id, parent_id=parent.id, attributes=attrs,
            unit_price=129.99, cost_price=72.00, quantity=qty, reorder_level=5,
            location=parent.location, barcode=barcode, is_active=True,
            created_at=days_ago(18),
        )
        db.add(v)
        db.commit()
        db.refresh(v)
        created.append(v)
    db.commit()
    return [parent] + created


def create_orders(db, users, suppliers, products):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    by_sku = {p.sku: p for p in products}

    order_specs = [
        # (created_days_ago, status, supplier, notes, [(sku, qty, unit_price)])
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
    received_items = {}  # sku -> total received qty
    for created, status, sup_name, notes, items in order_specs:
        supplier = next(s for s in suppliers if s.name == sup_name)
        total = sum(q * price for _, q, price in items)
        order = Order(order_number=f"PO-{po_counter:04d}", supplier_id=supplier.id,
                      user_id=admin.id if status == "pending" else worker.id,
                      status=status, total_amount=total, notes=notes,
                      created_at=days_ago(created, hour=9))
        db.add(order)
        db.commit()
        db.refresh(order)
        for sku, qty, price in items:
            prod = by_sku[sku]
            db.add(OrderItem(order_id=order.id, product_id=prod.id, quantity=qty, unit_price=price))
            if status == "received":
                received_items[sku] = received_items.get(sku, 0) + qty
        orders.append(order)
        po_counter += 1
    db.commit()
    return orders, received_items


def create_sales(db, users, customers, products):
    worker = next(u for u in users if u.role == "worker")
    settings = db.query(Settings).first()
    tax_rate = settings.tax_rate if settings else 0.0

    pool = []
    for p in products:
        out_total = max(1, p.quantity // 10)
        remaining = out_total
        while remaining > 0:
            chunk = min(3, remaining)
            pool.append((p, chunk))
            remaining -= chunk
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
        subtotal = sum(float(p.unit_price) * qty for p, qty in group)
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
            db.add(SaleItem(sale_id=sale.id, product_id=p.id, quantity=qty, unit_price=float(p.unit_price)))
        sale_records.append({
            "invoice": invoice, "customer_name": customer.name,
            "created_at": created, "items": [(p.id, qty) for p, qty in group],
        })
        counter += 1
    db.commit()
    return sale_records


def create_stock_movements(db, users, products, orders, received_items, sale_records):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    by_sku = {p.sku: p for p in products}
    by_id = {p.id: p for p in products}
    received_orders = [o for o in orders if o.status == "received"]

    sold_total = {}
    for rec in sale_records:
        for pid, qty in rec["items"]:
            sold_total[pid] = sold_total.get(pid, 0) + qty

    # Group received order items by order for reference
    order_items_map = {}
    for o in received_orders:
        order_items_map[o.id] = db.query(OrderItem).filter(OrderItem.order_id == o.id).all()

    returns = {"TECH-002": 2, "OFF-013": 3}
    adjustments = {"BEV-016": -2, "CLN-022": 5}

    def post(product, qty, mtype, ref, notes, ts, user):
        movement = inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=qty, movement_type=mtype,
            reference=ref, notes=notes,
        )
        movement.created_at = ts

    for p in products:
        receipts = received_items.get(p.sku, 0)
        out_total = sold_total.get(p.id, 0)
        ret = returns.get(p.sku, 0)
        adj = adjustments.get(p.sku, 0)
        opening = p.quantity - receipts + out_total - ret - adj
        if opening < 0:
            opening = 0

        # Opening stock (in)
        if opening:
            post(p, opening, "in", "Initial stock", "Opening balance", days_ago(29, hour=8), admin)

        # Purchase receipts (in) tied to received orders
        for o in received_orders:
            for oi in order_items_map[o.id]:
                if oi.product_id == p.id:
                    post(p, oi.quantity, "in", f"Order {o.order_number}",
                         "Purchase receipt", o.created_at + timedelta(hours=1), worker)

    # Sales (out) tied to invoices
    for rec in sale_records:
        for pid, qty in rec["items"]:
            post(by_id[pid], -qty, "out", rec["invoice"],
                 f"Sale to {rec['customer_name']}",
                 rec["created_at"] + timedelta(minutes=random.randint(0, 30)), worker)

    # A few returns
    post(by_sku["TECH-002"], 2, "return", "RMA-1001", "Damaged unit returned by customer",
         days_ago(4, hour=15), worker)
    post(by_sku["OFF-013"], 3, "return", "RMA-1002", "Defective pens returned",
         days_ago(6, hour=11), worker)

    # A couple of adjustments
    post(by_sku["BEV-016"], -2, "adjustment", "Adjustment (damaged)",
         "Bags burst in storage", days_ago(5, hour=16), admin)
    post(by_sku["CLN-022"], 5, "adjustment", "Adjustment (recount)",
         "Cycle count correction", days_ago(3, hour=9), admin)

    db.commit()


def create_activity_logs(db, users):
    admin = next(u for u in users if u.role == "admin")
    worker = next(u for u in users if u.role == "worker")
    logs = [
        (admin, "create", "category", 1, "Created category 'Electronics'", 40),
        (admin, "create", "supplier", 1, "Created supplier 'TechSource Distribution'", 38),
        (admin, "create", "customer", 1, "Created customer 'Acme Retail Store'", 36),
        (worker, "create", "product", 1, "Created product 'Laptop Stand Pro'", 30),
        (worker, "create", "order", 1, "Created order 'PO-0001'", 28),
        (worker, "update", "order", 1, "Order 'PO-0001' status changed to 'received'", 27),
        (admin, "create", "stock_movement", 1, "in movement of 60 x 'Laptop Stand Pro'", 26),
        (worker, "create", "order", 5, "Created order 'PO-0005'", 12),
        (admin, "update", "product", 16, "Updated product 'Ground Coffee 1kg'", 8),
        (worker, "create", "order", 8, "Created order 'PO-0008'", 3),
        (admin, "delete", "order", 9, "Deleted order 'PO-0009'", 2),
        (worker, "create", "stock_movement", 3, "out movement of 4 x 'Wireless Mouse M300'", 2),
        (worker, "create", "customer", 8, "Created customer 'Bright Learning Center'", 1),
        (worker, "update", "stock_movement", 2, "Updated stock movement #2", 1),
    ]
    for user, action, entity, eid, desc, day in logs:
        db.add(ActivityLog(user_id=user.id, username=user.username, action=action,
                           entity_type=entity, entity_id=eid, description=desc,
                           created_at=days_ago(day, hour=random.randint(8, 17))))
    db.commit()


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


def create_notifications(db, users, products, sale_records):
    admin = next(u for u in users if u.role == "admin")
    workers = [u for u in users if u.role == "worker"]
    notes = []
    for p in products:
        has_variants = db.query(Product).filter(Product.parent_id == p.id).first() is not None
        if has_variants:
            continue
        if p.quantity <= p.reorder_level:
            notes.append(Notification(
                user_id=admin.id, type="warning", title=f"Low stock: {p.name}",
                message=f"Only {p.quantity} left (reorder level {p.reorder_level}).",
                link="/products", is_read=False, created_at=days_ago(random.randint(0, 3)),
            ))
    for s in sale_records[-4:]:
        notes.append(Notification(
            user_id=admin.id, type="success", title=f"New sale {s['invoice']}",
            message=s["customer_name"],
            link="/sales", is_read=False, created_at=s["created_at"],
        ))
    for w in workers:
        notes.append(Notification(
            user_id=w.id, type="info", title="Welcome to Inventura Storage",
            message="You are signed in with worker permissions.",
            link="/", is_read=False, created_at=days_ago(random.randint(1, 4)),
        ))
    db.add_all(notes)
    db.commit()
    return notes


def main():
    run_migrations()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        wipe_all(db)
        users = create_users(db)
        create_settings(db)
        cats = create_categories(db)
        suppliers = create_suppliers(db)
        customers = create_customers(db)
        products = build_products(db, cats, suppliers)
        products += create_variant_demo(db, cats, suppliers)
        orders, received_items = create_orders(db, users, suppliers, products)
        sale_records = create_sales(db, users, customers, products)
        create_stock_movements(db, users, products, orders, received_items, sale_records)
        create_activity_logs(db, users)
        create_notifications(db, users, products, sale_records)
        db.commit()

        print("=" * 60)
        print("SEED COMPLETE")
        print("=" * 60)
        print(f"  Users            : {len(users)}")
        print(f"  Categories       : {len(cats)}")
        print(f"  Suppliers        : {len(suppliers)}")
        print(f"  Customers        : {len(customers)}")
        print(f"  Products         : {len(products)}")
        print(f"  Orders           : {len(orders)}")
        print(f"  Sales            : {len(sale_records)}")
        print(f"  Stock Movements  : {db.query(StockMovement).count()}")
        print(f"  Activity Logs    : {db.query(ActivityLog).count()}")
        print(f"  Notifications    : {db.query(Notification).count()}")
        print("  Demo login       : admin / admin123")
        print("                   : michael / worker123")
        print("                   : sarah   / worker123")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
