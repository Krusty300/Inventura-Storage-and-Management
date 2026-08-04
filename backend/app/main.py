import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import Base, backfill_stock_lines, engine, run_migrations
from app.routers import activity_log, asn, auth, bom, categories, costing, cycle_counts, customers, dashboard, labels, locations, lots, lpns, notifications, orders, planning, products, quality_checks, receipts, reports, sales, serial_numbers, settings, shipments, stock, suppliers, users, work_orders
from app.ws_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    Base.metadata.create_all(bind=engine)
    backfill_stock_lines()
    manager.init(asyncio.get_running_loop())
    yield


app = FastAPI(title="Inventory Management System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(activity_log.router)
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(reports.router)
app.include_router(categories.router)
app.include_router(customers.router)
app.include_router(suppliers.router)
app.include_router(stock.router)
app.include_router(receipts.router)
app.include_router(lots.router)
app.include_router(serial_numbers.router)
app.include_router(locations.router)
app.include_router(asn.router)
app.include_router(labels.router)
app.include_router(lpns.router)
app.include_router(cycle_counts.router)
app.include_router(orders.router)
app.include_router(dashboard.router)
app.include_router(users.router)
app.include_router(settings.router)
app.include_router(sales.router)
app.include_router(notifications.router)
app.include_router(bom.router)
app.include_router(work_orders.router)
app.include_router(quality_checks.router)
app.include_router(planning.router)
app.include_router(costing.router)
app.include_router(shipments.router)

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/api/health")
def health():
    return {"status": "ok"}
