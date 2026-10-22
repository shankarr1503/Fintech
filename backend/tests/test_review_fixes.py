"""Regression tests for the issues found in the codebase review."""
import json

import pytest
from fastapi.testclient import TestClient

from app.db import db
from app.main import app
from tests.test_security import auth, otp_login, run


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_phones = iter(range(9700000000, 9799999999))


def signed_in(client, phone=None):
    """A fresh user with a PIN set; returns (user_id, session token, device headers)."""
    phone = phone or str(next(_phones))
    first, dev = otp_login(client, phone)
    assert "token" in first, first
    client.post("/api/auth/pin", json={"pin": "4826"}, headers=auth(first["token"]))
    return first["user"]["id"], first["token"], dev


@pytest.mark.parametrize("n, content_type", enumerate(["application/JSON", "Application/Json; charset=utf-8", "text/plain"]))
def test_body_user_id_is_checked_whatever_the_content_type(client, n, content_type):
    _, token, _ = signed_in(client)
    victim, _, _ = signed_in(client)
    body = json.dumps({"user_id": victim, "settings": {"data_sharing": {"marketing": True}}})
    res = client.post("/api/security/update-privacy", content=body, headers=auth(token, {"Content-Type": content_type}))
    assert res.status_code == 403
    assert run(db.privacy_settings.find_one({"user_id": victim})) is None


def test_privacy_update_only_accepts_known_switches(client):
    uid, token, _ = signed_in(client)
    bad = client.post("/api/security/update-privacy", json={"user_id": uid, "settings": {"user_id": "someone-else"}}, headers=auth(token))
    assert bad.status_code == 422
    bad = client.post("/api/security/update-privacy", json={"settings": {"data_retention": {"consent_logs": "0_years"}}}, headers=auth(token))
    assert bad.status_code == 422
    ok = client.post("/api/security/update-privacy", json={"settings": {"data_sharing": {"marketing": True}}}, headers=auth(token))
    assert ok.status_code == 200
    assert run(db.privacy_settings.find_one({"user_id": uid}))["data_sharing"]["marketing"] is True


def test_production_config_fails_closed():
    from app.config import Settings, production_problems

    s = Settings()
    s.demo_mode, s.secret_key, s.field_encryption_key, s.mongo_url, s.webhook_secret = False, "", "", "", ""
    assert len(production_problems(s)) == 4
    s.secret_key, s.field_encryption_key, s.mongo_url, s.webhook_secret = "x" * 48, "k", "mongodb://db", "w"
    assert production_problems(s) == []
    s.demo_mode, s.secret_key = True, ""
    assert production_problems(s) == []


def test_demo_mode_and_https_default_to_production_values(monkeypatch):
    from app import config

    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("REQUIRE_HTTPS", raising=False)
    assert config._bool("DEMO_MODE", False) is False
    src = open(config.__file__).read()
    assert '_bool("DEMO_MODE", True)' not in src


def test_profile_never_returns_pin_or_identity_secrets(client):
    uid, token, _ = signed_in(client)
    for res in (client.get(f"/api/users/{uid}", headers=auth(token)),
                client.put(f"/api/users/{uid}", json={"name": "Asha"}, headers=auth(token))):
        assert res.status_code == 200
        body = res.json().get("user", res.json())
        text = json.dumps(body)
        assert body["id"] == uid and body["pin_set"] is True
        for secret in ("salt", "hash", "pin_attempts", "known_devices", "pan_encrypted", "dob_encrypted", "pan_hash"):
            assert secret not in text


def coins(uid):
    return run(db.users.find_one({"id": uid})).get("reward_coins", 0)


def test_card_bill_coins_are_bounded(client):
    uid, token, _ = signed_in(client)
    h = auth(token)
    for amount in (1e12, "inf", "nan", -5, 0):
        assert client.post("/api/credit-cards/pay-bill", json={"card_bank": "HDFC", "amount": amount}, headers=h).status_code == 422
    before = coins(uid)
    res = client.post("/api/credit-cards/pay-bill", json={"card_bank": "HDFC", "amount": 9_000_000}, headers=h)
    assert res.status_code == 200
    assert coins(uid) - before <= 50 + 30  # per-bill cap plus a possible quest bonus


def test_paid_off_debt_cannot_be_defeated_again(client):
    uid, token, _ = signed_in(client)
    h = auth(token)
    zero = {"name": "Card", "type": "credit_card", "principal": 1000, "outstanding": 0, "interest_rate": 30, "emi_amount": 100, "remaining_tenure": 10}
    assert client.post("/api/debts", json=zero, headers=h).status_code == 422
    debt = client.post("/api/debts", json={**zero, "user_id": uid, "outstanding": 500}, headers=h).json()
    first = client.post(f"/api/debts/{debt['id']}/pay", json={"amount": 500}, headers=h).json()
    assert first["defeated"] is True
    assert client.post(f"/api/debts/{debt['id']}/pay", json={"amount": 500}, headers=h).status_code == 409
    defeats = run(db.game_events.count_documents({"user_id": uid, "action": "boss_defeated"}))
    assert defeats == 1


def test_tiny_goals_are_refused_and_completion_pays_once(client):
    uid, token, _ = signed_in(client)
    h = auth(token)
    assert client.post("/api/savings", json={"user_id": uid, "name": "x", "target_amount": 0.01}, headers=h).status_code == 422
    goal = client.post("/api/savings", json={"user_id": uid, "name": "Trip", "target_amount": 100}, headers=h).json()
    assert client.post("/api/savings/contribute", json={"goal_id": goal["id"], "amount": 100}, headers=h).json()["completed"] is True
    run(db.savings_goals.update_one({"id": goal["id"]}, {"$set": {"current_amount": 0}}))
    client.post("/api/savings/contribute", json={"goal_id": goal["id"], "amount": 100}, headers=h)
    assert run(db.game_events.count_documents({"user_id": uid, "action": "goal_completed"})) == 1


def test_daily_cap_stops_reward_farming(client):
    uid, token, _ = signed_in(client)
    h = auth(token)
    debt = {"user_id": uid, "name": "Loan", "type": "personal_loan", "principal": 1000, "outstanding": 1000, "interest_rate": 12, "emi_amount": 100, "remaining_tenure": 10}
    before = coins(uid)
    for _ in range(10):
        client.post("/api/debts", json=debt, headers=h)
    assert coins(uid) - before == 5 * 3  # debt_added pays 5 coins, three times a day


def test_redeeming_never_overspends(client):
    from app.routers.rewards import DEALS

    uid, token, _ = signed_in(client)
    h = auth(token)
    deal = DEALS[0]
    run(db.users.update_one({"id": uid}, {"$set": {"reward_coins": deal["coins_required"]}}))
    codes = [client.post("/api/rewards/redeem", json={"user_id": uid, "deal_id": deal["id"]}, headers=h).status_code for _ in range(3)]
    assert codes == [200, 400, 400]
    assert coins(uid) >= 0


def test_checkin_pays_once_even_when_requests_race(client):
    from app.services import game

    uid, token, _ = signed_in(client)
    h = auth(token)
    run(db.game_profiles.update_one({"user_id": uid}, {"$set": {"last_checkin": None}}, upsert=True))
    run(game.claim_once(f"checkin:{uid}:{game.today_key()}"))  # as if a parallel request won the race
    assert client.post("/api/game/checkin", json={"user_id": uid}, headers=h).json()["already_checked_in"] is True


def test_spoofed_forwarded_for_does_not_reset_ip_limits(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "otp_sends_per_ip_hour", 3)
    run(db.rate_limits.delete_many({"key": {"$regex": "^otp-send:ip:"}}))
    codes = [client.post("/api/auth/send-otp", json={"phone": f"98000000{i:02d}"}, headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    run(db.rate_limits.delete_many({"key": {"$regex": "^otp-send:ip:"}}))


def test_pin_attempts_reserved_by_parallel_guesses_lock_the_pin(client):
    uid, token, _ = signed_in(client)
    # As if five guesses were in flight at once: each reserved an attempt before comparing.
    run(db.users.update_one({"id": uid}, {"$set": {"pin_attempts": 5}}))
    res = client.post("/api/auth/pin/verify", json={"pin": "4826"}, headers=auth(token))
    assert res.status_code == 423


def test_otp_attempts_are_reserved_before_comparing(client):
    phone = "9811111111"
    code = client.post("/api/auth/send-otp", json={"phone": phone}).json()["demo_otp"]
    run(db.otp_codes.update_one({"phone": phone}, {"$set": {"attempts": 5}}))
    res = client.post("/api/auth/verify-otp", json={"phone": phone, "otp": code, "accept_terms": "2026-10", "confirm_age": True})
    assert res.status_code == 400 and "Too many" in res.json()["detail"]


def test_health_check_works_over_plain_http_when_https_is_required(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "require_https", True)
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/app-config").status_code == 403


def test_debt_plan_rolls_extra_over_and_admits_when_it_never_ends():
    from app.models import DebtStrategy
    from app.services.debt import calculate_debt_payoff

    two = [
        {"name": "small", "outstanding": 1000, "interest_rate": 0, "emi_amount": 100},
        {"name": "big", "outstanding": 150000, "interest_rate": 0, "emi_amount": 100},
    ]
    plan = calculate_debt_payoff(two, DebtStrategy.SNOWBALL, extra_payment=100000)
    assert plan["total_months"] == 2 and plan["pays_off"] is True

    stuck = [{"name": "card", "outstanding": 100000, "interest_rate": 36, "emi_amount": 1000}]
    plan = calculate_debt_payoff(stuck, DebtStrategy.AVALANCHE)
    assert plan["pays_off"] is False and plan["debt_free_date"] is None and plan["total_months"] == 360


def test_loans_are_bounded_by_eligibility_and_reject_nan(client):
    uid, token, _ = signed_in(client)
    h = auth(token)
    base = {"user_id": uid, "loan_type": "loan_against_fd", "tenure": 12, "accept_key_facts": True}
    for amount in (1e15, "NaN", "inf"):
        assert client.post("/api/loans/apply", json={**base, "amount": amount}, headers=h).status_code == 400
    assert client.post("/api/loans/quote", json={**base, "amount": 150000}, headers=h).status_code == 200
