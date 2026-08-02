from math import ceil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut
from app.services.auth import get_current_user, require_permission, hash_password, verify_password
from app.services.password_policy import validate_password
from app.utils import log_activity

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {"admin", "worker"}


class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None


class UserCreateAdmin(BaseModel):
    username: str
    email: str
    password: str
    role: str = "worker"


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class ResetPassword(BaseModel):
    new_password: str


def _get_user_or_404(db: Session, user_id: int) -> User:
    u = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


def _admin_count(db: Session) -> int:
    return db.query(User).filter(User.is_active == True, User.role == "admin").count()


@router.get("")
def list_users(
    search: str = Query(""),
    sort_by: str = Query("username"),
    sort_dir: str = Query("asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("users.view")),
):
    q = db.query(User).filter(User.is_active == True)
    if search:
        like = f"%{search}%"
        q = q.filter(User.username.ilike(like) | User.email.ilike(like))
    sortable = {"username", "email", "role", "last_login_at", "created_at"}
    col = getattr(User, sort_by, None) if sort_by in sortable else None
    if col is None:
        col = User.username
    q = q.order_by(col.asc() if sort_dir == "asc" else col.desc())
    total = q.count()
    items = q.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [UserOut.model_validate(u) for u in items],
        "total": total,
        "page": page,
        "pages": max(ceil(total / page_size), 1),
    }


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("users.view")),
):
    return _get_user_or_404(db, user_id)


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    data: UserCreateAdmin,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.create")),
):
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
    password_error = validate_password(data.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if db.query(User).filter((User.username == data.username) | (User.email == data.email)).first():
        raise HTTPException(status_code=400, detail="Username or email already exists")
    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity(db, current_user.id, current_user.username, "create", "user", user.id,
                 f"Created user '{user.username}' ({user.role})")
    db.commit()
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdateAdmin,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.update")),
):
    u = _get_user_or_404(db, user_id)
    updates = data.model_dump(exclude_unset=True)
    if "role" in updates:
        if updates["role"] not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
        if u.id == current_user.id and updates["role"] != u.role:
            raise HTTPException(status_code=400, detail="You cannot change your own role")
        if u.role == "admin" and updates["role"] != "admin" and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
    for key, val in updates.items():
        setattr(u, key, val)
    db.commit()
    db.refresh(u)
    changed = ", ".join(f"{k}={v}" for k, v in updates.items())
    log_activity(db, current_user.id, current_user.username, "update", "user", u.id,
                 f"Updated user '{u.username}' ({changed})")
    db.commit()
    return u


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    data: ResetPassword,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.update")),
):
    password_error = validate_password(data.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    u = _get_user_or_404(db, user_id)
    u.password_hash = hash_password(data.new_password)
    db.commit()
    log_activity(db, current_user.id, current_user.username, "reset_password", "user", u.id,
                 f"Reset password for user '{u.username}'")
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.delete")),
):
    u = _get_user_or_404(db, user_id)
    if u.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if u.role == "admin" and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    u.is_active = False
    db.commit()
    log_activity(db, current_user.id, current_user.username, "delete", "user", u.id,
                 f"Deactivated user '{u.username}'")
    db.commit()
    return {"ok": True}


@router.put("/password/change")
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    password_error = validate_password(data.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"ok": True}
