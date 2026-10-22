"""Sign-in security: MFA PIN, sessions, idle timeout, devices, audit trail, notifications."""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import db

ADMIN = {"X-Admin-Key": "test-admin-key"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def otp_login(client, phone, device="dev-1"):
    h = {"X-Device-Id": device, "X-Device-Name": f"Phone {device}"}
    code = client.post("/api/auth/send-otp", json={"phone": phone}).json()["demo_otp"]
    return client.post("/api/auth/verify-otp", json={"phone": phone, "otp": code, "accept_terms": "2026-10", "confirm_age": True}, headers=h).json(), h


def with_pin(client, first, pin="4826"):
    """Finish a first sign-in the way the app does: set the PIN before anything else."""
    assert client.post("/api/auth/pin", json={"pin": pin}, headers=auth(first["token"])).status_code == 200
    return first


def auth(token, extra=None):
    return {"Authorization": f"Bearer {token}", **(extra or {})}


def run(coro):
    return asyncio.run(coro)


def test_first_login_requires_setting_a_pin_then_pin_becomes_second_factor(client):
    first, dev = otp_login(client, "9100000001")
    assert first["pin_required"] is True and first["user"]["pin_set"] is False
    token = first["token"]
    assert client.post("/api/auth/pin", json={"pin": "1234"}, headers=auth(token)).json()["detail"] == "That PIN is too easy to guess"
    assert client.post("/api/auth/pin", json={"pin": "2345"}, headers=auth(token)).status_code == 400
    assert client.post("/api/auth/pin", json={"pin": "4826"}, headers=auth(token)).json() == {"pin_set": True}

    second, _ = otp_login(client, "9100000001")
    assert second.get("mfa_required") is True and "token" not in second
    bad = client.post("/api/auth/pin/login", json={"mfa_token": second["mfa_token"], "pin": "9999"}, headers=dev)
    assert bad.status_code == 403 and "4 attempts left" in bad.json()["detail"]
    ok = client.post("/api/auth/pin/login", json={"mfa_token": second["mfa_token"], "pin": "4826"}, headers=dev)
    assert ok.status_code == 200 and ok.json()["user"]["pin_set"] is True


def test_pin_locks_after_five_wrong_attempts(client):
    first, dev = otp_login(client, "9100000002")
    client.post("/api/auth/pin", json={"pin": "5937"}, headers=auth(first["token"]))
    mfa = otp_login(client, "9100000002")[0]["mfa_token"]
    codes = [client.post("/api/auth/pin/login", json={"mfa_token": mfa, "pin": "1111"}, headers=dev).status_code for _ in range(5)]
    assert codes == [403, 403, 403, 403, 423]
    still = client.post("/api/auth/pin/login", json={"mfa_token": mfa, "pin": "5937"}, headers=dev)
    assert still.status_code == 423  # even the right PIN is refused while locked


def test_otp_only_session_can_do_nothing_but_set_the_pin(client):
    first, _ = otp_login(client, "9100000010")
    uid, h = first["user"]["id"], auth(first["token"])
    assert client.get(f"/api/dashboard/{uid}", headers=h).status_code == 403
    assert client.post("/api/auth/pin", json={"pin": "4826"}, headers=h).status_code == 200
    assert client.get(f"/api/dashboard/{uid}", headers=h).status_code == 200


def test_step_up_token_confirms_one_payment_only(client):
    first = with_pin(client, otp_login(client, "9100000011")[0])
    uid, h = first["user"]["id"], auth(first["token"])
    run(db.users.update_one({"id": uid}, {"$set": {"kyc.status": "verified"}}))
    step = client.post("/api/auth/pin/verify", json={"pin": "4826"}, headers=h).json()["step_up_token"]
    body = {"user_id": uid, "recipient_upi": "rahul@paytm", "amount": 2500}
    assert client.post("/api/upi/send-money", json=body, headers={**h, "X-Step-Up-Token": step}).status_code == 200
    again = client.post("/api/upi/send-money", json={**body, "recipient_upi": "priya@okaxis"}, headers={**h, "X-Step-Up-Token": step})
    assert again.status_code == 428


def test_mfa_token_cannot_be_used_as_a_session(client):
    first, _ = otp_login(client, "9100000003")
    client.post("/api/auth/pin", json={"pin": "6084"}, headers=auth(first["token"]))
    mfa = otp_login(client, "9100000003")[0]["mfa_token"]
    assert client.get(f"/api/game/profile/{first['user']['id']}", headers=auth(mfa)).status_code == 401


def test_idle_sessions_time_out(client):
    first = with_pin(client, otp_login(client, "9100000004")[0])
    uid = first["user"]["id"]
    assert client.get(f"/api/game/profile/{uid}", headers=auth(first["token"])).status_code == 200
    run(db.sessions.update_many({"user_id": uid}, {"$set": {"last_seen": datetime.utcnow() - timedelta(minutes=16)}}))
    res = client.get(f"/api/game/profile/{uid}", headers=auth(first["token"]))
    assert res.status_code == 401 and "inactivity" in res.json()["detail"]


def test_new_device_alert_and_revoke_other_sessions(client):
    phone = "9100000005"
    first, _ = otp_login(client, phone, device="phone-a")
    uid = first["user"]["id"]
    client.post("/api/auth/pin", json={"pin": "7391"}, headers=auth(first["token"]))
    mfa = otp_login(client, phone, device="phone-b")[0]["mfa_token"]
    second = client.post("/api/auth/pin/login", json={"mfa_token": mfa, "pin": "7391"}, headers={"X-Device-Id": "phone-b", "X-Device-Name": "Pixel 9"}).json()
    notes = client.get(f"/api/notifications/{uid}", headers=auth(first["token"])).json()
    assert any(n["title"] == "New sign-in" and "Pixel 9" in n["body"] for n in notes["items"])
    sessions = client.get("/api/auth/sessions", headers=auth(first["token"])).json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    assert client.post("/api/auth/sessions/revoke-others", headers=auth(first["token"])).json()["revoked"] == 1
    assert client.get(f"/api/game/profile/{uid}", headers=auth(second["token"])).status_code == 401


def test_step_up_token_is_bound_to_the_session(client):
    first, _ = otp_login(client, "9100000006")
    client.post("/api/auth/pin", json={"pin": "8462"}, headers=auth(first["token"]))
    assert client.post("/api/auth/pin/verify", json={"pin": "0000"}, headers=auth(first["token"])).status_code == 403
    # ...and a wrong PIN must not end the session.
    assert client.get(f"/api/game/profile/{first['user']['id']}", headers=auth(first["token"])).status_code == 200
    step = client.post("/api/auth/pin/verify", json={"pin": "8462"}, headers=auth(first["token"])).json()
    assert step["step_up_token"] and step["expires_in"] == 300


def test_audit_chain_records_and_detects_tampering(client):
    first = with_pin(client, otp_login(client, "9100000007")[0])
    uid = first["user"]["id"]
    trail = client.get(f"/api/security/audit-log/{uid}", headers=auth(first["token"])).json()
    actions = [t["action"] for t in trail]
    assert "login" in actions and "login_otp_verified" in actions
    assert all("otp" not in str(t["details"]).lower() or "phone" in t["details"] for t in trail)
    assert client.get("/api/admin/audit/verify", headers=ADMIN).json()["ok"] is True
    assert client.get("/api/admin/audit/verify").status_code == 401
    # Tamper with an entry: the chain check must catch it.
    entry = run(db.audit_logs.find_one({"user_id": uid, "action": "login"}))
    run(db.audit_logs.update_one({"_id": entry["_id"]}, {"$set": {"details": {"device_id": "forged"}}}))
    result = client.get("/api/admin/audit/verify", headers=ADMIN).json()
    assert result["ok"] is False and result["broken_at"] == entry["seq"]
    run(db.audit_logs.update_one({"_id": entry["_id"]}, {"$set": {"details": entry["details"]}}))
    assert client.get("/api/admin/audit/verify", headers=ADMIN).json()["ok"] is True


def test_notification_preferences_keep_security_alerts_on(client):
    first = with_pin(client, otp_login(client, "9100000008")[0])
    uid = first["user"]["id"]
    res = client.put("/api/notifications/prefs", json={"user_id": uid, "prefs": {"security": False, "marketing": True, "rewards": False}}, headers=auth(first["token"])).json()
    assert res["prefs"]["security"] is True and res["prefs"]["marketing"] is True and res["prefs"]["rewards"] is False
    bad = client.post("/api/notifications/push-token", json={"user_id": uid, "token": "not-a-token"}, headers=auth(first["token"]))
    assert bad.status_code == 422


def test_public_compliance_info_makes_no_false_certification_claims(client):
    info = client.get("/api/compliance/rbi-info").json()
    assert info["certifications"] == []
    assert "PCI" not in str(info["controls"])


def test_forgot_pin_reset_needs_pan_for_kyc_users_and_cools_down(client):
    first, _ = otp_login(client, "9100000009")
    token, uid = first["token"], first["user"]["id"]
    client.post("/api/auth/pin", json={"pin": "4826"}, headers=auth(token))
    client.post("/api/kyc/submit", json={"user_id": uid, "pan": "ABCPE9090F", "full_name": "Re Set", "dob": "1990-01-01", "consent": True}, headers=auth(token))
    mfa = otp_login(client, "9100000009")[0]["mfa_token"]
    assert client.post("/api/auth/pin/reset", json={"mfa_token": mfa, "new_pin": "7351", "pan": "ABCPE0000F"}).status_code == 400
    ok = client.post("/api/auth/pin/reset", json={"mfa_token": mfa, "new_pin": "7351", "pan": "abcpe9090f"})
    assert ok.status_code == 200
    new = ok.json()["token"]
    assert client.get(f"/api/game/profile/{uid}", headers=auth(token)).status_code == 401  # old session ended
    step = client.post("/api/auth/pin/verify", json={"pin": "7351"}, headers=auth(new)).json()["step_up_token"]
    big = client.post("/api/upi/send-money", json={"user_id": uid, "recipient_upi": "rahul@paytm", "amount": 3000}, headers=auth(new, {"X-Step-Up-Token": step}))
    assert big.status_code == 403 and "24 hours" in big.json()["detail"]
