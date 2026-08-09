# Inventory Management System

A full-stack warehouse and inventory management application covering products (with variants), purchase orders, sales, stock movements, receipts, shipments, work orders, BOMs, costed manufacturing, serial/lot tracking, quarantine management, cycle counts, ASNs, LPNs, quality checks, MRP planning, demand forecasting, reporting, and real-time WebSocket updates.

- **Backend:** Python 3.11+ / FastAPI / SQLAlchemy 2.0 / SQLite (`backend/`)
- **Frontend:** React 19 / TypeScript / Vite 8 / Tailwind CSS 4 / React Query (`frontend/`)
- **Tests:** pytest (629 backend), Vitest + Testing Library (283 frontend)

---

## Table of contents

- [Quick start](#quick-start)
- [Real-world use cases](#real-world-use-cases)
- [Manual setup](#manual-setup)
- [Environment](#environment)
- [Seeding demo data](#seeding-demo-data)
- [Running tests](#running-tests)
- [Architecture](#architecture)
- [Features](#features)
- [Data model overview](#data-model-overview)
- [API overview](#api-overview)
- [Frontend pages](#frontend-pages)
- [Roles and permissions](#roles-and-permissions)
- [Design conventions](#design-conventions)

---

## Quick start

The included `start.ps1` boots both servers (and kills any leftover processes on the ports first):

```powershell
.\start.ps1
```

| Service  | URL                                |
| -------- | ---------------------------------- |
| Frontend | http://localhost:5173               |
| API      | http://localhost:8000/api           |
| API docs | http://localhost:8000/docs          |

---

## Real-world use cases

This system is designed for small and mid-sized operations that need warehouse
accuracy without a heavyweight ERP. A few concrete ways teams use it:

### Food & beverage distribution (perishables)
- Each production run or supplier delivery becomes a **lot** with an expiry date.
- **FEFO allocation** sells the soonest-expiring stock first, so nothing sits
  past its date while newer stock sells.
- Automatic **expiring-soon notifications** and an **exceptions report** flag
  lots approaching their expiry.
- Expired lots are automatically quarantined and excluded from sellable on-hand,
  and a red **Expired** badge appears beside the product name on the product
  detail view.
- **Cycle counts** per aisle/bin keep physical vs. system quantities in line.

### Medical devices & electronics (serial traceability)
- **Serialized products** track every individual unit through
  `in_stock` → `reserved` → `sold` (and `quarantined` / `scrapped`).
- Receiving registers serials; shipping marks them sold; refunds restore them.
- **Lot genealogy + recall mode** walks parent/child lot links so a bad raw
  material lot lists every finished good that consumed it, downstream —
  exactly what a recall letter needs.
- Serial status breakdown is available in the WMS stock reports.

### Small-batch manufacturing (make-to-order)
- **BOMs** define component requirements per finished good (variants can have
  their own BOM).
- **Work orders** flow planned → released → in_progress → completed; issuing
  components backflushes stock automatically and links component lots to the
  finished-goods lot.
- Serialized manufacturing registers serial numbers on completion.
- The **costing report** compares standard vs. actual unit cost per work order,
  and **MRP planning** shows component readiness before a run starts.

### Multi-location warehouse (transfers & LPNs)
- Stock lives in a hierarchical location tree (Zone / Aisle / Bin).
- **Transfers** move stock between locations; **LPNs** group pallets under a
  scannable label and move as a unit.
- Unallocated stock (received without a location) is moved via the product
  detail's **Move Unallocated** action.
- When adjusting stock on the Products page, the modal **auto-detects the
  location** that already holds the product's stock and preselects it.

### Quality control (QC → quarantine → release)
- Receiving a suspect batch? Create a **quality check**; a failed check
  quarantines the lot, removing it from sellable on-hand and sales allocation.
- Move stock into a **quarantine-typed location** (e.g. a "Quarantine Area")
  and the system auto-quarantines the lot/serials on arrival — no manual step.
- Use the **Quarantine** quick action on the location or product detail, then
  inspect and **Release** the lot from anywhere once it passes; stock becomes
  sellable again.

### Retail / e-commerce fulfilment
- Restock via **purchase orders** or **ASNs** (Advanced Shipping Notices) and
  **auto-reorder** anything below its reorder level.
- Sell through **sales** (PDF invoices, source-location tracking per line) or
  run the **shipment** flow: draft → pick → pack → ship → Create Invoice.
- **WebSocket updates** keep every open screen current as stock changes land.

### Audit & compliance
- **RBAC** separates admin and worker capabilities; **activity logging** records
  every create/update/delete with user and detail.
- Password changes and admin resets **revoke all active sessions** immediately.

---

## Manual setup

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # set a real SECRET_KEY
python -m uvicorn app.main:app --reload --port 8000
```

The database (`inventory.db`) is created automatically on startup. Schema migrations
run via `run_migrations()` in `app/database.py` (ALTERs for new columns, idempotent).

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api`, `/uploads`, and `/ws` to `http://localhost:8000`, so no CORS
configuration is needed in development.

## Environment

Backend config lives in `backend/.env` (loaded by `app/config.py` via pydantic-settings):

```
SECRET_KEY=change-this-to-a-secure-random-key
DATABASE_URL=sqlite:///./inventory.db
```

| Variable      | Default                        | Description                       |
| ------------- | ------------------------------ | --------------------------------- |
| `SECRET_KEY`  | *(must be set)*                | JWT signing key; 32+ characters    |
| `DATABASE_URL`| `sqlite:///./inventory.db`     | SQLAlchemy connection string       |

The app refuses to start with the placeholder `SECRET_KEY`.

## Seeding demo data

```powershell
cd backend
python seed.py
```

Wipes and repopulates the database with realistic demo data: 4 users, products with
variants and BOMs, 40+ stock lines across multiple locations and lots, ASNs with
ASN items and receipts, purchase orders (including a received serialized order),
sales, work orders (with component lot allocations and serialized manufacturing),
shipments (with pick/pack/ship flow and a shipment-linked sale/invoice), and
quality checks (including checks tied to locations).

| Username  | Password    | Role   |
| --------- | ----------- | ------ |
| `admin`   | `admin123`  | admin  |
| `michael` | `worker123` | worker |
| `sarah`   | `worker123` | worker |

New self-registered accounts are always `worker`; only an existing admin can
promote users.

## Running tests

```powershell
# Backend (from backend/)
python -m pytest -q

# Frontend (from frontend/)
npm test          # vitest run
npx tsc --noEmit  # type-check
```

---

## Architecture

```
inventory-app/
  backend/
    app/
      main.py              # FastAPI app, lifespan, WebSocket, router registration
      config.py            # pydantic-settings (SECRET_KEY, DATABASE_URL)
      database.py          # SQLAlchemy engine, session, run_migrations(), Base
      models/              # 27 SQLAlchemy 2.0 mapped model files
      routers/             # 30 APIRouters under /api/*
      schemas/             # Pydantic request/response models
      services/
        auth.py            # JWT creation, password hashing, get_current_user
        inventory.py       # Single-writer inventory ledger (post_journal_entry, allocate_lots, transfer_stock)
        permissions.py     # Code-driven RBAC (admin / worker)
        costing.py         # Work-order cost rollup
        notify.py          # Low-stock / expiry / QC notifications
        sequences.py       # next_document_number() for RCP-, ORD-, INV-, etc.
        order_service.py   # Purchase order receiving logic
        pdf_helpers.py     # ReportLab invoice / label generation
        password_policy.py # Enforced password complexity
        ratelimit.py       # Login rate-limiting
      ws_manager.py        # WebSocket broadcast manager
    tests/                 # 44 test files, 629 tests
    seed.py                # Wipes + repopulates demo data
  frontend/
    src/
      pages/               # 29 page components (one per route)
      components/          # 41 shared components
      context/             # AuthContext, ToastContext
      hooks/               # useSettings, useDebounce, useSelectableProducts
      utils/               # permissions, currency, date, csv, download, variants
      api/client.ts        # Axios instance with auth interceptor
      types/index.ts       # Shared TypeScript interfaces
    __tests__/             # 39 test files, 283 tests
```

### Inventory ledger

All stock changes flow through a single writer: `inventory.post_journal_entry()`.
This keeps `stock_lines` balances, `serial_number` statuses, and
`product.quantity` (a parity cache) consistent. Callers: receipts, sales,
transfers, shipment shipping, work-order backflushing, cycle-count adjustments,
product create/update, and ASNs.

### Auto-migration

`run_migrations()` in `app/database.py` runs idempotent ALTER TABLE statements
on startup for columns added after initial table creation (e.g. `shipments.sale_id`).
The rest of the schema is managed by `Base.metadata.create_all()`.

---

## Features

### Products & variants

- Full product CRUD with SKU, barcode, category, supplier, cost/price, expiry,
  reorder level, and location.
- **Product variants:** self-referencing `parent_id` with a free-form JSON
  `attributes` map (e.g. `{"Color": "Red", "Size": "M"}`).
  - Parent with active variants holds no stock; `total_quantity` is the sum of
    active variants.
  - Creating the first variant carries over the parent's stock (across all its
    stock lines, preserving lot/location/LPN identity).
  - Duplicate attribute combinations under the same parent are rejected.
  - Deactivating all variants releases the parent to sellable/orderable again.
- **Serialized products:** individual serial-number tracking (in_stock / reserved /
  sold / quarantined / scrapped). Serialized products cannot have opening quantity;
  stock is received via receipts or ASN receiving.
- CSV import/export (supports `parent_sku` + `attributes` for bulk variant creation).
- Barcode labels (python-barcode) and barcode lookup.
- Bulk edit modal, low-stock filter, search by name/SKU/barcode.

### Inventory & stock

- **Stock lines:** location-aware balance per product (with optional lot/LPN
  identity). Quarantined lots are tracked and excluded from sellable on-hand.
- **Stock movements:** full journal of every stock change with type, quantity,
  from/to location, lot, serial, LPN, and reference.
- **Transfers:** move stock between locations via matched TRANSFER_OUT /
  TRANSFER_IN pairs. Moving stock into a **quarantine-typed location**
  (e.g. "Quarantine Area") auto-quarantines the lot/serials on arrival.
- **Quarantine move:** `POST /api/stock-movements/quarantine` quarantines
  stock directly (QAR-xxxx references), with per-lot/per-serial handling.
- **Cycle counts:** create counts per location, record actual quantities, post
  variance adjustments (positive or negative), with audit trail.
- **LPNs (License Plate Numbers):** group stock lines under a scannable label;
  move LPNs between locations.
- **Locations:** hierarchical warehouse structure (Zone / Aisle / Bin) with
  stock/LPN summaries and search.

### Lots & genealogy

- **Lots:** batch tracking with lot number, status (`in_stock` / `quarantined` /
  `expired` / `sold`), and expiry date. `sold` is derived automatically when a
  serialized lot is fully shipped and reverted on refund.
- **Quarantine flow:** lots can be quarantined by a failed quality check, by
  moving stock into a **quarantine-typed location** (auto-quarantine on
  arrival), or via the dedicated quarantine move. Quarantined lots are excluded
  from sellable on-hand and sales allocation, and can be released back to
  sellable stock from the product or location detail view.
- **Lot links (genealogy):** parent-to-child lot relationships. When a work order
  completes, component lots are linked to the finished-goods lot. Full genealogy
  tree view available per work order. Recall mode traces all descendants of any
  lot number.

### Purchasing

- **Purchase orders (ORD-xxxx):** line-item CRUD, status workflow
  pending -> received / cancelled. Receiving adds stock and logs movements.
  Serialized items require serial-number entry on receive.
- **Auto-reorder:** scans all products below `reorder_level` and generates POs
  to the default supplier.
- **ASNs (Advanced Shipping Notices):** supplier shipment tracking with expected
  arrival, carrier, and item-level quantities. Receiving an ASN creates a
  receipt, adds stock, and logs movements.
- **Receipt form auto-fill:** picking a supplier filters the product list and
  auto-fills a single product plus its cost; selecting a location populates an
  LPN datalist and auto-selects a single LPN.
- PDF invoice generation for purchase orders.

### Sales

- **Sales (INV-xxxx):** create sales with line items, customer, payment method,
  tax. Completing a sale decrements stock (FEFO allocation) and marks serials
  as sold.
- **Refunds:** restore stock and mark serials as in-stock again.
- **Source locations:** each sale surfaces the stock location(s) each line item
  was fulfilled from (derived from the "out" movements), shown on the list,
  detail view, and invoice.
- **Shipment linkage:** a sale can be linked to a shipment (`Shipment.sale_id`).
  Create Invoice from the shipment detail creates a sale.
- PDF invoice generation.

### Manufacturing (Phase 3)

- **BOMs (Bill of Materials):** define component requirements for finished
  products. Variant products can have their own BOM.
- **Work orders (WO-xxxx):** planned -> released -> in_progress -> completed.
  Issue components (auto-backflush on complete), release, and complete flow.
  Serialized manufacturing registers serial numbers on completion.
- **Lot genealogy:** each completed work order links component lots to the
  finished-goods lot via `LotLink`.
- **Costing report:** per-work-order material cost, standard vs. actual unit
  cost, and variance analysis.
- **MRP Planning page:** shows product demand, supply, BOM readiness, work-order
  status, and stock health in one view.

### Quality control

- **Quality checks (QC-xxxx):** create checks per product/lot/work order with
  result (pending / pass / fail) and an optional **stock location** scope.
  Dashboard shows pending and failed QC count.
- **Quarantine management:** failing a check quarantines its lot; quarantined
  lots are excluded from sellable on-hand and blocked from sales allocation.
  Dashboard tracks quarantined units. Quarantined and expired lots show badges
  on the product detail view.
- **Quarantine-typed locations:** mark a location (e.g. "Quarantine Area") with
  `location_type=quarantine`; transferring stock into it auto-quarantines the
  lot/serials on arrival. A dedicated `POST /api/stock-movements/quarantine`
  move is also available, and **Quarantine / Release** quick actions sit on the
  location and product detail views. Release works from anywhere and makes the
  lot sellable again.
- **Location awareness:** QCs can be scoped to a specific location, and the
  Quality Checks page/detail view show the related location.

### Shipments (Phase 3, M5)

- **Shipments (SHP-xxxx):** draft -> picking -> packed -> shipped / cancelled.
  Full pick/pack/ship workflow with per-item quantities.
- **Pick flow:** view items, pick quantities up to ordered.
- **Pack flow:** pack picked items.
- **Ship flow:** confirm shipment, mark serials as sold, log movements.
- **Cancel:** cancel draft/picking/packed shipments.
- **Create Invoice:** link to a sale (or create one inline), generate invoice
  number and PDF.

### Dashboard

- Sectioned stat cards: Inventory, Fulfillment, Manufacturing, Business.
- Stockout risk indicators, movement trends, inventory value by category.
- Panels: recent movements, low stock alerts, expiring products, recent sales,
  pending ASNs, open cycle counts, shipments to process, open work orders,
  pending quality checks, manufacturing cost summary.
- Quick Actions (permission-gated): Record Receipt, New ASN, New Order,
  New Sale, Create Shipment, Release Work Order, New Cycle Count, New QC.
- Role-aware greeting, auto-refresh toggle, PDF export.

### Reports

- Inventory valuation (by category, by supplier).
- Stock movement trends (7 / 30 / 90 day windows).
- Sales summary, top products, top customers, top suppliers.
- Profit analysis (cost vs. potential revenue).
- Stockout risk, exceptions report (low stock, zero stock, quarantined lots,
  open cycle counts, pending ASNs).
- WMS stock reports (stock by location, by lot, serial status breakdown).

### Notifications

- Automatic low-stock and expiring-soon notifications generated on stock changes
  and product updates.
- Notification bell in the header with unread count.
- Permission-gated viewing.

### Activity log

- Every create / update / delete is logged with user, entity, action, and detail.
- Filterable by entity type and action. Paginated.

### User management

- Register, login (JWT, 8-hour expiry), role management.
- Admin-only: promote/demote, deactivate, reset password, delete users.
- Password policy enforcement (minimum length, complexity).

### Settings

- Store name, currency symbol, tax rate, low-stock threshold.
- Admin-only store settings section.

---

## Data model overview

34 SQLAlchemy 2.0 mapped tables in `backend/app/models/`:

| Model                | Description                                      |
| -------------------- | ------------------------------------------------ |
| Product              | SKUs, variants, serialization, cost/price, expiry |
| StockLine            | Per-product balance at a location (lot/LPN aware) |
| StockMovement        | Immutable journal of every stock change           |
| SerialNumber         | Individual serialized unit tracking               |
| Lot                  | Batch tracking (in_stock / quarantined / expired / sold) |
| LotLink              | Parent-child lot genealogy relationships          |
| Location             | Hierarchical warehouse zones/bins                |
| LPN                  | License plate numbers grouping stock lines        |
| Category / Supplier  | Product classification and sourcing               |
| Customer             | Sales customers                                  |
| Order / OrderItem    | Purchase order lines and receiving                |
| Sale / SaleItem      | Sales invoice lines and refunds                   |
| Receipt / ReceiptItem| Goods-received records (from POs or standalone)   |
| ASN / ASNItem        | Advanced shipping notices from suppliers          |
| Shipment / ShipmentItem | Outbound shipments with pick/pack/ship flow    |
| WorkOrder / WorkOrderItem | Manufacturing orders with component issue    |
| BOM / BOMItem        | Bill of materials and component definitions       |
| QualityCheck         | QC inspections per product/lot/work order          |
| CycleCount / CycleCountItem | Warehouse cycle count sessions and lines  |
| User                 | Accounts with role (admin / worker)               |
| UserSession          | Login session tracking / revocation                |
| Notification         | System-generated alerts (low stock, expiry, QC)   |
| ActivityLog          | Audit trail for all mutations                     |
| DocumentSequence     | Auto-incrementing document number generators      |
| Settings             | Global store configuration                        |

---

## API overview

All endpoints are under `/api/`. 30 routers in `backend/app/routers/`:

| Router           | Prefix             | Key endpoints                                        |
| ---------------- | ------------------ | ---------------------------------------------------- |
| `auth`           | `/api/auth`        | login, register                                      |
| `users`          | `/api/users`       | CRUD, role change, password reset, deactivate         |
| `products`       | `/api/products`    | CRUD, CSV import/export, barcode, low-stock filter    |
| `categories`     | `/api/categories`  | CRUD                                                 |
| `customers`      | `/api/customers`   | CRUD, CSV import                                     |
| `suppliers`      | `/api/suppliers`   | CRUD, CSV import                                     |
| `locations`      | `/api/locations`   | CRUD, tree, detail (stock + LPN summary)              |
| `stock-movements`| `/api/stock-movements` | Movement list, transfers, quarantine, adjustments |
| `search`         | `/api/search`      | Global search across entities                         |
| `receipts`       | `/api/receipts`    | Create receipts (standalone or from PO)               |
| `orders`         | `/api/orders`      | Purchase orders, receive, auto-reorder, PDF           |
| `sales`          | `/api/sales`       | Sales CRUD, stats, refund, PDF                        |
| `shipments`      | `/api/shipments`   | Shipments CRUD, pick, pack, ship, cancel, create-sale |
| `lots`           | `/api/lots`        | Lot list, update status (release), genealogy          |
| `serial-numbers` | `/api/serial-numbers` | Serial list, status, location history              |
| `lpns`           | `/api/lpns`        | LPN CRUD, move between locations                      |
| `asn`            | `/api/asns`        | ASN CRUD, receive (creates receipt + stock)           |
| `cycle-counts`   | `/api/cycle-counts`| Cycle count sessions and line updates                 |
| `bom`            | `/api/boms`        | BOM CRUD with component items                         |
| `work-orders`    | `/api/work-orders` | WO CRUD, release, issue, complete (backflush/serials) |
| `quality-checks` | `/api/quality-checks` | QC CRUD                                           |
| `planning`       | `/api/planning`    | MRP planning data (demand, supply, readiness)         |
| `forecasting`    | `/api/forecasting` | Replenishment recommendations, product forecasts      |
| `costing`        | `/api/costing`     | Manufacturing cost report (per work order)            |
| `dashboard`      | `/api/dashboard`   | Aggregated stats (cards + to-process lists)           |
| `reports`        | `/api/reports`     | Valuation, trends, sales, profit, exceptions, PDF     |
| `notifications`  | `/api/notifications` | User notifications, unread count                   |
| `activity-log`   | `/api/activity-log`| Audit trail with entity/action filters                |
| `settings`       | `/api/settings`    | Global store config                                   |
| `labels`         | `/api/labels`      | Barcode and location label generation                 |

### WebSocket

`ws://localhost:8000/ws` broadcasts real-time change events (product, stock_movement,
order, sale) to all connected clients.

---

## Frontend pages

29 pages in `frontend/src/pages/`:

| Page             | Route               | Description                                   |
| ---------------- | ------------------- | --------------------------------------------- |
| Dashboard        | `/`                 | Sectioned stats, panels, quick actions         |
| Products         | `/products`         | List with variants, CSV import, low-stock     |
| Categories       | `/categories`       | Category CRUD                                 |
| Customers        | `/customers`        | Customer CRUD, CSV import                     |
| Suppliers        | `/suppliers`        | Supplier CRUD, analytics                      |
| Locations        | `/locations`        | Hierarchical tree with search, stock/LPN view |
| Stock Movements  | `/stock-movements`  | Movement journal with filters                 |
| Receipts         | `/receiving`        | Goods-received records                        |
| Lots             | `/lots`             | Lot tracking, quarantine/expiry, genealogy    |
| Serial Numbers   | `/serial-numbers`   | Individual serialized unit tracking           |
| ASNs             | `/asns`             | Advanced shipping notices and receiving       |
| LPNs             | `/lpns`             | License plate numbers and moves               |
| Cycle Counts     | `/cycle-counts`     | Count sessions and variance posting           |
| Purchase Orders  | `/orders`           | Order list with auto-reorder                  |
| Sales            | `/sales`            | Sales list, refund, PDF                       |
| Shipments        | `/shipments`        | Pick / pack / ship workflow                   |
| BOMs             | `/boms`             | Bill of materials management                  |
| Work Orders      | `/work-orders`      | Manufacturing orders                          |
| Quality Checks   | `/quality-checks`   | QC inspections                                |
| Planning         | `/planning`         | MRP dashboard                                 |
| Forecasting      | `/forecasting`      | Replenishment / demand forecasts              |
| Reports          | `/reports`          | Valuation, trends, profit, exceptions         |
| Exceptions       | `/exceptions`       | Low stock, zero stock, quarantined, pending   |
| Users            | `/users`            | User management (admin)                       |
| Settings         | `/settings`         | Store configuration                           |
| Activity Log     | `/activity-log`     | Audit trail                                   |
| Login / Register | `/login`, `/register` | Authentication                             |
| Profile          | `/profile`           | Current user's profile and preferences       |

41 shared components in `frontend/src/components/` including forms, detail views,
modals, pagination, barcode scanner, location picker, CSV import, skeleton, and
error boundary.

---

## Roles and permissions

Two roles with code-driven fine-grained permissions (backend: `services/permissions.py`,
frontend: `utils/permissions.ts`):

| Capability                        | admin | worker |
| --------------------------------- | :---: | :----: |
| Full CRUD (products, orders, etc) | yes   | --     |
| Product import / bulk edit        | yes   | --     |
| Create purchase orders            | yes   | yes    |
| Receive POs / ASNs                | yes   | --     |
| Create sales                      | yes   | yes    |
| Pick / ship shipments             | yes   | yes    |
| Release / complete work orders    | yes   | yes    |
| Create quality checks             | yes   | yes    |
| View planning                     | yes   | yes    |
| Manage users, locations, settings | yes   | --     |
| Create cycle counts               | yes   | --     |
| Manage BOMs, LPNs, receipts       | yes   | --     |

Workers also cannot: create/create-shipment, create-ASN, delete shipments, or
modify cycle counts.

---

## Design conventions

- **Variant products** are the shippable/sellable unit. Creating a parent product
  with active variants is rejected.
- **Inventory changes** always flow through `post_journal_entry()` — the single
  writer that keeps stock lines, serial statuses, and product.quantity consistent.
- **Document numbers** (RCP-, ORD-, INV-, SHP-, WO-, QC-, CC-, ASN-) use
  `next_document_number()` with an auto-incrementing `DocumentSequence` table.
  Missing invoice numbers are acceptable (gaps documented).
- **FEFO allocation** (First Expiry, First Out) for both lot and serial allocation.
- **Shipment statuses:** `draft` / `picking` / `packed` / `shipped` / `cancelled`.
- **Work order statuses:** `planned` / `released` / `in_progress` / `completed` /
  `cancelled`.
- **QC results:** `pending` / `pass` / `fail`.
- **Lot statuses:** `in_stock` / `quarantined` / `expired` / `sold`.
- **Serial statuses:** `in_stock` / `reserved` / `sold` / `quarantined` / `scrapped`.
- **Movement types:** `receive`, `in`, `out`, `transfer_out`, `transfer_in`,
  `sale`, `sale_return`, `issue`, `backflush`, `adjustment`, `count`, `ship`,
  `return`, `activate`, `deactivate`, `scrap`.
