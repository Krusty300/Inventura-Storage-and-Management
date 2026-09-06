from math import ceil
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.session import UserSession
from app.models.user import User
from app.schemas.user import UserOut
from app.services.auth import get_current_user, require_permission, hash_password, verify_password
from app.services.password_policy import validate_password
from app.services.permissions import ALL_PERMISSIONS, has_permission
from app.utils import log_activity, broadcast_change

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {"admin", "manager", "worker"}


class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    permissions: Optional[list[str]] = None


class UserCreateAdmin(BaseModel):
    username: str
    email: str
    password: str
    role: str = "worker"
    permissions: Optional[list[str]] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class ResetPassword(BaseModel):
    new_password: str


def _get_user_or_404(db: Session, user_id: int, include_inactive: bool = False) -> User:
    q = db.query(User).filter(User.id == user_id)
    if not include_inactive:
        q = q.filter(User.is_active == True)
    u = q.first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


def _admin_count(db: Session) -> int:
    return db.query(User).filter(User.is_active == True, User.role == "admin").count()


class UserApproval(BaseModel):
    role: Optional[str] = None


@router.get("/pending", response_model=list[UserOut])
def list_pending_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("users.view")),
):
    users = db.query(User).filter(User.is_approved == False, User.is_active == True).order_by(User.created_at.asc()).all()
    return [UserOut.model_validate(u) for u in users]


@router.post("/{user_id}/approve", response_model=UserOut)
def approve_user(
    user_id: int,
    data: UserApproval = UserApproval(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.update")),
):
    u = _get_user_or_404(db, user_id, include_inactive=True)
    if u.is_approved:
        raise HTTPException(status_code=400, detail="User is already approved")
    if not u.is_active:
        raise HTTPException(status_code=400, detail="Cannot approve a deactivated user")
    u.is_approved = True
    if data.role and data.role in VALID_ROLES:
        if data.role == "admin" and not has_permission(current_user.role, "users.assign_admin_role"):
            raise HTTPException(status_code=403, detail="Only admins can assign the admin role")
        u.role = data.role
    db.commit()
    db.refresh(u)
    from app.services.notify import create_notification
    create_notification(
        db, u.id,
        "Account approved",
        f"Your account has been approved by {current_user.username}. You can now sign in.",
        type="success",
        link="/login",
    )
    log_activity(db, current_user.id, current_user.username, "approve", "user", u.id,
                 f"Approved user '{u.username}' (role={u.role})")
    db.commit()
    broadcast_change("user", "updated")
    return u


@router.post("/{user_id}/reject", response_model=UserOut)
def reject_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.update")),
):
    u = _get_user_or_404(db, user_id, include_inactive=True)
    if u.is_approved:
        raise HTTPException(status_code=400, detail="Cannot reject an already approved user")
    u.is_active = False
    db.commit()
    db.refresh(u)
    from app.services.notify import create_notification
    create_notification(
        db, u.id,
        "Account rejected",
        f"Your account registration was rejected by {current_user.username}.",
        type="warning",
    )
    log_activity(db, current_user.id, current_user.username, "reject", "user", u.id,
                 f"Rejected user '{u.username}'")
    db.commit()
    broadcast_change("user", "updated")
    return u


@router.get("")
def list_users(
    search: str = Query(""),
    sort_by: str = Query("username"),
    sort_dir: str = Query("asc"),
    include_inactive: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("users.view")),
):
    q = db.query(User)
    if not include_inactive:
        q = q.filter(User.is_active == True)
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


def _validate_permissions(permissions: list[str] | None) -> None:
    if not permissions:
        return
    unknown = [p for p in permissions if p not in ALL_PERMISSIONS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(sorted(unknown))}")


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    data: UserCreateAdmin,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.create")),
):
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
    if data.role == "admin" and not has_permission(current_user.role, "users.assign_admin_role"):
        raise HTTPException(status_code=403, detail="Only admins can assign the admin role")
    _validate_permissions(data.permissions)
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
        permissions=data.permissions,
        is_approved=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity(db, current_user.id, current_user.username, "create", "user", user.id,
                 f"Created user '{user.username}' ({user.role})")
    db.commit()
    broadcast_change("user", "created")
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdateAdmin,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("users.update")),
):
    u = _get_user_or_404(db, user_id, include_inactive=True)
    updates = data.model_dump(exclude_unset=True)
    if u.role == "admin" and current_user.role != "admin":
        if "role" in updates or "is_active" in updates:
            raise HTTPException(status_code=403, detail="Only admins can change an admin's role or status")
    if "permissions" in updates:
        _validate_permissions(updates["permissions"])
        updates["permissions"] = updates["permissions"] or None
    if "role" in updates:
        if updates["role"] not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
        if updates["role"] == "admin" and not has_permission(current_user.role, "users.assign_admin_role"):
            raise HTTPException(status_code=403, detail="Only admins can assign the admin role")
        if u.id == current_user.id and updates["role"] != u.role:
            raise HTTPException(status_code=400, detail="You cannot change your own role")
        if u.role == "admin" and updates["role"] != "admin" and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
    if "is_active" in updates and updates["is_active"] != u.is_active:
        if not updates["is_active"]:
            if u.id == current_user.id:
                raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
            if u.role == "admin" and _admin_count(db) <= 1:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last admin")
    for key, val in updates.items():
        setattr(u, key, val)
    db.commit()
    db.refresh(u)
    changed = ", ".join(f"{k}={v}" for k, v in updates.items())
    log_activity(db, current_user.id, current_user.username, "update", "user", u.id,
                 f"Updated user '{u.username}' ({changed})")
    db.commit()
    broadcast_change("user", "updated")
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
    if u.role == "admin" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can reset another admin's password")
    u.password_hash = hash_password(data.new_password)
    db.query(UserSession).filter(
        UserSession.user_id == u.id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    log_activity(db, current_user.id, current_user.username, "reset_password", "user", u.id,
                 f"Reset password for user '{u.username}'; all sessions signed out")
    db.commit()
    broadcast_change("user", "updated")
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
    broadcast_change("user", "deleted")
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
    db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    log_activity(db, current_user.id, current_user.username, "change_password", "user", current_user.id,
                 "Changed password; all sessions signed out")
    db.commit()
    broadcast_change("user", "updated")
    return {"ok": True}
