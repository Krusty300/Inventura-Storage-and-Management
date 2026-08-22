from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.session import UserSession
from app.models.user import User
from app.services.permissions import permissions_for_user

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

LAST_SEEN_REFRESH_SECONDS = 300


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_minutes: int | None = None, jti: str | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes or settings.access_token_expire_minutes)
    to_encode.update({"exp": expire, "jti": jti or uuid4().hex})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(user_id_str)
        jti = payload.get("jti")
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token")
    session = None
    if jti:
        session = db.query(UserSession).filter(UserSession.jti == jti).first()
        if session is None or session.revoked_at is not None:
            raise HTTPException(status_code=401, detail="Session has been revoked. Please log in again.")
        if session.user_id != user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        now = datetime.now(timezone.utc)
        if session.last_seen_at is None or (now - session.last_seen_at).total_seconds() > LAST_SEEN_REFRESH_SECONDS:
            session.last_seen_at = now
            db.commit()
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_permission(permission: str):
    """Dependency factory: require the current user's effective permissions to
    grant `permission` (role defaults, or the account's custom allowlist)."""

    def checker(current_user: User = Depends(get_current_user)) -> User:
        if permission not in permissions_for_user(current_user):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user

    return checker
