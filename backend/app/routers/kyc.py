from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import current_user
from ..db import db
from ..services import audit, crypto, kyc, notify

router = APIRouter(prefix="/kyc", tags=["kyc"])


class KycSubmit(BaseModel):
    user_id: str
    pan: str = Field(min_length=10, max_length=10)
    full_name: str = Field(min_length=2, max_length=100)
    dob: date
    consent: bool  # consent to verify identity with the KYC provider


@router.get("/status/{user_id}")
async def kyc_status(user_id: str):
    user = await db.users.find_one({"id": user_id}) or {"id": user_id}
    record = user.get("kyc", {})
    tier = kyc.tier_of(user)
    return {
        "status": record.get("status", "none"),
        "tier": tier,
        "reason": record.get("reason"),
        "masked_pan": record.get("masked_pan"),
        "name": record.get("name"),
        "verified_at": record.get("verified_at"),
        "limits": kyc.TIERS[tier],
        "used": await kyc.usage(user),
        "full_limits": kyc.TIERS["verified"],
    }


@router.post("/submit")
async def submit_kyc(body: KycSubmit, request: Request):
    uid = current_user(request)
    pan = body.pan.strip().upper()
    if not kyc.PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="That doesn't look like an individual PAN (e.g. ABCPE1234F)")
    if not body.consent:
        raise HTTPException(status_code=400, detail="We need your consent to verify your identity")
    if kyc.age_on(body.dob) < 18:
        raise HTTPException(status_code=400, detail="You must be 18 or older to complete KYC")
    user = await db.users.find_one({"id": uid})
    status = user.get("kyc", {}).get("status")
    if status == "verified":
        raise HTTPException(status_code=409, detail="Your KYC is already complete")
    if status == "review":
        # A screening match is decided by our compliance team; resubmitting with a tweaked name
        # must not turn it into "verified" while the alert is still open.
        raise HTTPException(status_code=409, detail="Your identity check is with our team. We'll update you within 2 working days.")
    if await db.users.find_one({"kyc.pan_hash": crypto.blind_index(pan), "id": {"$ne": uid}}):
        raise HTTPException(status_code=409, detail="This PAN is already linked to another account")

    name = " ".join(body.full_name.split())
    result = await kyc.get_provider().verify(pan, name, body.dob)
    record = {
        "status": result["status"],
        "reason": result["reason"] or None,
        "provider": kyc.get_provider().name,
        "provider_ref": result["ref"],
        "pan_encrypted": crypto.encrypt(pan),
        "pan_hash": crypto.blind_index(pan),
        "masked_pan": kyc.mask_pan(pan),
        "name": name,
        "dob_encrypted": crypto.encrypt(body.dob.isoformat()),
        "consent_at": datetime.utcnow().isoformat(),
        "verified_at": datetime.utcnow().isoformat() if result["status"] == "verified" else None,
    }
    await db.users.update_one({"id": uid}, {"$set": {"kyc": record}})
    await audit.record("kyc_" + result["status"], uid, {"ref": result["ref"], "pan": record["masked_pan"]}, request)
    if result["status"] == "review":
        await db.aml_alerts.insert_one({
            "id": f"AML{result['ref'][3:]}", "user_id": uid, "txn_id": None, "amount": 0, "recipient": None,
            "outcome": "review", "rules": [{"rule": "name_screening", "severity": "review", "why": "Possible screening-list match"}],
            "status": "open", "created_at": datetime.utcnow(),
        })
    if result["status"] == "verified":
        await notify.send(uid, "security", "KYC complete", "Your identity is verified. Your payment limits are now ₹1,00,000 a day.")
    return {"status": result["status"], "reason": result["reason"] or None, "masked_pan": record["masked_pan"]}

