import os

# CI has no backend/.env: supply a valid secret before any app module imports
# Settings (which rejects the placeholder default at construction time).
os.environ.setdefault("SECRET_KEY", "a" * 64)
os.environ.setdefault("DARAJA_MOCK", "true")
os.environ.pop("DARAJA_CALLBACK_SECRET", None)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.models.user import User
from app.services.auth import hash_password


# One in-memory SQLite shared by every session in this process (StaticPool keeps
# a single connection alive so the database survives between requests). Each
# pytest-xdist worker gets its own engine/DB, so tests can run in parallel.
SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, poolclass=StaticPool, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limit():
    from app.services import ratelimit
    ratelimit.reset()
    yield


@pytest.fixture(autouse=True)
def default_location(setup_db):
    from app.models.location import Location
    db = TestingSessionLocal()
    loc = Location(name="Default Location", code="DFT-0")
    db.add(loc)
    db.commit()
    loc_id = loc.id
    db.close()
    return loc_id


app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)


def create_test_user(username: str, email: str, password: str, role: str = "worker", approved: bool = True) -> User:
    """Create a user directly in the DB for testing, bypassing registration."""
    db = TestingSessionLocal()
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=role,
        is_approved=approved,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user


@pytest.fixture
def test_client():
    return client


@pytest.fixture
def auth_headers(test_client):
    create_test_user("testuser", "test@example.com", "testpass123", "admin")
    resp = test_client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "testpass123",
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
