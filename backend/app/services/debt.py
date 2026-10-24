from datetime import datetime, timedelta
from typing import Dict, List

from ..models import DebtStrategy

MAX_MONTHS = 360  # plan 30 years at most


def calculate_debt_payoff(debts: List[Dict], strategy: DebtStrategy, extra_payment: float = 0) -> Dict:
    """Calculate debt payoff timeline using snowball or avalanche strategy
    
    SNOWBALL: Pay minimum on all, throw extra at SMALLEST ORIGINAL balance first
    AVALANCHE: Pay minimum on all, throw extra at HIGHEST interest rate first
    
    Key fix: Sort once at the beginning based on strategy, then apply freed-up payments 
    to the next debt in the priority order as each debt is paid off.
    """
    if not debts:
        return {"total_months": 0, "total_interest": 0, "payoff_order": [], "monthly_breakdown": []}
    
    # Create working copies with balance tracking
    working_debts = []
    for d in debts:
        working_debts.append({
            'name': d['name'],
            'balance': float(d['outstanding']),
            'interest_rate': float(d['interest_rate']),
            'emi_amount': float(d['emi_amount']),
            'original_balance': float(d['outstanding']),
            'paid_off': False
        })
    
    # CRITICAL: Sort debts ONCE at the beginning based on strategy
    # This determines the PRIORITY ORDER for the entire payoff journey
    if strategy == DebtStrategy.SNOWBALL:
        # Snowball: Sort by ORIGINAL balance (smallest first) for psychological wins
        working_debts.sort(key=lambda x: x['original_balance'])
    else:  # AVALANCHE
        # Avalanche: Sort by interest rate (highest first) to save the most money
        working_debts.sort(key=lambda x: x['interest_rate'], reverse=True)
    
    total_months = 0
    total_interest = 0
    payoff_order = []
    monthly_breakdown = []
    
    # Track freed-up EMIs from paid-off debts (snowball/avalanche effect)
    freed_up_payment = 0
    
    # Continue until all debts are paid, or the 30-year horizon runs out
    while any(not d['paid_off'] for d in working_debts) and total_months < MAX_MONTHS:
        total_months += 1
        month_data = {"month": total_months, "payments": [], "remaining_total": 0}
        
        # Step 1: Apply interest to all active debts
        for debt in working_debts:
            if not debt['paid_off'] and debt['balance'] > 0:
                monthly_interest = (debt['balance'] * debt['interest_rate']) / (12 * 100)
                debt['balance'] += monthly_interest
                total_interest += monthly_interest
        
        # Step 2: Pay minimum EMI on all active debts. An EMI bigger than what's left
        # pays the balance off and the rest of it joins this month's extra pool.
        unused_emi = 0.0
        for debt in working_debts:
            if not debt['paid_off'] and debt['balance'] > 0:
                payment = min(debt['emi_amount'], debt['balance'])
                debt['balance'] -= payment
                unused_emi += debt['emi_amount'] - payment
                month_data['payments'].append({"name": debt['name'], "payment": round(payment, 2), "type": "emi"})
        
        # Step 3: Apply extra + freed-up payments in priority order. Whatever clears one debt
        # rolls on to the next instead of being thrown away.
        total_extra = extra_payment + freed_up_payment + unused_emi
        for debt in working_debts:
            if total_extra <= 0:
                break
            if not debt['paid_off'] and debt['balance'] > 0:
                extra_to_apply = min(total_extra, debt['balance'])
                debt['balance'] -= extra_to_apply
                total_extra -= extra_to_apply
                if extra_to_apply > 0:
                    month_data['payments'].append({"name": debt['name'], "payment": round(extra_to_apply, 2), "type": "extra"})
        
        # Step 4: Check for any debts that just got paid off
        for debt in working_debts:
            if not debt['paid_off'] and debt['balance'] <= 0.01:
                payoff_order.append({
                    "name": debt['name'],
                    "months_to_payoff": total_months,
                    "interest_rate": debt['interest_rate'],
                    "original_balance": debt['original_balance']
                })
                debt['paid_off'] = True
                # Add this debt's EMI to the freed-up payment pool (snowball/avalanche effect)
                freed_up_payment += debt['emi_amount']
                debt['balance'] = 0
        
        month_data['remaining_total'] = round(sum(max(0, d['balance']) for d in working_debts if not d['paid_off']), 2)
        monthly_breakdown.append(month_data)
    
    # When payments don't outrun interest, there is no debt-free date to promise.
    pays_off = all(d['paid_off'] for d in working_debts)
    return {
        "total_months": total_months,
        "total_interest": round(total_interest, 2),
        "payoff_order": payoff_order,
        "pays_off": pays_off,
        "debt_free_date": (datetime.utcnow() + timedelta(days=total_months * 30)).strftime("%B %Y") if pays_off else None,
        "strategy": strategy.value,
        "strategy_description": "Smallest balance first (quick wins)" if strategy == DebtStrategy.SNOWBALL else "Highest interest first (saves most money)"
    }
