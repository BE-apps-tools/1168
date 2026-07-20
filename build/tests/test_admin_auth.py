"""Contract test for the repo-based admin list (Python mirror of the Worker's
admin auth in worker/src/index.js: sha256hex, checkAdmin, data/admins.json shape).

Admins live in data/admins.json as {"admins":[{name,salt,hash,added}]} where
hash = SHA-256(salt + ":" + key) as lowercase hex. The master ADMIN_KEY secret
is separate and never appears in this file. If the JS scheme changes, this must.
"""
import hashlib
import json
import os


def admin_hash(salt, key):
    return hashlib.sha256((salt + ":" + key).encode("utf-8")).hexdigest()


def verify(admins, key):
    """Mirror of checkAdmin's repo-list branch: return the matching name or None."""
    for a in admins:
        if not a.get("salt") or not a.get("hash"):
            continue
        if admin_hash(a["salt"], key) == a["hash"]:
            return a.get("name", "admin")
    return None


def test_hash_is_stable_hex():
    h = admin_hash("0011223344556677", "teammate-key-abcdef123456")
    assert len(h) == 64 and all(c in "0123456789abcdef" for c in h)
    # deterministic
    assert h == admin_hash("0011223344556677", "teammate-key-abcdef123456")


def test_salt_changes_hash():
    assert admin_hash("aaaa", "samekey123456") != admin_hash("bbbb", "samekey123456")


def test_verify_roundtrip_and_unicode():
    key = "teammate-key-abcdef123456"
    salt = "deadbeefdeadbeef"
    admins = [{"name": "Álvaro Núñez", "salt": salt, "hash": admin_hash(salt, key), "added": "2026-07-20"}]
    assert verify(admins, key) == "Álvaro Núñez"     # correct key matches, unicode name preserved
    assert verify(admins, "wrong") is None            # wrong key rejected
    # a plaintext key must never be derivable from what's stored
    assert key not in json.dumps(admins)


def test_seed_file_shape():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "admins.json")
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    assert isinstance(d.get("admins"), list)          # ships as an empty list; master key is the only access
    for a in d["admins"]:
        assert {"name", "salt", "hash"} <= set(a)
