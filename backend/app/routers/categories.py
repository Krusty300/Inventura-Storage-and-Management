from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from app.constants import MAX_PAGE_SIZE_LOOKUP
from app.database import get_db
from app.models.category import Category
from app.schemas.category import CategoryBulkEdit, CategoryCreate, CategoryOut, CategoryTree, CategoryUpdate
from app.services.auth import require_permission
from app.utils import get_or_404, log_activity, broadcast_change

router = APIRouter(prefix="/api/categories", tags=["categories"], dependencies=[Depends(require_permission("categories.view"))])


@router.get("")
def list_categories(
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE_LOOKUP),
    db: Session = Depends(get_db),
):
    q = db.query(Category).options(joinedload(Category.subcategories))
    if search:
        q = q.filter(Category.name.ilike(f"%{search}%"))
    total = q.count()
    items = q.offset(skip).limit(limit).all()
    return {"items": [CategoryOut.model_validate(c) for c in items], "total": total, "page": (skip // limit) + 1, "pages": max(ceil(total / limit), 1)}


@router.get("/tree", response_model=list[CategoryTree])
def category_tree(db: Session = Depends(get_db)):
    return db.query(Category).filter(Category.parent_id.is_(None)).options(joinedload(Category.subcategories)).all()


@router.patch("/bulk-edit")
def bulk_edit_categories(data: CategoryBulkEdit, db: Session = Depends(get_db), user=Depends(require_permission("categories.bulk"))):
    cats = db.query(Category).filter(Category.id.in_(data.ids)).all()
    if not cats:
        raise HTTPException(status_code=404, detail="No categories found")
    updates = {}
    if data.description is not None:
        updates["description"] = data.description
    if "parent_id" in data.model_fields_set:
        updates["parent_id"] = data.parent_id
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    new_parent = updates.get("parent_id")
    if new_parent is not None:
        if new_parent in data.ids:
            raise HTTPException(status_code=400, detail="A category cannot be its own parent")
        if not db.query(Category.id).filter(Category.id == new_parent).first():
            raise HTTPException(status_code=404, detail="Parent category not found")
        cur = new_parent
        while cur is not None:
            if cur in data.ids:
                raise HTTPException(status_code=400, detail="Parent chain would create a cycle with the selected categories")
            row = db.query(Category.parent_id).filter(Category.id == cur).first()
            cur = row[0] if row else None
    for c in cats:
        for k, v in updates.items():
            setattr(c, k, v)
    db.commit()
    log_activity(db, user.id, user.username, "update", "category", None,
                 f"Bulk-edited {len(cats)} category/categories: {', '.join(f'{k}={v}' for k, v in updates.items())}")
    db.commit()
    broadcast_change("category", "updated")
    return {"updated": len(cats), "fields": list(updates.keys())}


@router.get("/{category_id}", response_model=CategoryOut)
def get_category(category_id: int, db: Session = Depends(get_db)):
    return get_or_404(Category, category_id, db)


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(data: CategoryCreate, db: Session = Depends(get_db), user=Depends(require_permission("categories.create"))):
    if db.query(Category).filter(Category.name == data.name).first():
        raise HTTPException(status_code=400, detail="Category already exists")
    cat = Category(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    log_activity(db, user.id, user.username, "create", "category", cat.id, f"Created category '{cat.name}'")
    db.commit()
    broadcast_change("category", "created")
    return cat


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, data: CategoryUpdate, db: Session = Depends(get_db), user=Depends(require_permission("categories.update"))):
    cat = get_or_404(Category, category_id, db)
    updates = data.model_dump(exclude_unset=True)
    if "parent_id" in updates:
        new_parent = updates["parent_id"]
        if new_parent == category_id:
            raise HTTPException(status_code=400, detail="A category cannot be its own parent")
        if new_parent is not None and not db.query(Category.id).filter(Category.id == new_parent).first():
            raise HTTPException(status_code=404, detail="Parent category not found")
        cur = new_parent
        while cur is not None:
            if cur == category_id:
                raise HTTPException(status_code=400, detail="Parent chain would create a cycle")
            row = db.query(Category.parent_id).filter(Category.id == cur).first()
            cur = row[0] if row else None
    for k, v in updates.items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    log_activity(db, user.id, user.username, "update", "category", cat.id, f"Updated category '{cat.name}'")
    db.commit()
    broadcast_change("category", "updated")
    return cat


@router.delete("/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db), user=Depends(require_permission("categories.delete"))):
    cat = get_or_404(Category, category_id, db, options=[joinedload(Category.products), joinedload(Category.subcategories)])
    if cat.products:
        raise HTTPException(status_code=400, detail="Cannot delete category with existing products")
    if cat.subcategories:
        raise HTTPException(status_code=400, detail="Cannot delete category with subcategories")
    name = cat.name
    db.delete(cat)
    db.commit()
    log_activity(db, user.id, user.username, "delete", "category", category_id, f"Deleted category '{name}'")
    db.commit()
    broadcast_change("category", "deleted")
