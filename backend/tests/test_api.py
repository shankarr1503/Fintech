"""End-to-end API tests against the in-memory database (no MongoDB needed)."""
import os

os.environ["MONGO_URL"] = ""
os.environ["DEMO_MODE"] = "true"
os.environ["OPENAI_API_KEY"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import game  # noqa: E402
from app.services.debt import calculate_debt_payoff  # noqa: E402
from app.models import DebtStrategy  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def sign_in(client, phone):
    sent = client.post("/api/auth/send-otp", json={"phone": phone}).json()
    assert len(sent["demo_otp"]) == 6
    res = client.post("/api/auth/verify-otp", json={"phone": phone, "otp": sent["demo_otp"], "accept_terms": "2026-10", "confirm_age": True})
    assert res.status_code == 200
    body = res.json()
    headers = {"Authorization": f"Bearer {body['token']}"}
    # The app makes new users set a PIN before anything else; the API enforces it.
    assert client.post("/api/auth/pin", json={"pin": "4826"}, headers=headers).status_code == 200
    return body["user"], headers


@pytest.fixture(scope="module")
def user(client):
    user, headers = sign_in(client, "9876543210")
    client.headers.update(headers)  # every request below acts as this user
    return user


@pytest.fixture(scope="module")
def rival(client, user):
    """A second account, used to prove one user can't touch another's data."""
    rival, headers = sign_in(client, "9123456789")
    return {**rival, "headers": headers}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "healthy"


def test_wrong_otp_rejected(client, user):
    res = client.post("/api/auth/verify-otp", json={"phone": "9876543210", "otp": "000000"})
    assert res.status_code == 400


def test_dashboard_has_realistic_demo_data(client, user):
    dash = client.get(f"/api/dashboard/{user['id']}").json()
    assert dash["debts"]["count"] == 4
    assert dash["savings"]["goals_count"] == 1
    assert dash["recent_transactions"]
    assert "_id" not in dash["recent_transactions"][0]


def test_level_curve():
    assert game.level_for_xp(0) == 1
    assert game.level_for_xp(199) == 1
    assert game.level_for_xp(200) == 2
    assert game.level_for_xp(600) == 3
    assert game.world_for_level(5) == "2-1"


def test_checkin_is_once_per_day(client, user):
    first = client.post("/api/game/checkin", json={"user_id": user["id"]}).json()
    assert first["already_checked_in"] is False
    assert first["streak"] == 1
    assert first["reward"]["xp_earned"] > 0
    assert any(q["id"] == "q_checkin" for q in first["reward"]["quests_completed"])
    again = client.post("/api/game/checkin", json={"user_id": user["id"]}).json()
    assert again["already_checked_in"] is True


def test_upi_payment_awards_coins_and_achievement(client, user):
    before = client.get(f"/api/game/profile/{user['id']}").json()
    res = client.post("/api/upi/send-money", json={
        "user_id": user["id"], "recipient_upi": "rahul@paytm", "amount": 500, "note": "", "source_account": "upi_1",
    }).json()
    assert res["coins_earned"] == 10
    assert res["reward"]["xp_earned"] >= 20
    assert any(a["id"] == "first_coin" for a in res["reward"]["new_achievements"])
    after = client.get(f"/api/game/profile/{user['id']}").json()
    assert after["xp"] > before["xp"]
    assert after["coins"] > before["coins"]


@pytest.mark.parametrize("amount", [0, -5, 500000])
def test_upi_rejects_bad_amounts(client, user, amount):
    res = client.post("/api/upi/send-money", json={
        "user_id": user["id"], "recipient_upi": "rahul@paytm", "amount": amount,
    })
    assert res.status_code == 422


def test_bill_can_only_be_paid_once_per_month(client, user):
    ok = client.post("/api/bills/pay", json={"user_id": user["id"], "bill_id": "bill_mobile"})
    assert ok.status_code == 200
    assert ok.json()["coins_earned"] == 7
    dup = client.post("/api/bills/pay", json={"user_id": user["id"], "bill_id": "bill_mobile"})
    assert dup.status_code == 400
    bills = client.get(f"/api/bills/{user['id']}").json()
    assert next(b for b in bills if b["id"] == "bill_mobile")["status"] == "paid"


def test_redeem_uses_server_price(client, user):
    # Client claims the deal is free; server must still charge 5,000 coins.
    res = client.post("/api/rewards/redeem", json={"user_id": user["id"], "deal_id": "v_shop_500", "coins_required": 0})
    assert res.status_code == 400
    assert res.json()["detail"] == "Insufficient coins"


def test_debt_boss_battle(client, user):
    created = client.post("/api/debts", json={
        "user_id": user["id"], "name": "Tiny Boss", "type": "other", "principal": 1000,
        "outstanding": 1000, "interest_rate": 10, "emi_amount": 100, "remaining_tenure": 10,
    }).json()
    hit = client.post(f"/api/debts/{created['id']}/pay", json={"amount": 400}).json()
    assert hit["outstanding"] == 600 and not hit["defeated"]
    final = client.post(f"/api/debts/{created['id']}/pay", json={"amount": 9999}).json()
    assert final["paid"] == 600
    assert final["defeated"] is True
    assert any(a["id"] == "boss_slayer" for a in final["reward"]["new_achievements"])


def test_savings_goal_completion(client, user):
    goal = client.post("/api/savings", json={"user_id": user["id"], "name": "Switch", "target_amount": 1000}).json()
    res = client.post("/api/savings/contribute", json={"goal_id": goal["id"], "amount": 1000}).json()
    assert res["completed"] is True
    assert res["reward"]["action"] == "goal_completed"
    assert client.post("/api/savings/contribute", json={"goal_id": goal["id"], "amount": -5}).status_code == 422


def test_game_profile(client, user):
    profile = client.get(f"/api/game/profile/{user['id']}").json()
    assert len(profile["quests"]) == 3
    assert profile["checked_in_today"] is True
    assert 0 <= profile["progress"] <= 100
    # No invented players to compete against.
    assert client.get(f"/api/game/leaderboard/{user['id']}").status_code == 404


def test_avalanche_never_costs_more_interest_than_snowball():
    debts = [
        {"name": "A", "outstanding": 15000, "interest_rate": 12, "emi_amount": 2000},
        {"name": "B", "outstanding": 65000, "interest_rate": 36, "emi_amount": 5000},
        {"name": "C", "outstanding": 48000, "interest_rate": 0, "emi_amount": 8000},
    ]
    snow = calculate_debt_payoff(debts, DebtStrategy.SNOWBALL, 3000)
    ava = calculate_debt_payoff(debts, DebtStrategy.AVALANCHE, 3000)
    assert ava["total_interest"] <= snow["total_interest"]
    assert snow["payoff_order"][0]["name"] == "A"


def test_every_feature_endpoint_responds(client, user):
    uid = user["id"]
    for path in [
        f"/api/transactions/{uid}", f"/api/analytics/summary/{uid}", f"/api/analytics/insights/{uid}",
        f"/api/analytics/expense-reduction/{uid}", f"/api/debts/analysis/{uid}", f"/api/savings/suggestions/{uid}",
        f"/api/credit-score/{uid}", f"/api/rewards/{uid}", "/api/learn/courses",
        f"/api/learn/progress/{uid}", f"/api/aa/consent-status/{uid}",
        f"/api/security/audit-log/{uid}", f"/api/security/privacy-settings/{uid}", "/api/compliance/rbi-info",
        f"/api/upi/linked-accounts/{uid}", f"/api/upi/recent-payees/{uid}", f"/api/upi/transaction-history/{uid}",
        f"/api/loans/eligibility/{uid}", f"/api/loans/active/{uid}", f"/api/accounts/all/{uid}",
        f"/api/investments/portfolio/{uid}", f"/api/users/{uid}", f"/api/users/{uid}/security",
    ]:
        assert client.get(path).status_code == 200, path


def test_upi_balances_are_stable_per_user(client, user):
    first = client.get(f"/api/upi/linked-accounts/{user['id']}").json()
    second = client.get(f"/api/upi/linked-accounts/{user['id']}").json()
    assert first == second


def test_requests_without_token_are_rejected(client, user):
    for path in [f"/api/dashboard/{user['id']}", f"/api/game/profile/{user['id']}", f"/api/debts/{user['id']}"]:
        assert client.get(path, headers={"Authorization": ""}).status_code == 401
    assert client.get(f"/api/dashboard/{user['id']}", headers={"Authorization": "Bearer forged.token.value"}).status_code == 401


def test_public_catalogue_needs_no_token(client):
    for path in ["/api/learn/courses", "/api/compliance/rbi-info", "/api/health", "/api/app-config"]:
        assert client.get(path, headers={"Authorization": ""}).status_code == 200, path


def test_cannot_read_or_act_as_another_user(client, user, rival):
    other = rival["headers"]
    assert client.get(f"/api/dashboard/{user['id']}", headers=other).status_code == 403
    assert client.get(f"/api/transactions/{user['id']}", headers=other).status_code == 403
    res = client.post("/api/upi/send-money", headers=other, json={
        "user_id": user["id"], "recipient_upi": "thief@upi", "amount": 500,
    })
    assert res.status_code == 403
    assert client.request("DELETE", f"/api/users/{user['id']}", headers=other, json={"user_id": user["id"]}).status_code == 403


def test_cannot_touch_another_users_debts_or_goals(client, user, rival):
    other = rival["headers"]
    debt = client.get(f"/api/debts/{user['id']}").json()[0]
    assert client.post(f"/api/debts/{debt['id']}/pay", headers=other, json={"amount": 100}).status_code == 404
    assert client.delete(f"/api/debts/{debt['id']}", headers=other).status_code == 404
    goal = client.get(f"/api/savings/{user['id']}").json()[0]
    assert client.post("/api/savings/contribute", headers=other, json={"goal_id": goal["id"], "amount": 10}).status_code == 404
    assert client.delete(f"/api/savings/{goal['id']}", headers=other).status_code == 404
    # ...and the owner still can
    assert client.post(f"/api/debts/{debt['id']}/pay", json={"amount": 100}).status_code == 200


def test_otp_locks_after_five_wrong_guesses(client):
    phone = "9000000001"
    code = client.post("/api/auth/send-otp", json={"phone": phone}).json()["demo_otp"]
    wrong = "000000" if code != "000000" else "111111"
    for left in (4, 3, 2, 1):
        res = client.post("/api/auth/verify-otp", json={"phone": phone, "otp": wrong, "accept_terms": "2026-10", "confirm_age": True})
        assert res.json()["detail"] == f"Wrong code. {left} attempt{'s' if left != 1 else ''} left."
    assert "Too many wrong codes" in client.post("/api/auth/verify-otp", json={"phone": phone, "otp": wrong, "accept_terms": "2026-10", "confirm_age": True}).json()["detail"]
    # The real code is now burned too
    assert client.post("/api/auth/verify-otp", json={"phone": phone, "otp": code, "accept_terms": "2026-10", "confirm_age": True}).status_code == 400


def test_unknown_phone_gets_same_error_as_wrong_code(client):
    res = client.post("/api/auth/verify-otp", json={"phone": "9000000099", "otp": "123456"})
    assert res.status_code == 400 and res.json()["detail"] == "Invalid or expired code"


def test_otp_sends_are_rate_limited(client):
    phone = "9000000002"
    for _ in range(3):
        assert client.post("/api/auth/send-otp", json={"phone": phone}).status_code == 200
    res = client.post("/api/auth/send-otp", json={"phone": phone})
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) > 0


@pytest.mark.parametrize("body", [{"phone": "12345"}, {"phone": "abcdefghij"}, {"phone": "5123456789"}])
def test_bad_phone_numbers_rejected(client, body):
    assert client.post("/api/auth/send-otp", json=body).status_code == 422


def test_otp_is_not_stored_in_plain_text(client):
    import asyncio
    from app.db import db

    phone = "9000000003"
    code = client.post("/api/auth/send-otp", json={"phone": phone}).json()["demo_otp"]
    doc = asyncio.run(db.otp_codes.find_one({"phone": phone}))
    assert code not in str(doc.values())


def test_logout_revokes_token(client):
    _, headers = sign_in(client, "9000000004")
    me = client.get("/api/game/profile/x", headers=headers)  # 403: wrong user, but token accepted
    assert me.status_code == 403
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/game/profile/x", headers=headers).status_code == 401


def test_payments_are_rate_limited(client):
    payer, headers = sign_in(client, "9000000005")
    codes = [
        client.post("/api/upi/send-money", headers=headers, json={"user_id": payer["id"], "recipient_upi": "rahul@paytm", "amount": i + 1}).status_code
        for i in range(11)
    ]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_loan_application_needs_key_facts_accepted(client, user):
    q = client.post("/api/loans/quote", json={"loan_type": "personal_loan", "amount": 100000, "tenure": 12}).json()
    # The fee and its GST come out of the money received, so APR is above the headline rate.
    assert q["net_disbursal"] == 100000 - q["processing_fee"] - q["gst_on_fee"]
    assert q["apr"] > q["interest_rate"] and q["total_repayable"] > 100000 and q["cooling_off_days"] >= 1
    body = {"user_id": user["id"], "loan_type": "personal_loan", "amount": 100000, "tenure": 12}
    assert client.post("/api/loans/apply", json=body).status_code == 400
    res = client.post("/api/loans/apply", json={**body, "accept_key_facts": True}).json()
    assert res["status"] == "submitted" and "approved" not in res["message"].lower() and "reward" not in res
    assert client.post("/api/loans/quote", json={"loan_type": "personal_loan", "amount": 100000, "tenure": 7}).status_code == 400


def test_lessons_have_content_and_award_once(client, user):
    courses = client.get("/api/learn/courses").json()
    assert all(l["body"] and "instructor" not in c and "rating" not in c for c in courses for l in c["lessons"])
    c = courses[0]
    first = client.post("/api/learn/complete-module", json={"user_id": user["id"], "course_id": c["id"], "module_id": "0"}).json()
    again = client.post("/api/learn/complete-module", json={"user_id": user["id"], "course_id": c["id"], "module_id": "0"}).json()
    assert first["xp_earned"] == 50 and again["xp_earned"] == 0
    assert client.post("/api/learn/complete-module", json={"user_id": user["id"], "course_id": "nope", "module_id": "0"}).status_code == 404


def test_no_sample_data_outside_demo_mode(client, user, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "demo_mode", False)
    uid = user["id"]
    assert client.get(f"/api/bills/{uid}").json() == []
    assert client.get(f"/api/upi/recent-payees/{uid}").json() == []
    assert client.get(f"/api/upi/linked-accounts/{uid}").json()["linked_accounts"] == []
    assert client.get(f"/api/accounts/all/{uid}").json()["bank_accounts"] == []
    assert all(l["id"] != "LN001" for l in client.get(f"/api/loans/active/{uid}").json())  # only real applications
    assert client.post(f"/api/transactions/mock-sync/{uid}").status_code == 404
    assert client.post("/api/rewards/redeem", json={"user_id": uid, "deal_id": "v_shop_50"}).status_code == 503
    assert client.get(f"/api/investments/portfolio/{uid}").status_code == 503
    assert client.post("/api/aa/initiate-consent", json={"user_id": uid}).status_code == 503
    assert client.post("/api/bills/pay", json={"user_id": uid, "bill_id": "bill_insurance"}).status_code == 503
    assert client.post("/api/credit-cards/pay-bill", json={"card_bank": "HDFC", "amount": 1000}).status_code == 503
    eligibility = client.get(f"/api/loans/eligibility/{uid}").json()["eligible_loan_types"]
    assert all(t["collateral_value"] == 0 for t in eligibility)
    assert client.get("/api/app-config").json()["demo_mode"] is False


def test_health_answers_head_for_reachability_checks(client):
    assert client.head("/api/health").status_code == 200
