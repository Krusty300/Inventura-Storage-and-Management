from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "worker"


class ProfileUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    permissions: list[str] | None = None
    is_active: bool = True
    is_approved: bool = False
    avatar_url: str = ""
    last_login_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class SessionOut(BaseModel):
    id: int
    ip_address: str
    user_agent: str
    created_at: datetime
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    is_current: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False
