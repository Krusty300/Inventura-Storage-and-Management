# Inventory Management System

A full-stack inventory management app with products (including product variants),
sales, purchase orders, stock movements, customers, suppliers, notifications, and
reports.

- **Backend:** FastAPI + SQLAlchemy 2.0 + SQLite (`backend/`)
- **Frontend:** React 19 + TypeScript + Vite + React Query + Tailwind (`frontend/`)
- **Testing:** pytest (backend), Vitest + Testing Library (frontend)

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- npm

## Quick start (Windows)

The included `start.ps1` boots both servers (and stops any leftover processes on
the ports first):

```powershell
.\start.ps1
```

| Service    | URL                                |
| ---------- | ---------------------------------- |
| Frontend   | http://localhost:5173              |
| API        | http://localhost:8000/api          |
| API docs   | http://localhost:8000/docs         |

## Manual setup

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then set a SECRET_KEY
python -m uvicorn app.main:app --reload --port 8000
```

The database (`inventory.db`) is created automatically and any schema migrations
run on startup via `run_migrations()` in `app/database.py`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api`, `/uploads`, and `/ws` to `http://localhost:8000`, so no
CORS configuration is needed in development.

### Seeding demo data

```powershell
cd backend
python seed.py
```

This wipes and repopulates the DB with realistic demo data.

| Username | Password   | Role   |
| -------- | ---------- | ------ |
| `admin`  | `admin123` | admin  |
| `michael`| `worker123`| worker |
| `sarah`  | `worker123`| worker |

> Note: new self-registered accounts are always created as `worker`; only an
> existing admin can promote users.

## Environment

Backend config lives in `backend/.env` (see `backend/app/config.py`):

```
SECRET_KEY=change-this-to-a-secure-random-key-in-production
DATABASE_URL=sqlite:///./inventory.db   # optional override
```

The app refuses to boot with the placeholder `SECRET_KEY` — set a real one.

## Running tests

```powershell
# Backend (from backend/)
python -m pytest -q

# Frontend (from frontend/)
npm test          # vitest run
npx tsc --noEmit  # typecheck
```

## Product variants

A product can have variants. Variants are modeled as self-referencing product
rows (`parent_id`):

- A **parent with active variants holds no stock** — all stock lives on the
  variants, and the parent's `total_quantity` is the sum of its *active*
  variants.
- Creating the **first variant transfers the parent's existing stock** onto the
  variant (and logs an "initial stock" movement).
- Sales, purchase orders, and stock movements must reference a **specific
  variant**, never a parent that has active variants.
- Variants are defined by a free-form JSON `attributes` map (e.g.
  `{"Color": "Red", "Size": "M"}`). Duplicate attribute combinations under the
  same parent are rejected.
- Deactivating every variant releases the parent (it becomes sellable/orderable
  again) and excludes those variants from totals, low-stock, and reports.
- CSV import supports `parent_sku` + `attributes` columns to create variants in
  bulk.

## Purchase order statuses

`pending` → `received` | `cancelled`. Only `pending` orders can have their items
edited, and `received` orders cannot be deleted (stock was already added).
Receiving an order adds the ordered quantities to stock and logs movements.

## API overview

Routers live in `backend/app/routers/`:

- `auth`, `users` — auth, user management, password change
- `products` — CRUD, CSV import/export, barcode labels/lookup, low-stock filter
- `sales` — CRUD + refunds (restores stock), PDF invoices
- `orders` — purchase orders, auto-reorder, receiving, PDFs
- `stock` — stock movements and adjustments
- `customers`, `suppliers`, `categories`
- `dashboard`, `reports` — stats, trends, valuation, profit analysis, CSV exports
- `notifications`, `activity_log`, `settings`
