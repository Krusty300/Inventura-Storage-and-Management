from datetime import datetime
from typing import Optional

import re

from pydantic import BaseModel, field_validator


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "worker"

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email format")
        return v.lower()

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        allowed = {"admin", "manager", "worker"}
        if v not in allowed:
            raise ValueError(f"Role must be one of: {', '.join(sorted(allowed))}")
        return v


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
    supplier_id: int | None = None
    supplier_name: str = ""
    supplier_image_url: str = ""
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
