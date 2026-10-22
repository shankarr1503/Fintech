"""Payments: states, idempotency, duplicates, step-up, KYC limits, AML, webhooks, reconciliation, outages."""
import asyncio
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import db
from app.main import app
from app.services import payments

ADMIN = {"X-Admin-Key": "test-admin-key"}
SECRET = "test-webhook-secret"
_phone = iter(range(9200000001, 9200009999))


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def run(coro):
    return asyncio.run(coro)


def new_user(client, kyc=False, pin="4826"):
    phone = str(next(_phone))
    code = client.post("/api/auth/send-otp", json={"phone": phone}).json()["demo_otp"]
    res = client.post("/api/auth/verify-otp", json={"phone": phone, "otp": code, "accept_terms": "2026-10", "confirm_age": True}).json()
    h = {"Authorization": f"Bearer {res['token']}"}
    assert client.post("/api/auth/pin", json={"pin": pin}, headers=h).status_code == 200
    uid = res["user"]["id"]
    if kyc:
        pan = "ABCP" + "E" + str(1000 + int(phone[-4:]) % 9000).zfill(4) + "F"
        r = client.post("/api/kyc/submit", json={"user_id": uid, "pan": pan, "full_name": "Test User", "dob": "1990-01-01", "consent": True}, headers=h)
        assert r.json()["status"] == "verified", r.json()
    return uid, h


def step_up(client, h, pin="4826"):
    return {**h, "X-Step-Up-Token": client.post("/api/auth/pin/verify", json={"pin": pin}, headers=h).json()["step_up_token"]}


def pay(client, uid, h, amount, to="rahul@paytm", key=None, **extra):
    headers = {**h, "Idempotency-Key": key} if key else h
    return client.post("/api/upi/send-money", json={"user_id": uid, "recipient_upi": to, "amount": amount, **extra}, headers=headers)


def webhook(client, event, ts=None, secret=SECRET):
    raw = json.dumps(event).encode()
    ts = str(ts or int(time.time()))
    sig = hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return client.post("/api/webhooks/upi", content=raw, headers={"X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json"})


# ---------------------------------------------------------------- idempotency & duplicates

def test_same_idempotency_key_returns_the_same_payment(client):
    uid, h = new_user(client)
    key = uuid.uuid4().hex
    first = pay(client, uid, h, 300, key=key)
    again = pay(client, uid, h, 300, key=key)
    assert first.status_code == again.status_code == 200
    assert first.json()["transaction_id"] == again.json()["transaction_id"]
    assert again.headers.get("Idempotent-Replayed") == "true"
    assert run(db.upi_transactions.count_documents({"user_id": uid})) == 1
    assert pay(client, uid, h, 301, key=key).status_code == 409  # same key, different payment
    assert client.get(f"/api/upi/idempotency/{key}", headers=h).json()["transaction_id"] == first.json()["transaction_id"]


def test_accidental_duplicate_needs_confirmation(client):
    uid, h = new_user(client)
    assert pay(client, uid, h, 250).status_code == 200
    dup = pay(client, uid, h, 250)
    assert dup.status_code == 409 and "a moment ago" in dup.json()["detail"]
    assert pay(client, uid, h, 250, confirm_duplicate=True).status_code == 200


# ---------------------------------------------------------------- step-up & KYC

def test_large_payments_need_a_fresh_pin(client):
    uid, h = new_user(client)
    res = pay(client, uid, h, 2500)
    assert res.status_code == 428
    assert pay(client, uid, step_up(client, h), 2500).status_code == 200


def test_unverified_users_have_small_limits_until_kyc(client):
    uid, h = new_user(client)
    over = pay(client, uid, step_up(client, h), 6000)
    assert over.status_code == 403 and "Complete KYC" in over.json()["detail"]
    status = client.get(f"/api/kyc/status/{uid}", headers=h).json()
    assert status["tier"] == "none" and status["limits"]["per_txn"] == 5000

    pan = "ABCPE7777F"
    r = client.post("/api/kyc/submit", json={"user_id": uid, "pan": pan, "full_name": "Asha  Rao", "dob": "1992-05-17", "consent": True}, headers=h).json()
    assert r == {"status": "verified", "reason": None, "masked_pan": "XXXXX7777F"}
    stored = run(db.users.find_one({"id": uid}))["kyc"]
    assert pan not in json.dumps(stored, default=str) and stored["pan_encrypted"].startswith("v1:")
    assert pay(client, uid, step_up(client, h), 6000).status_code == 200


@pytest.mark.parametrize(
    "body,code,msg",
    [
        ({"pan": "ABCDE1234F"}, 400, "individual PAN"),  # 4th letter must be P
        ({"pan": "ABCPE1234F", "dob": "2012-01-01"}, 400, "18 or older"),
        ({"pan": "ABCPE1234F", "consent": False}, 400, "consent"),
    ],
)
def test_kyc_validation(client, body, code, msg):
    uid, h = new_user(client)
    payload = {"user_id": uid, "pan": "ABCPE1234F", "full_name": "A Person", "dob": "1990-01-01", "consent": True, **body}
    res = client.post("/api/kyc/submit", json=payload, headers=h)
    assert res.status_code == code and msg in res.json()["detail"]


def test_kyc_name_mismatch_and_pan_reuse(client):
    uid, h = new_user(client)
    bad = client.post("/api/kyc/submit", json={"user_id": uid, "pan": "ABCPE1234X", "full_name": "A Person", "dob": "1990-01-01", "consent": True}, headers=h).json()
    assert bad["status"] == "failed" and "doesn't match" in bad["reason"]
    other, h2 = new_user(client)
    client.post("/api/kyc/submit", json={"user_id": other, "pan": "ABCPE5555F", "full_name": "B Person", "dob": "1990-01-01", "consent": True}, headers=h2)
    reuse = client.post("/api/kyc/submit", json={"user_id": uid, "pan": "ABCPE5555F", "full_name": "A Person", "dob": "1990-01-01", "consent": True}, headers=h)
    assert reuse.status_code == 409


# ---------------------------------------------------------------- AML

def test_structuring_pattern_is_held_for_review(client):
    uid, h = new_user(client, kyc=True)
    for i in range(2):
        assert pay(client, uid, step_up(client, h), 9500 + i, to=f"p{i}@okaxis").json()["status"] == "success"
    held = pay(client, uid, step_up(client, h), 9600, to="p9@okaxis")
    assert held.status_code == 202 and held.json()["status"] == "on_hold"
    alerts = client.get("/api/admin/aml/alerts", headers=ADMIN).json()
    assert any(a["user_id"] == uid and a["rules"][0]["rule"] == "structuring" for a in alerts)
    notes = client.get(f"/api/notifications/{uid}", headers=h).json()["items"]
    assert any(n["title"] == "Payment held for review" for n in notes)


def test_large_first_payment_to_new_payee_is_flagged_but_allowed(client):
    uid, h = new_user(client, kyc=True)
    res = pay(client, uid, step_up(client, h), 25000, to="newshop@okicici")
    assert res.json()["status"] == "success"
    alerts = client.get("/api/admin/aml/alerts", headers=ADMIN).json()
    assert any(a["user_id"] == uid and a["outcome"] == "review" for a in alerts)


# ---------------------------------------------------------------- states, webhooks, reconciliation

def test_declined_payment_is_failed_with_reason_and_no_coins(client):
    uid, h = new_user(client)
    res = pay(client, uid, h, 400, to="fail@coinquest").json()
    assert res["status"] == "failed" and "declined" in res["reason"]
    assert res["coins_earned"] == 0
    assert client.get(f"/api/upi/transactions/{res['transaction_id']}", headers=h).json()["status"] == "failed"


def test_pending_payment_settles_once_via_signed_webhook(client):
    uid, h = new_user(client)
    res = pay(client, uid, h, 600, to="pending@coinquest")
    assert res.status_code == 202 and res.json()["status"] == "pending"
    ref = res.json()["rail_ref"]
    event = {"event_id": uuid.uuid4().hex, "type": "payment.updated", "rail_ref": ref, "status": "success"}

    assert webhook(client, event, secret="wrong").status_code == 401
    assert webhook(client, event, ts=int(time.time()) - 3600).status_code == 400
    assert webhook(client, event).json()["applied"] is True
    assert webhook(client, event).json()["duplicate"] is True  # provider retry
    late = {**event, "event_id": uuid.uuid4().hex, "status": "failed"}
    assert webhook(client, late).json()["applied"] is False  # out of order: can't undo success

    txn = client.get(f"/api/upi/transactions/{res.json()['transaction_id']}", headers=h).json()
    assert txn["status"] == "success" and txn["coins_earned"] == 12
    notes = client.get(f"/api/notifications/{uid}", headers=h).json()["items"]
    assert sum(1 for n in notes if n["title"] == "₹600 paid") == 1


def test_timeout_stays_pending_then_reconciles(client):
    uid, h = new_user(client)
    res = pay(client, uid, h, 700, to="timeout@coinquest")
    assert res.status_code == 202 and res.json()["status"] == "pending"
    txn_id = res.json()["transaction_id"]
    run(db.upi_transactions.update_one({"id": txn_id}, {"$set": {"timestamp": datetime.utcnow() - timedelta(minutes=5)}}))
    assert client.post("/api/admin/payments/reconcile", headers=ADMIN).json()["settled"] >= 1
    assert client.get(f"/api/upi/transactions/{txn_id}", headers=h).json()["status"] == "success"


def test_rail_outage_trips_the_circuit_breaker(client):
    uid, h = new_user(client)
    try:
        for i in range(3):
            r = pay(client, uid, h, 100 + i, to="outage@coinquest")
            assert r.status_code == 503 and "haven't been charged" in r.json()["detail"]
        # Breaker open: even a healthy payee is refused fast, nothing is created.
        before = run(db.upi_transactions.count_documents({"user_id": uid}))
        assert pay(client, uid, h, 150).status_code == 503
        assert run(db.upi_transactions.count_documents({"user_id": uid})) == before
    finally:
        payments.breaker.success()
    assert pay(client, uid, h, 160).status_code == 200


def test_incoming_money_creates_credit_alert(client):
    uid, h = new_user(client)
    event = {"event_id": uuid.uuid4().hex, "type": "payment.received", "user_id": uid, "amount": 1500, "from": "priya@okaxis", "rail_ref": "998877"}
    assert webhook(client, event).status_code == 200
    notes = client.get(f"/api/notifications/{uid}", headers=h).json()["items"]
    assert any(n["kind"] == "credit" and "₹1,500" in n["title"] for n in notes)


def test_card_numbers_in_notes_are_masked(client):
    uid, h = new_user(client)
    res = pay(client, uid, h, 120, note="card 4111 1111 1111 1111 thx").json()
    stored = run(db.upi_transactions.find_one({"id": res["transaction_id"]}))
    assert "4111 1111" not in stored["note"] and "••••1111" in stored["note"]


def test_webhook_without_rail_ref_only_touches_the_named_payment(client):
    a, ha = new_user(client)
    b, hb = new_user(client)
    b_txn = pay(client, b, hb, 710, to="timeout@coinquest").json()["transaction_id"]
    a_txn = pay(client, a, ha, 720, to="timeout@coinquest").json()["transaction_id"]
    event = {"event_id": uuid.uuid4().hex, "type": "payment.updated", "txn_id": a_txn, "status": "failed"}
    assert webhook(client, event).json()["applied"] is True
    assert client.get(f"/api/upi/transactions/{a_txn}", headers=ha).json()["status"] == "failed"
    assert client.get(f"/api/upi/transactions/{b_txn}", headers=hb).json()["status"] == "pending"
    neither = {"event_id": uuid.uuid4().hex, "type": "payment.updated", "status": "success"}
    assert webhook(client, neither).status_code == 400


def test_failed_webhook_is_not_remembered_and_receipts_dedupe(client):
    uid, h = new_user(client)
    bad = {"event_id": uuid.uuid4().hex, "type": "payment.received", "user_id": uid, "amount": "nan", "rail_ref": "r-nan"}
    assert webhook(client, bad).status_code == 400
    fixed = {**bad, "amount": 250}
    assert webhook(client, fixed).json() == {"received": True}  # the retry is processed, not "duplicate"
    again = {**fixed, "event_id": uuid.uuid4().hex}
    assert webhook(client, again).json()["duplicate"] is True  # same rail_ref, new event id
    assert run(db.upi_transactions.count_documents({"rail_ref": "r-nan", "type": "upi_receive"})) == 1
