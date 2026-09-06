from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

from app.config import settings as app_settings
from app.database import Base, SessionLocal, backfill_stock_lines, engine, run_migrations
from app.logging_config import setup_logging
from app.middleware import RequestIDMiddleware
from app.services.httpratelimit import limiter, rate_limit_exceeded_handler
from app.routers import activity_log, asn, attachments, auth, bom, categories, costing, cycle_counts, customers, customer_groups, daraja, dashboard, forecasting, kit, labels, locations, lots, lpns, notes, notifications, orders, planning, price_lists, products, promotions, quality_checks, receipts, reports, sales, sales_channels, search, serial_numbers, settings, shipments, stock, suppliers, users, work_orders
from app.services.inventory import expire_overdue_lots
from app.services.auth import purge_expired_sessions
from app.ws_manager import manager


def _decode_ws_token(token: str) -> dict | None:
    """Try all valid keys to decode a WebSocket token. Returns payload or None."""
    for key in app_settings.all_valid_keys:
        try:
            return jwt.decode(token, key, algorithms=[app_settings.algorithm])
        except (JWTError, ValueError, TypeError):
            continue
    return None

setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_output=os.getenv("LOG_JSON", "false").lower() in ("1", "true", "yes"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    Base.metadata.create_all(bind=engine)
    backfill_stock_lines()
    manager.init(asyncio.get_running_loop())
    db = SessionLocal()
    try:
        expire_overdue_lots(db)
        purge_expired_sessions(db)
        db.commit()
    finally:
        db.close()
    yield


app = FastAPI(title="Inventory Management System", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(429, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestIDMiddleware)

app.include_router(activity_log.router)
app.include_router(attachments.router)
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(reports.router)
app.include_router(categories.router)
app.include_router(customers.router)
app.include_router(customer_groups.router)
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
app.include_router(sales_channels.router)
app.include_router(notifications.router)
app.include_router(bom.router)
app.include_router(kit.router)
app.include_router(work_orders.router)
app.include_router(quality_checks.router)
app.include_router(planning.router)
app.include_router(forecasting.router)
app.include_router(costing.router)
app.include_router(shipments.router)
app.include_router(daraja.router)
app.include_router(search.router)
app.include_router(notes.router)
app.include_router(price_lists.router)
app.include_router(promotions.router)

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query("")):
    if not token:
        await ws.close(code=4001, reason="Authentication required")
        return
    payload = _decode_ws_token(token)
    if payload is None:
        await ws.close(code=4001, reason="Invalid token")
        return
    user_id = payload.get("sub")
    jti = payload.get("jti")
    if user_id is None:
        await ws.close(code=4001, reason="Invalid token")
        return
    if jti:
        from app.database import SessionLocal
        from app.models.session import UserSession
        from sqlalchemy import select
        db = SessionLocal()
        try:
            session = db.execute(
                select(UserSession).where(UserSession.jti == jti)
            ).scalars().first()
            if session is None or session.revoked_at is not None:
                await ws.close(code=4001, reason="Session revoked")
                return
            if session.user_id != int(user_id):
                await ws.close(code=4001, reason="Invalid token")
                return
        finally:
            db.close()
    await manager.connect(ws, user_id=int(user_id))
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await ws.send_json({"event": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)


@app.get("/api/health")
def health():
    return {"status": "ok"}
