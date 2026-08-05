import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_inventory.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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


@pytest.fixture
def test_client():
    return client


@pytest.fixture
def auth_headers(test_client):
    test_client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "testpass123",
    })
    db = TestingSessionLocal()
    db.query(User).filter(User.username == "testuser").update({"role": "admin"})
    db.commit()
    db.close()
    resp = test_client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "testpass123",
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
