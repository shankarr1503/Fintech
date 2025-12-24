from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
from enum import Enum
import json
import csv
import io
from openai import OpenAI
import random

# Helper to convert MongoDB documents
def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict"""
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if key == '_id':
                result['_id'] = str(value)
            elif isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = serialize_doc(value)
            elif isinstance(value, list):
                result[key] = [serialize_doc(v) if isinstance(v, dict) else v for v in value]
            else:
                result[key] = value
        return result
    return doc

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'financewise_db')]

# OpenAI client setup
EMERGENT_LLM_KEY = "sk-emergent-2D4E8D2A51786917eD"
openai_client = OpenAI(
    api_key=EMERGENT_LLM_KEY,
    base_url="https://emergent-api.onrender.com/proxy/openai/v1"
)

# Create the main app
app = FastAPI(title="FinanceWise API", version="1.0.0")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============== ENUMS ==============
class TransactionType(str, Enum):
    CREDIT = "credit"
    DEBIT = "debit"

class TransactionCategory(str, Enum):
    FOOD = "food"
    TRANSPORT = "transport"
    SHOPPING = "shopping"
    UTILITIES = "utilities"
    ENTERTAINMENT = "entertainment"
    HEALTH = "health"
    EDUCATION = "education"
    SALARY = "salary"
    INVESTMENT = "investment"
    TRANSFER = "transfer"
    EMI = "emi"
    SUBSCRIPTION = "subscription"
    OTHER = "other"

class DebtType(str, Enum):
    CREDIT_CARD = "credit_card"
    PERSONAL_LOAN = "personal_loan"
    EMI = "emi"
    OTHER = "other"

class DebtStrategy(str, Enum):
    SNOWBALL = "snowball"
    AVALANCHE = "avalanche"

# ============== MODELS ==============
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone: str
    name: Optional[str] = None
    monthly_income: float = 0
    fixed_expenses: float = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    otp: Optional[str] = None
    otp_expiry: Optional[datetime] = None

class UserCreate(BaseModel):
    phone: str
    name: Optional[str] = None
    monthly_income: float = 0
    fixed_expenses: float = 0

class OTPRequest(BaseModel):
    phone: str

class OTPVerify(BaseModel):
    phone: str
    otp: str

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    date: datetime
    amount: float
    type: TransactionType
    merchant: str
    category: TransactionCategory
    description: Optional[str] = None
    is_recurring: bool = False
    is_subscription: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TransactionCreate(BaseModel):
    user_id: str
    date: datetime
    amount: float
    type: TransactionType
    merchant: str
    category: Optional[TransactionCategory] = None
    description: Optional[str] = None

class Debt(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    type: DebtType
    principal: float
    outstanding: float
    interest_rate: float
    emi_amount: float
    remaining_tenure: int  # months
    created_at: datetime = Field(default_factory=datetime.utcnow)

class DebtCreate(BaseModel):
    user_id: str
    name: str
    type: DebtType
    principal: float
    outstanding: float
    interest_rate: float
    emi_amount: float
    remaining_tenure: int

class SavingsGoal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    target_amount: float
    current_amount: float = 0
    monthly_contribution: float = 0
    target_date: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class SavingsGoalCreate(BaseModel):
    user_id: str
    name: str
    target_amount: float
    monthly_contribution: float = 0
    target_date: Optional[datetime] = None

class SavingsContribution(BaseModel):
    goal_id: str
    amount: float

class Insight(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str
    description: str
    category: str
    impact_amount: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

# ============== AI CATEGORIZATION ==============
async def categorize_transaction_ai(merchant: str, description: str = "") -> TransactionCategory:
    """Use OpenAI to categorize a transaction based on merchant name"""
    try:
        prompt = f"""Categorize this transaction into one of these categories:
        food, transport, shopping, utilities, entertainment, health, education, salary, investment, transfer, emi, subscription, other
        
        Merchant: {merchant}
        Description: {description}
        
        Respond with ONLY the category name in lowercase."""
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0
        )
        
        category = response.choices[0].message.content.strip().lower()
        if category in [c.value for c in TransactionCategory]:
            return TransactionCategory(category)
        return TransactionCategory.OTHER
    except Exception as e:
        logger.error(f"AI categorization failed: {e}")
        return TransactionCategory.OTHER

async def generate_financial_insights(user_id: str) -> List[Dict]:
    """Generate AI-powered financial insights"""
    try:
        # Get user's transactions from last 2 months
        two_months_ago = datetime.utcnow() - timedelta(days=60)
        transactions = await db.transactions.find({
            "user_id": user_id,
            "date": {"$gte": two_months_ago}
        }).to_list(500)
        
        if not transactions:
            return []
        
        # Prepare summary for AI
        category_totals = {}
        for t in transactions:
            cat = t.get('category', 'other')
            if t.get('type') == 'debit':
                category_totals[cat] = category_totals.get(cat, 0) + t.get('amount', 0)
        
        prompt = f"""Analyze this spending data (INR) and provide 3 actionable insights:
        
        Monthly Spending by Category:
        {json.dumps(category_totals, indent=2)}
        
        Total transactions: {len(transactions)}
        
        Provide insights in this JSON format:
        [{{
            "title": "Short title",
            "description": "Detailed insight with specific numbers",
            "category": "spending/saving/warning",
            "impact_amount": estimated monthly savings if applicable
        }}]
        
        Focus on:
        1. Unusual spending patterns
        2. Potential savings opportunities
        3. Positive financial habits
        
        Respond with ONLY the JSON array."""
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.7
        )
        
        insights_text = response.choices[0].message.content.strip()
        # Clean up response
        if insights_text.startswith("```"):
            insights_text = insights_text.split("```")[1]
            if insights_text.startswith("json"):
                insights_text = insights_text[4:]
        
        insights = json.loads(insights_text)
        return insights
    except Exception as e:
        logger.error(f"Insight generation failed: {e}")
        return []

# ============== DEBT CALCULATIONS ==============
def calculate_debt_payoff(debts: List[Dict], strategy: DebtStrategy, extra_payment: float = 0) -> Dict:
    """Calculate debt payoff timeline using snowball or avalanche strategy"""
    if not debts:
        return {"total_months": 0, "total_interest": 0, "payoff_order": []}
    
    # Sort debts based on strategy
    if strategy == DebtStrategy.SNOWBALL:
        sorted_debts = sorted(debts, key=lambda x: x['outstanding'])
    else:  # Avalanche
        sorted_debts = sorted(debts, key=lambda x: x['interest_rate'], reverse=True)
    
    total_months = 0
    total_interest = 0
    payoff_order = []
    
    remaining_debts = [{**d, 'balance': d['outstanding']} for d in sorted_debts]
    
    while any(d['balance'] > 0 for d in remaining_debts):
        total_months += 1
        if total_months > 360:  # 30 years max
            break
            
        available_extra = extra_payment
        
        for debt in remaining_debts:
            if debt['balance'] <= 0:
                continue
                
            # Calculate monthly interest
            monthly_interest = (debt['balance'] * debt['interest_rate']) / (12 * 100)
            total_interest += monthly_interest
            
            # Apply EMI
            payment = debt['emi_amount'] + (available_extra if debt == remaining_debts[0] else 0)
            debt['balance'] = debt['balance'] + monthly_interest - payment
            
            if debt['balance'] <= 0:
                available_extra = abs(debt['balance'])
                debt['balance'] = 0
                payoff_order.append({
                    "name": debt['name'],
                    "months_to_payoff": total_months
                })
    
    return {
        "total_months": total_months,
        "total_interest": round(total_interest, 2),
        "payoff_order": payoff_order,
        "debt_free_date": (datetime.utcnow() + timedelta(days=total_months * 30)).strftime("%B %Y")
    }

# ============== SAMPLE DATA GENERATOR ==============
async def generate_sample_data(user_id: str):
    """Generate sample transactions and debts for demo"""
    merchants = {
        TransactionCategory.FOOD: ["Swiggy", "Zomato", "Dominos", "McDonald's", "Starbucks", "Local Restaurant"],
        TransactionCategory.TRANSPORT: ["Uber", "Ola", "Petrol Pump", "Metro Card", "Rapido"],
        TransactionCategory.SHOPPING: ["Amazon", "Flipkart", "Myntra", "Big Bazaar", "DMart"],
        TransactionCategory.UTILITIES: ["Electricity Bill", "Water Bill", "Gas Bill", "Internet Bill"],
        TransactionCategory.ENTERTAINMENT: ["Netflix", "Amazon Prime", "BookMyShow", "Spotify"],
        TransactionCategory.SUBSCRIPTION: ["Netflix", "Spotify", "YouTube Premium", "Gym Membership"],
        TransactionCategory.EMI: ["HDFC EMI", "Bajaj EMI", "Car Loan EMI"]
    }
    
    transactions = []
    base_date = datetime.utcnow()
    
    # Generate 60 days of transactions
    for day_offset in range(60):
        date = base_date - timedelta(days=day_offset)
        
        # 2-5 transactions per day
        num_transactions = random.randint(2, 5)
        for _ in range(num_transactions):
            category = random.choice(list(merchants.keys()))
            merchant = random.choice(merchants[category])
            
            # Amount ranges by category
            amount_ranges = {
                TransactionCategory.FOOD: (100, 1500),
                TransactionCategory.TRANSPORT: (50, 800),
                TransactionCategory.SHOPPING: (500, 5000),
                TransactionCategory.UTILITIES: (500, 3000),
                TransactionCategory.ENTERTAINMENT: (200, 1000),
                TransactionCategory.SUBSCRIPTION: (199, 999),
                TransactionCategory.EMI: (3000, 15000)
            }
            
            min_amt, max_amt = amount_ranges.get(category, (100, 1000))
            amount = round(random.uniform(min_amt, max_amt), 2)
            
            transactions.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "date": date,
                "amount": amount,
                "type": "debit",
                "merchant": merchant,
                "category": category.value,
                "description": f"Payment to {merchant}",
                "is_recurring": category in [TransactionCategory.EMI, TransactionCategory.SUBSCRIPTION],
                "is_subscription": category == TransactionCategory.SUBSCRIPTION,
                "created_at": datetime.utcnow()
            })
    
    # Add salary credits (2 per month)
    for month_offset in range(2):
        salary_date = base_date.replace(day=1) - timedelta(days=month_offset * 30)
        transactions.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "date": salary_date,
            "amount": 75000,
            "type": "credit",
            "merchant": "Employer",
            "category": "salary",
            "description": "Monthly Salary",
            "is_recurring": True,
            "is_subscription": False,
            "created_at": datetime.utcnow()
        })
    
    # Insert transactions
    if transactions:
        await db.transactions.insert_many(transactions)
    
    # Add sample debts
    sample_debts = [
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": "HDFC Credit Card",
            "type": "credit_card",
            "principal": 50000,
            "outstanding": 42000,
            "interest_rate": 36,
            "emi_amount": 5000,
            "remaining_tenure": 10,
            "created_at": datetime.utcnow()
        },
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": "Personal Loan",
            "type": "personal_loan",
            "principal": 200000,
            "outstanding": 156000,
            "interest_rate": 14,
            "emi_amount": 8500,
            "remaining_tenure": 20,
            "created_at": datetime.utcnow()
        },
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": "iPhone EMI",
            "type": "emi",
            "principal": 80000,
            "outstanding": 48000,
            "interest_rate": 0,
            "emi_amount": 8000,
            "remaining_tenure": 6,
            "created_at": datetime.utcnow()
        }
    ]
    await db.debts.insert_many(sample_debts)
    
    # Add sample savings goal
    sample_goal = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": "Emergency Fund",
        "target_amount": 300000,
        "current_amount": 75000,
        "monthly_contribution": 10000,
        "target_date": datetime.utcnow() + timedelta(days=365),
        "created_at": datetime.utcnow()
    }
    await db.savings_goals.insert_one(sample_goal)
    
    return {"transactions": len(transactions), "debts": len(sample_debts), "goals": 1}

# ============== API ROUTES ==============

# Health Check
@api_router.get("/")
async def root():
    return {"message": "FinanceWise API", "version": "1.0.0"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

# ============== AUTH ROUTES ==============
@api_router.post("/auth/send-otp")
async def send_otp(request: OTPRequest):
    """Send OTP to phone (mocked for demo)"""
    # Generate 6-digit OTP
    otp = "".join([str(random.randint(0, 9)) for _ in range(6)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=5)
    
    # Check if user exists, if not create
    user = await db.users.find_one({"phone": request.phone})
    if user:
        await db.users.update_one(
            {"phone": request.phone},
            {"$set": {"otp": otp, "otp_expiry": otp_expiry}}
        )
    else:
        new_user = User(phone=request.phone, otp=otp, otp_expiry=otp_expiry)
        await db.users.insert_one(new_user.dict())
    
    # In production, send SMS here
    logger.info(f"OTP for {request.phone}: {otp}")
    
    return {"message": "OTP sent successfully", "demo_otp": otp}  # Remove demo_otp in production

@api_router.post("/auth/verify-otp")
async def verify_otp(request: OTPVerify):
    """Verify OTP and return user"""
    user = await db.users.find_one({"phone": request.phone})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.get('otp') != request.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    if user.get('otp_expiry') and datetime.utcnow() > user['otp_expiry']:
        raise HTTPException(status_code=400, detail="OTP expired")
    
    # Clear OTP after successful verification
    await db.users.update_one(
        {"phone": request.phone},
        {"$set": {"otp": None, "otp_expiry": None}}
    )
    
    # Check if user has sample data, if not generate
    transaction_count = await db.transactions.count_documents({"user_id": user['id']})
    if transaction_count == 0:
        await generate_sample_data(user['id'])
    
    return {
        "message": "Login successful",
        "user": {
            "id": user['id'],
            "phone": user['phone'],
            "name": user.get('name'),
            "monthly_income": user.get('monthly_income', 0),
            "fixed_expenses": user.get('fixed_expenses', 0)
        }
    }

@api_router.put("/users/{user_id}")
async def update_user(user_id: str, name: str = None, monthly_income: float = None, fixed_expenses: float = None):
    """Update user profile"""
    update_data = {}
    if name is not None:
        update_data['name'] = name
    if monthly_income is not None:
        update_data['monthly_income'] = monthly_income
    if fixed_expenses is not None:
        update_data['fixed_expenses'] = fixed_expenses
    
    if update_data:
        await db.users.update_one({"id": user_id}, {"$set": update_data})
    
    user = await db.users.find_one({"id": user_id})
    return user

# ============== TRANSACTION ROUTES ==============
@api_router.get("/transactions/{user_id}")
async def get_transactions(user_id: str, limit: int = 100, category: str = None):
    """Get user transactions"""
    query = {"user_id": user_id}
    if category:
        query["category"] = category
    
    transactions = await db.transactions.find(query).sort("date", -1).to_list(limit)
    return transactions

@api_router.post("/transactions")
async def create_transaction(transaction: TransactionCreate):
    """Create a new transaction"""
    # Auto-categorize if not provided
    category = transaction.category
    if not category:
        category = await categorize_transaction_ai(transaction.merchant, transaction.description or "")
    
    trans_dict = transaction.dict()
    trans_dict['category'] = category.value if hasattr(category, 'value') else category
    trans_obj = Transaction(**trans_dict)
    
    await db.transactions.insert_one(trans_obj.dict())
    return trans_obj

@api_router.post("/transactions/upload-csv/{user_id}")
async def upload_csv(user_id: str, file: UploadFile = File(...)):
    """Upload CSV bank statement"""
    try:
        content = await file.read()
        decoded = content.decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded))
        
        transactions = []
        for row in reader:
            # Expected columns: date, amount, type, merchant/description
            date_str = row.get('date') or row.get('Date') or row.get('Transaction Date')
            amount = float(row.get('amount') or row.get('Amount') or row.get('Debit') or row.get('Credit') or 0)
            merchant = row.get('merchant') or row.get('Merchant') or row.get('Description') or row.get('Narration') or 'Unknown'
            trans_type = row.get('type') or row.get('Type') or ('credit' if float(row.get('Credit', 0) or 0) > 0 else 'debit')
            
            # Parse date
            try:
                date = datetime.strptime(date_str, '%Y-%m-%d')
            except:
                try:
                    date = datetime.strptime(date_str, '%d/%m/%Y')
                except:
                    date = datetime.utcnow()
            
            category = await categorize_transaction_ai(merchant)
            
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
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")

@api_router.post("/transactions/mock-sync/{user_id}")
async def mock_bank_sync(user_id: str):
    """Mock Account Aggregator sync - generates realistic transactions"""
    result = await generate_sample_data(user_id)
    return {"message": "Bank sync completed", "synced": result}

# ============== ANALYTICS ROUTES ==============
@api_router.get("/analytics/summary/{user_id}")
async def get_analytics_summary(user_id: str):
    """Get spending summary and analytics"""
    now = datetime.utcnow()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_start = (start_of_month - timedelta(days=1)).replace(day=1)
    
    # This month's transactions
    this_month_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "debit"
    }).to_list(1000)
    
    # Last month's transactions
    last_month_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": last_month_start, "$lt": start_of_month},
        "type": "debit"
    }).to_list(1000)
    
    # Calculate totals
    this_month_total = sum(t['amount'] for t in this_month_txns)
    last_month_total = sum(t['amount'] for t in last_month_txns)
    
    # Category breakdown
    category_totals = {}
    for t in this_month_txns:
        cat = t.get('category', 'other')
        category_totals[cat] = category_totals.get(cat, 0) + t['amount']
    
    # Get income
    income_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "credit"
    }).to_list(100)
    total_income = sum(t['amount'] for t in income_txns)
    
    # Calculate change percentage
    change_pct = 0
    if last_month_total > 0:
        change_pct = round(((this_month_total - last_month_total) / last_month_total) * 100, 1)
    
    return {
        "this_month_spending": round(this_month_total, 2),
        "last_month_spending": round(last_month_total, 2),
        "change_percentage": change_pct,
        "total_income": round(total_income, 2),
        "remaining_balance": round(total_income - this_month_total, 2),
        "category_breakdown": category_totals,
        "transaction_count": len(this_month_txns)
    }

@api_router.get("/analytics/insights/{user_id}")
async def get_insights(user_id: str):
    """Get AI-generated financial insights"""
    insights = await generate_financial_insights(user_id)
    
    # Store insights
    for insight in insights:
        insight_obj = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            **insight,
            "created_at": datetime.utcnow()
        }
        await db.insights.update_one(
            {"user_id": user_id, "title": insight['title']},
            {"$set": insight_obj},
            upsert=True
        )
    
    return insights

@api_router.get("/analytics/expense-reduction/{user_id}")
async def get_expense_reduction_tips(user_id: str):
    """Get personalized expense reduction suggestions"""
    # Get category spending
    now = datetime.utcnow()
    start_of_month = now.replace(day=1)
    
    txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "debit"
    }).to_list(1000)
    
    category_totals = {}
    subscription_totals = 0
    
    for t in txns:
        cat = t.get('category', 'other')
        category_totals[cat] = category_totals.get(cat, 0) + t['amount']
        if t.get('is_subscription'):
            subscription_totals += t['amount']
    
    suggestions = []
    
    # Food delivery reduction
    if category_totals.get('food', 0) > 5000:
        food_spending = category_totals['food']
        potential_savings = food_spending * 0.3
        suggestions.append({
            "category": "food",
            "title": "Reduce Food Delivery",
            "description": f"Cooking at home 3 more times per week could save you ₹{int(potential_savings):,}/month",
            "monthly_savings": potential_savings,
            "yearly_savings": potential_savings * 12
        })
    
    # Entertainment/subscription
    if subscription_totals > 1000:
        suggestions.append({
            "category": "subscription",
            "title": "Review Subscriptions",
            "description": f"You're spending ₹{int(subscription_totals):,} on subscriptions. Consider sharing family plans.",
            "monthly_savings": subscription_totals * 0.4,
            "yearly_savings": subscription_totals * 0.4 * 12
        })
    
    # Transport
    if category_totals.get('transport', 0) > 3000:
        transport = category_totals['transport']
        suggestions.append({
            "category": "transport",
            "title": "Optimize Commute",
            "description": f"Using public transport twice a week could save ₹{int(transport * 0.2):,}/month",
            "monthly_savings": transport * 0.2,
            "yearly_savings": transport * 0.2 * 12
        })
    
    return suggestions

# ============== DEBT ROUTES ==============
@api_router.get("/debts/{user_id}")
async def get_debts(user_id: str):
    """Get all user debts"""
    debts = await db.debts.find({"user_id": user_id}).to_list(100)
    return debts

@api_router.post("/debts")
async def create_debt(debt: DebtCreate):
    """Add a new debt"""
    debt_obj = Debt(**debt.dict())
    await db.debts.insert_one(debt_obj.dict())
    return debt_obj

@api_router.delete("/debts/{debt_id}")
async def delete_debt(debt_id: str):
    """Delete a debt"""
    result = await db.debts.delete_one({"id": debt_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Debt not found")
    return {"message": "Debt deleted"}

@api_router.get("/debts/analysis/{user_id}")
async def analyze_debts(user_id: str, extra_payment: float = 0):
    """Analyze debts with payoff strategies"""
    debts = await db.debts.find({"user_id": user_id}).to_list(100)
    
    if not debts:
        return {
            "total_debt": 0,
            "total_emi": 0,
            "snowball_analysis": None,
            "avalanche_analysis": None
        }
    
    total_debt = sum(d['outstanding'] for d in debts)
    total_emi = sum(d['emi_amount'] for d in debts)
    avg_interest = sum(d['interest_rate'] * d['outstanding'] for d in debts) / total_debt if total_debt > 0 else 0
    
    snowball = calculate_debt_payoff(debts, DebtStrategy.SNOWBALL, extra_payment)
    avalanche = calculate_debt_payoff(debts, DebtStrategy.AVALANCHE, extra_payment)
    
    return {
        "total_debt": round(total_debt, 2),
        "total_emi": round(total_emi, 2),
        "average_interest_rate": round(avg_interest, 2),
        "snowball_analysis": snowball,
        "avalanche_analysis": avalanche,
        "interest_saved_with_avalanche": round(snowball['total_interest'] - avalanche['total_interest'], 2)
    }

# ============== SAVINGS ROUTES ==============
@api_router.get("/savings/{user_id}")
async def get_savings_goals(user_id: str):
    """Get all savings goals"""
    goals = await db.savings_goals.find({"user_id": user_id}).to_list(100)
    return goals

@api_router.post("/savings")
async def create_savings_goal(goal: SavingsGoalCreate):
    """Create a new savings goal"""
    goal_obj = SavingsGoal(**goal.dict())
    await db.savings_goals.insert_one(goal_obj.dict())
    return goal_obj

@api_router.post("/savings/contribute")
async def contribute_to_goal(contribution: SavingsContribution):
    """Add contribution to a savings goal"""
    goal = await db.savings_goals.find_one({"id": contribution.goal_id})
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    new_amount = goal['current_amount'] + contribution.amount
    await db.savings_goals.update_one(
        {"id": contribution.goal_id},
        {"$set": {"current_amount": new_amount}}
    )
    
    return {"message": "Contribution added", "new_total": new_amount}

@api_router.delete("/savings/{goal_id}")
async def delete_savings_goal(goal_id: str):
    """Delete a savings goal"""
    result = await db.savings_goals.delete_one({"id": goal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"message": "Goal deleted"}

@api_router.get("/savings/suggestions/{user_id}")
async def get_savings_suggestions(user_id: str):
    """Get AI-powered savings suggestions"""
    # Get user's spending pattern
    analytics = await get_analytics_summary(user_id)
    remaining = analytics['remaining_balance']
    spending = analytics['this_month_spending']
    
    suggestions = []
    
    # Safe savings amount (50-30-20 rule)
    safe_savings = remaining * 0.2 if remaining > 0 else 0
    suggestions.append({
        "type": "safe",
        "amount": round(safe_savings, 2),
        "description": "20% of your remaining balance - conservative and sustainable"
    })
    
    # Moderate savings
    moderate = remaining * 0.3 if remaining > 0 else 0
    suggestions.append({
        "type": "moderate",
        "amount": round(moderate, 2),
        "description": "30% of remaining - good progress toward your goals"
    })
    
    # Aggressive savings (with expense cuts)
    expense_reduction = spending * 0.1
    aggressive = (remaining + expense_reduction) * 0.35 if remaining > 0 else 0
    suggestions.append({
        "type": "aggressive",
        "amount": round(aggressive, 2),
        "description": "35% with 10% expense reduction - fastest goal achievement"
    })
    
    return suggestions

# ============== DASHBOARD ==============
@api_router.get("/dashboard/{user_id}")
async def get_dashboard(user_id: str):
    """Get complete dashboard data"""
    # Get analytics
    analytics = await get_analytics_summary(user_id)
    
    # Get debts summary
    debts = await db.debts.find({"user_id": user_id}).to_list(100)
    total_debt = sum(d['outstanding'] for d in debts)
    total_emi = sum(d['emi_amount'] for d in debts)
    
    # Get savings summary
    goals = await db.savings_goals.find({"user_id": user_id}).to_list(100)
    total_saved = sum(g['current_amount'] for g in goals)
    total_target = sum(g['target_amount'] for g in goals)
    
    # Get recent transactions
    recent_txns = await db.transactions.find({"user_id": user_id}).sort("date", -1).to_list(5)
    
    # Generate one recommended action
    action = None
    if total_debt > 0 and analytics['remaining_balance'] > total_emi:
        action = {
            "type": "debt",
            "title": "Pay Extra on Debt",
            "description": f"You have ₹{int(analytics['remaining_balance'] - total_emi):,} extra. Consider paying ₹2,000 more on your highest interest debt."
        }
    elif analytics['remaining_balance'] > 5000:
        action = {
            "type": "savings",
            "title": "Boost Savings",
            "description": f"Great month! Move ₹{int(analytics['remaining_balance'] * 0.2):,} to your savings goal."
        }
    else:
        action = {
            "type": "expense",
            "title": "Review Expenses",
            "description": "Check your food delivery expenses - they might be higher than usual."
        }
    
    return {
        "spending": {
            "this_month": analytics['this_month_spending'],
            "last_month": analytics['last_month_spending'],
            "change_percentage": analytics['change_percentage'],
            "remaining_balance": analytics['remaining_balance']
        },
        "income": analytics['total_income'],
        "debts": {
            "total": total_debt,
            "monthly_emi": total_emi,
            "count": len(debts)
        },
        "savings": {
            "total_saved": total_saved,
            "total_target": total_target,
            "progress": round((total_saved / total_target * 100) if total_target > 0 else 0, 1),
            "goals_count": len(goals)
        },
        "category_breakdown": analytics['category_breakdown'],
        "recent_transactions": recent_txns,
        "recommended_action": action
    }

# Include router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
