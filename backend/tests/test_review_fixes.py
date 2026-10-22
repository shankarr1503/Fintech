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
