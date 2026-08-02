from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.user import LoginRequest, Token, UserCreate, UserOut
from app.services.auth import create_access_token, get_current_user, hash_password, verify_password
from app.services.password_policy import validate_password
from app.services import ratelimit

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=Token)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    message = ratelimit.lockout_message(req.username, ip)
    if message:
        raise HTTPException(status_code=429, detail=message)
    user = db.query(User).filter(User.username == req.username, User.is_active == True).first()
    if not user or not verify_password(req.password, user.password_hash):
        ratelimit.record_failure(req.username, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    ratelimit.clear_failures(req.username, ip)
    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.post("/register", response_model=Token)
def register(req: UserCreate, db: Session = Depends(get_db)):
    password_error = validate_password(req.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if db.query(User).filter((User.username == req.username) | (User.email == req.email)).first():
        raise HTTPException(status_code=400, detail="Username or email already exists")
    if db.query(User).count() > 0:
        raise HTTPException(status_code=403, detail="Registration is disabled. Contact an administrator.")
    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role="admin",
        last_login_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
