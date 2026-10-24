import csv
import io
import logging
import math
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..auth import current_user
from ..config import settings
from ..db import db
from ..models import Transaction, TransactionCategory, TransactionCreate
from ..services import game
from ..services.ai import categorize_by_keywords, categorize_transaction_ai
from ..services.sample_data import generate_sample_data
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/transactions/{user_id}")
async def get_transactions(user_id: str, limit: int = 100, category: str = None):
    """Get user transactions"""
    query = {"user_id": user_id}
    if category:
        query["category"] = category
    
    transactions = await db.transactions.find(query).sort("date", -1).to_list(limit)
    return serialize_doc(transactions)

@router.post("/transactions")
async def create_transaction(transaction: TransactionCreate):
    """Create a new transaction"""
    # Auto-categorize if not provided
    category = transaction.category
    if not category:
        category = await categorize_transaction_ai(transaction.merchant, transaction.description or "")
    
    trans_dict = transaction.model_dump()
    trans_dict['category'] = category.value if hasattr(category, 'value') else category
    trans_obj = Transaction(**trans_dict)
    
    await db.transactions.insert_one(trans_obj.model_dump())
    return trans_obj

MAX_CSV_ROWS = 2000
MAX_AI_CATEGORIZED_ROWS = 50


@router.post("/transactions/upload-csv/{user_id}")
async def upload_csv(user_id: str, file: UploadFile = File(...)):
    """Upload CSV bank statement"""
    try:
        content = await file.read()
        decoded = content.decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded))
        
        transactions = []
        categorized = 0
        for n, row in enumerate(reader):
            if n >= MAX_CSV_ROWS:
                raise HTTPException(status_code=400, detail=f"Statements can have at most {MAX_CSV_ROWS:,} rows. Split the file and upload each part.")
            # Expected columns: date, amount, type, merchant/description
            date_str = row.get('date') or row.get('Date') or row.get('Transaction Date')
            amount = float(row.get('amount') or row.get('Amount') or row.get('Debit') or row.get('Credit') or 0)
            merchant = row.get('merchant') or row.get('Merchant') or row.get('Description') or row.get('Narration') or 'Unknown'
            trans_type = row.get('type') or row.get('Type') or ('credit' if float(row.get('Credit', 0) or 0) > 0 else 'debit')
            
            # Parse date
            try:
                date = datetime.strptime(date_str, '%Y-%m-%d')
            except (ValueError, TypeError):
                try:
                    date = datetime.strptime(date_str, '%d/%m/%Y')
                except (ValueError, TypeError):
                    date = datetime.utcnow()
            
            # The model is paid per call: use it for the first rows, keyword rules for the rest.
            if categorized < MAX_AI_CATEGORIZED_ROWS:
                category = await categorize_transaction_ai(merchant)
                categorized += 1
            else:
                category = categorize_by_keywords(merchant)
            if not math.isfinite(amount):
                raise ValueError(f"row {n + 2}: amount is not a number")
            
            transactions.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "date": date,
                "amount": abs(amount),
                "type": trans_type.lower() if trans_type else "debit",
                "merchant": merchant,
                "category": category.value,
                "description": merchant,
                "is_recurring": False,
                "is_subscription": False,
                "created_at": datetime.utcnow()
            })
        
        if transactions:
            await db.transactions.insert_many(transactions)
        
        return {"message": f"Imported {len(transactions)} transactions", "count": len(transactions)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")

@router.post("/transactions/mock-sync/{user_id}")
async def mock_bank_sync(user_id: str):
    """Demo only: adds sample transactions. Real data arrives through the Account Aggregator."""
    if not settings.demo_mode:
        raise HTTPException(status_code=404, detail="Not available")
    result = await generate_sample_data(user_id, days=3, with_portfolio=False)
    return {"message": "Sample transactions added", "synced": result}


DEFAULT_CATEGORIES = [c.value for c in TransactionCategory]
MAX_CUSTOM_CATEGORIES = 20


class NewCategory(BaseModel):
    user_id: str
    name: str = Field(min_length=2, max_length=24)


class Recategorize(BaseModel):
    category: str = Field(min_length=2, max_length=32)
    apply_to_merchant: bool = False  # also re-tag every other transaction from this merchant


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


@router.get("/categories/{user_id}")
async def list_categories(user_id: str):
    user = await db.users.find_one({"id": user_id}) or {}
    return {"default": DEFAULT_CATEGORIES, "custom": user.get("custom_categories", [])}


@router.post("/categories")
async def add_category(body: NewCategory):
    slug = _slug(body.name)
    if len(slug) < 2:
        raise HTTPException(status_code=400, detail="Use letters or numbers in the name")
    user = await db.users.find_one({"id": body.user_id}) or {}
    custom = user.get("custom_categories", [])
    if slug in DEFAULT_CATEGORIES or any(c["id"] == slug for c in custom):
        raise HTTPException(status_code=409, detail="You already have that category")
    if len(custom) >= MAX_CUSTOM_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"You can have up to {MAX_CUSTOM_CATEGORIES} custom categories")
    category = {"id": slug, "name": " ".join(body.name.split())}
    await db.users.update_one({"id": body.user_id}, {"$push": {"custom_categories": category}})
    return category


@router.patch("/transactions/{txn_id}")
async def recategorize(txn_id: str, body: Recategorize, request: Request):
    uid = current_user(request)
    txn = await db.transactions.find_one({"id": txn_id, "user_id": uid})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    user = await db.users.find_one({"id": uid}) or {}
    allowed = set(DEFAULT_CATEGORIES) | {c["id"] for c in user.get("custom_categories", [])}
    if body.category not in allowed:
        raise HTTPException(status_code=400, detail="Unknown category")
    query = {"user_id": uid, "merchant": txn["merchant"]} if body.apply_to_merchant else {"id": txn_id}
    res = await db.transactions.update_many(query, {"$set": {"category": body.category, "user_categorized": True}})
    reward = await game.award(uid, "transaction_categorised")
    return {"updated": res.modified_count, "category": body.category, "reward": reward}
