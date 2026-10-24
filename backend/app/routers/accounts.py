import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..db import db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/accounts/all/{user_id}")
async def get_all_accounts(user_id: str):
    """Get all user accounts - Bank, Post Office, FD, RD (sample data in demo mode)"""
    if not settings.demo_mode:
        return {"summary": {"total_balance": 0, "total_investments": 0, "total_deposits": 0, "accounts_count": 0}, "bank_accounts": [], "sample": False}
    return {
        "sample": True,
        "summary": {
            "total_balance": 1245000,
            "total_investments": 970000,
            "total_deposits": 400000,
            "accounts_count": 12
        },
        "bank_accounts": [
            {
                "id": "bank_1",
                "bank": "Sample Bank",
                "type": "Savings",
                "account_number": "XXXX1234",
                "ifsc": "HDFC0001234",
                "balance": 245000,
                "interest_rate": 3.0,
                "is_salary_account": True,
                "last_transaction": datetime.utcnow().isoformat(),
                "card_color": "#004C8F"
            },
            {
                "id": "bank_2",
                "bank": "Sample Bank",
                "type": "Savings",
                "account_number": "XXXX5678",
                "ifsc": "ICIC0005678",
                "balance": 89000,
                "interest_rate": 3.0,
                "is_salary_account": False,
                "last_transaction": datetime.utcnow().isoformat(),
                "card_color": "#F58220"
            },
            {
                "id": "bank_3",
                "bank": "Sample Bank",
                "type": "Savings",
                "account_number": "XXXX9012",
                "ifsc": "SBIN0009012",
                "balance": 156000,
                "interest_rate": 2.7,
                "is_salary_account": False,
                "last_transaction": datetime.utcnow().isoformat(),
                "card_color": "#22409A"
            }
        ],
        "post_office_accounts": [
            {
                "id": "po_1",
                "type": "Post Office Savings",
                "account_number": "PO-XXXX3456",
                "branch": "Andheri West",
                "balance": 75000,
                "interest_rate": 4.0,
                "card_color": "#DC2626"
            },
            {
                "id": "po_2",
                "type": "National Savings Certificate",
                "certificate_number": "NSC-XXXX7890",
                "principal": 100000,
                "current_value": 112000,
                "interest_rate": 7.7,
                "maturity_date": "2028-06-15",
                "card_color": "#DC2626"
            }
        ],
        "fixed_deposits": [
            {
                "id": "fd_1",
                "bank": "Sample Bank",
                "type": "Fixed Deposit",
                "fd_number": "FD-XXXX1111",
                "principal": 100000,
                "current_value": 107100,
                "interest_rate": 7.1,
                "tenure_months": 24,
                "start_date": "2024-01-15",
                "maturity_date": "2026-01-15",
                "maturity_amount": 114490,
                "interest_payout": "On Maturity",
                "is_tax_saver": True,
                "card_color": "#22409A"
            },
            {
                "id": "fd_2",
                "bank": "Sample Bank",
                "type": "Fixed Deposit",
                "fd_number": "FD-XXXX2222",
                "principal": 150000,
                "current_value": 158750,
                "interest_rate": 7.25,
                "tenure_months": 36,
                "start_date": "2024-03-20",
                "maturity_date": "2027-03-20",
                "maturity_amount": 186456,
                "interest_payout": "Quarterly",
                "is_tax_saver": False,
                "card_color": "#004C8F"
            },
            {
                "id": "fd_3",
                "bank": "Post Office",
                "type": "Time Deposit",
                "fd_number": "POTD-XXXX3333",
                "principal": 50000,
                "current_value": 53850,
                "interest_rate": 7.5,
                "tenure_months": 60,
                "start_date": "2023-06-01",
                "maturity_date": "2028-06-01",
                "maturity_amount": 72102,
                "interest_payout": "Annually",
                "is_tax_saver": True,
                "card_color": "#DC2626"
            }
        ],
        "recurring_deposits": [
            {
                "id": "rd_1",
                "bank": "Sample Bank",
                "type": "Recurring Deposit",
                "rd_number": "RD-XXXX4444",
                "monthly_amount": 5000,
                "total_deposited": 30000,
                "current_value": 31250,
                "interest_rate": 6.75,
                "tenure_months": 24,
                "installments_paid": 6,
                "remaining_installments": 18,
                "start_date": "2024-07-01",
                "maturity_date": "2026-07-01",
                "maturity_amount": 128456,
                "card_color": "#004C8F"
            },
            {
                "id": "rd_2",
                "bank": "Post Office",
                "type": "RD Account",
                "rd_number": "PORD-XXXX5555",
                "monthly_amount": 2000,
                "total_deposited": 24000,
                "current_value": 25200,
                "interest_rate": 6.7,
                "tenure_months": 60,
                "installments_paid": 12,
                "remaining_installments": 48,
                "start_date": "2024-01-01",
                "maturity_date": "2029-01-01",
                "maturity_amount": 143256,
                "card_color": "#DC2626"
            }
        ],
        "ppf_account": {
            "id": "ppf_1",
            "account_number": "PPF-XXXX6666",
            "bank": "Sample Bank",
            "balance": 450000,
            "this_year_deposit": 50000,
            "max_yearly_deposit": 150000,
            "interest_rate": 7.1,
            "maturity_year": 2035,
            "lock_in_remaining_years": 8,
            "card_color": "#059669"
        },
        "sukanya_samriddhi": None,
        "nps_account": {
            "id": "nps_1",
            "pran_number": "XXXX7777XXXX",
            "fund_manager": "HDFC Pension",
            "total_corpus": 280000,
            "equity_allocation": 75,
            "debt_allocation": 25,
            "returns_ytd": 14.5,
            "card_color": "#7C3AED"
        }
    }

@router.post("/accounts/add")
async def add_account(data: dict):
    """Add a new account manually"""
    user_id = data.get("user_id")
    account_type = data.get("account_type")  # bank, post_office, fd, rd
    account_data = data.get("account_data", {})
    
    account_id = str(uuid.uuid4())
    account_data["account_type"] = account_type
    account_data["id"] = account_id
    account_data["user_id"] = user_id
    account_data["added_manually"] = True
    account_data["created_at"] = datetime.utcnow()
    
    await db.manual_accounts.insert_one(account_data)
    
    return {
        "status": "success",
        "account_id": account_id,
        "message": "Account added successfully!"
    }

@router.get("/investments/portfolio/{user_id}")
async def get_investment_portfolio(user_id: str):
    """Get complete investment portfolio (sample data; real holdings need an AA or depository link)"""
    if not settings.demo_mode:
        raise HTTPException(status_code=503, detail="Investment tracking opens once our Account Aggregator partner is connected.")
    return {
        "total_value": 970000,
        "total_invested": 850000,
        "total_returns": 120000,
        "returns_percentage": 14.12,
        "xirr": 15.8,
        "mutual_funds": {
            "total_value": 450000,
            "invested": 380000,
            "returns": 70000,
            "funds": [
                {
                    "id": "mf_1",
                    "name": "Sample Large Cap Fund",
                    "category": "Large Cap",
                    "invested": 150000,
                    "current_value": 180000,
                    "units": 1234.56,
                    "nav": 145.82,
                    "returns_pct": 20.0,
                    "sip_amount": 5000,
                    "sip_date": 5,
                    "rating": 5
                },
                {
                    "id": "mf_2",
                    "name": "Sample Mid Cap Fund",
                    "category": "Mid Cap",
                    "invested": 120000,
                    "current_value": 150000,
                    "units": 789.12,
                    "nav": 190.08,
                    "returns_pct": 25.0,
                    "sip_amount": 3000,
                    "sip_date": 10,
                    "rating": 4
                },
                {
                    "id": "mf_3",
                    "name": "Sample Small Cap Fund",
                    "category": "Small Cap",
                    "invested": 110000,
                    "current_value": 120000,
                    "units": 567.89,
                    "nav": 211.30,
                    "returns_pct": 9.1,
                    "sip_amount": 2000,
                    "sip_date": 15,
                    "rating": 4
                }
            ]
        },
        "stocks": {
            "total_value": 320000,
            "invested": 280000,
            "returns": 40000,
            "holdings": [
                {
                    "id": "stk_1",
                    "symbol": "SAMPLE1",
                    "name": "Sample Energy Ltd",
                    "quantity": 50,
                    "avg_price": 2200,
                    "current_price": 2900,
                    "invested": 110000,
                    "current_value": 145000,
                    "returns_pct": 31.82,
                    "day_change": 1.2
                },
                {
                    "id": "stk_2",
                    "symbol": "SAMPLE2",
                    "name": "Sample IT Services Ltd",
                    "quantity": 30,
                    "avg_price": 3200,
                    "current_price": 3500,
                    "invested": 96000,
                    "current_value": 105000,
                    "returns_pct": 9.38,
                    "day_change": -0.5
                },
                {
                    "id": "stk_3",
                    "symbol": "SAMPLE3",
                    "name": "Sample Bank Ltd",
                    "quantity": 40,
                    "avg_price": 1600,
                    "current_price": 1750,
                    "invested": 64000,
                    "current_value": 70000,
                    "returns_pct": 9.38,
                    "day_change": 0.8
                }
            ]
        },
        "gold": {
            "total_value": 200000,
            "invested": 190000,
            "grams": 32.5,
            "current_price_per_gram": 6154,
            "returns_pct": 5.26
        }
    }
