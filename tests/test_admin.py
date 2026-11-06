"""Exercise access boundaries and real persistence, not implementation details."""

import io
import importlib
from pathlib import Path
import secrets
import sqlite3
import threading

from PIL import Image
import pytest

from server.app import create_app, upsert_admin


@pytest.fixture
def configured(tmp_path):
    app = create_app({
        "TESTING": True,
        "DATA_DIR": tmp_path / "private",
        "SITE_ROOT": Path(__file__).resolve().parents[1],
        "DEV_MODE": True,
        "COOKIE_SECURE": False,
        "TRUSTED_HOSTS": ["localhost"],
    })
    password = secrets.token_urlsafe(24)
    upsert_admin(app, "tiago", password)
    return app, password


def login(app, password):
    client = app.test_client()
    csrf = client.get("/api/admin/session").json["csrf_token"]
    reply = client.post("/api/admin/login", json={"username": "tiago", "password": password},
                        headers={"Origin": "http://localhost", "X-CSRF-Token": csrf})
    assert reply.status_code == 200, reply.json
    return client, {"Origin": "http://localhost", "X-CSRF-Token": reply.json["csrf_token"]}


def company(title="Empresa de teste", published=False, **extra):
    return {"title": title, "city": "Tianguá", "published": published, **extra}


def test_no_default_account_and_seed_is_preserved(tmp_path):
    app = create_app({"TESTING": True, "DATA_DIR": tmp_path, "TRUSTED_HOSTS": ["localhost"], "COOKIE_SECURE": False})
    client = app.test_client()
    assert client.get("/api/admin/content").status_code == 401
    content = client.get("/api/public/content").json
    assert len(content["partners"]) == 44
    assert {item["city"] for item in content["partners"]} == {"Tianguá"}
    assert len({item["title"] for item in content["partners"]}) == 44
    assert content["companies"] == content["events"] == content["projects"] == []
    assert all("version" not in item for item in content["partners"])
    with sqlite3.connect(tmp_path / "content.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    # Starting another worker must not duplicate seed entries.
    another = create_app({"TESTING": True, "DATA_DIR": tmp_path, "TRUSTED_HOSTS": ["localhost"]})
    assert len(another.test_client().get("/api/public/content").json["partners"]) == 44


def test_login_rotation_and_logout_revoke_old_session(configured):
    app, password = configured
    client = app.test_client()
    initial = client.get("/api/admin/session").json
    first_cookie = client.get_cookie("tiago_session").value
    headers = {"Origin": "http://localhost", "X-CSRF-Token": initial["csrf_token"]}
    response = client.post("/api/admin/login", json={"username": "TIAGO", "password": password}, headers=headers)
    assert response.status_code == 200
    assert response.json["authenticated"] is True
    assert response.json["csrf_token"] != initial["csrf_token"]
    second_cookie = client.get_cookie("tiago_session").value
    assert first_cookie != second_cookie
    assert "HttpOnly" in response.headers["Set-Cookie"] and "SameSite=Strict" in response.headers["Set-Cookie"]
    assert client.get("/api/admin/content").status_code == 200
    headers["X-CSRF-Token"] = response.json["csrf_token"]
    assert client.post("/api/admin/logout", headers=headers).json["authenticated"] is False
    client.set_cookie("tiago_session", second_cookie)
    assert client.get("/api/admin/content").status_code == 401


def test_mutations_require_csrf_and_matching_origin(configured):
    app, password = configured
    client, headers = login(app, password)
    assert client.post("/api/admin/companies", json=company()).status_code == 403
    bad = {**headers, "Origin": "https://attacker.example"}
    assert client.post("/api/admin/companies", json=company(), headers=bad).status_code == 403
    assert client.post("/api/admin/companies", json=company(), headers=headers).status_code == 201
    for path in ("/api/admin/content", "/api/admin/stats", "/api/admin/export"):
        assert app.test_client().get(path).status_code == 401


def test_drafts_edit_conflicts_and_deletions_persist(configured):
    app, password = configured
    client, headers = login(app, password)
    created = client.post("/api/admin/companies", json=company(), headers=headers).json["item"]
    public = app.test_client()
    assert public.get("/api/public/content").json["companies"] == []
    target = "/api/admin/companies/" + created["id"]
    response = client.patch(target, json={"version": created["version"], "published": True}, headers=headers)
    assert response.status_code == 200
    updated = response.json["item"]
    assert public.get("/api/public/content").json["companies"][0]["title"] == created["title"]
    assert client.patch(target, json={"version": created["version"], "title": "Stale"}, headers=headers).status_code == 409
    assert client.delete(target, json={"version": created["version"]}, headers=headers).status_code == 409
    assert client.delete(target, json={"version": updated["version"]}, headers=headers).status_code == 200
    assert client.get("/api/admin/content").json["companies"] == []
    assert public.get("/api/public/content").json["companies"] == []
    with sqlite3.connect(app.config["DATA_DIR"] / "content.sqlite3") as db:
        assert db.execute("SELECT deleted FROM records WHERE id=?", (created["id"],)).fetchone()[0] == 1


def test_catalog_respects_company_publication_and_deletion(configured):
    app, password = configured
    client, headers = login(app, password)
    parent = client.post("/api/admin/companies", json=company(), headers=headers).json["item"]
    item = {"title": "Serviço", "company_id": parent["id"], "published": True}
    assert client.post("/api/admin/catalog_items", json=item, headers=headers).status_code == 400
    company_url = "/api/admin/companies/" + parent["id"]
    parent = client.patch(company_url, json={"version": parent["version"], "published": True}, headers=headers).json["item"]
    child = client.post("/api/admin/catalog_items", json=item, headers=headers).json["item"]
    assert len(app.test_client().get("/api/public/content").json["catalog_items"]) == 1
    parent = client.patch(company_url, json={"version": parent["version"], "published": False}, headers=headers).json["item"]
    assert app.test_client().get("/api/public/content").json["catalog_items"] == []
    assert client.delete(company_url, json={"version": parent["version"]}, headers=headers).status_code == 200
    assert client.get("/api/admin/content").json["catalog_items"] == []
    assert client.patch("/api/admin/catalog_items/" + child["id"], json={"version": child["version"]}, headers=headers).status_code == 404


@pytest.mark.parametrize("operation", ["create", "patch"])
def test_catalog_parent_validation_is_atomic_with_company_deletion(configured, monkeypatch, operation):
    """Force deletion between parent lookup and child write, without timing sleeps."""
    app, password = configured
    creator, creator_headers = login(app, password)
    deleter, delete_headers = login(app, password)
    parent = creator.post("/api/admin/companies", json=company(published=True), headers=creator_headers).json["item"]
    source = {"title": "Serviço concorrente", "company_id": parent["id"], "published": True}
    child_url = "/api/admin/catalog_items"
    if operation == "patch":
        original_parent = creator.post("/api/admin/companies", json=company(title="Empresa original", published=True), headers=creator_headers).json["item"]
        existing = creator.post(child_url, json={**source, "company_id": original_parent["id"]}, headers=creator_headers).json["item"]
        child_url += "/" + existing["id"]
        source = {"company_id": parent["id"], "version": existing["version"]}

    parent_read = threading.Event()
    delete_decided = threading.Event()
    child_finished = threading.Event()
    lock_observed = threading.Event()
    outcome = {}
    module = importlib.import_module("server.app")
    original_connection = module.connection
    paused = False

    class Cursor:
        def __init__(self, cursor, pause):
            self.cursor, self.pause = cursor, pause

        def fetchone(self):
            row = self.cursor.fetchone()
            if self.pause:
                parent_read.set()
                assert delete_decided.wait(20), "Concurrent delete did not reach its write."
            return row

        def __getattr__(self, name):
            return getattr(self.cursor, name)

    class Database:
        def __init__(self, db):
            self.db = db

        def execute(self, statement, parameters=()):
            nonlocal paused
            deleting = threading.current_thread().name == "delete-company"
            if deleting and statement.startswith("UPDATE records SET deleted=1") and parameters[1] == parent["id"]:
                # Try the real competing SQLite write immediately. With the fix it
                # cannot acquire the lock; wait for the child commit and retry,
                # equivalent to SQLite's normal busy timeout, but deterministic.
                self.db.execute("PRAGMA busy_timeout=0")
                try:
                    return self.db.execute(statement, parameters)
                except sqlite3.OperationalError as error:
                    if "locked" not in str(error).lower():
                        raise
                    self.db.rollback()
                    lock_observed.set()
                    delete_decided.set()
                    assert child_finished.wait(20), "Child request did not commit."
                    self.db.execute("PRAGMA busy_timeout=15000")
                    return self.db.execute(statement, parameters)
            cursor = self.db.execute(statement, parameters)
            pause = (not deleting and not paused and statement.startswith("SELECT * FROM records WHERE id=? AND kind=?")
                     and parameters == (parent["id"], "companies"))
            if pause:
                paused = True
                return Cursor(cursor, True)
            return cursor

        def __enter__(self):
            self.db.__enter__()
            return self

        def __exit__(self, *args):
            result = self.db.__exit__(*args)
            if threading.current_thread().name == "delete-company":
                delete_decided.set()
            return result

    monkeypatch.setattr(module, "connection", lambda: Database(original_connection()))

    def delete_parent():
        try:
            assert parent_read.wait(20), "Parent was not read."
            outcome["delete"] = deleter.delete("/api/admin/companies/" + parent["id"], json={"version": parent["version"]}, headers=delete_headers)
        except BaseException as error:
            outcome["error"] = error
            delete_decided.set()

    thread = threading.Thread(target=delete_parent, name="delete-company", daemon=True)
    thread.start()
    try:
        response = (creator.post if operation == "create" else creator.patch)(child_url, json=source, headers=creator_headers)
    finally:
        child_finished.set()
        thread.join(25)
    monkeypatch.setattr(module, "connection", original_connection)
    assert not thread.is_alive(), "Concurrent request did not complete."
    assert "error" not in outcome, outcome.get("error")
    assert response.status_code == (201 if operation == "create" else 200)
    assert outcome["delete"].status_code == 200
    assert lock_observed.is_set(), "Deletion committed before catalog validation/write was finished."
    assert creator.get("/api/admin/content").json["catalog_items"] == []


def test_validation_prevents_executable_urls_and_invalid_data(configured):
    app, password = configured
    client, headers = login(app, password)
    for payload in [company(url="javascript:alert(1)"), company(url="https://[invalid"), company(title="\ud800"), company(image="https://attacker.example/photo.svg"), company(published="true"), company(sort_order=True), company(city=" "), company(whatsapp="123"), company(url="https://user:secret@example.com")]:
        assert client.post("/api/admin/companies", json=payload, headers=headers).status_code == 400
    xss = '<img src=x onerror="alert(1)">'
    response = client.post("/api/admin/companies", json=company(title=xss, published=True), headers=headers)
    assert response.status_code == 201
    # Data remains plain JSON text for the frontend's textContent renderer.
    public = app.test_client().get("/api/public/content")
    assert public.mimetype == "application/json" and public.json["companies"][0]["title"] == xss
    for start, end in [("2026-02-30T10:00", ""), ("2026-12-05T10:00", "2026-12-04T10:00"), ("2026-12-05", "")]:
        result = client.post("/api/admin/events", json={"title": "Encontro", "city": "Ipu", "start_at": start, "end_at": end}, headers=headers)
        assert result.status_code == 400
    valid = {"title": "Encontro", "city": "Ipu", "start_at": "2026-12-05T10:00", "end_at": "2026-12-05T12:00", "published": True}
    assert client.post("/api/admin/events", json=valid, headers=headers).status_code == 201


def test_upload_reencodes_images_and_keeps_drafts_private(configured):
    app, password = configured
    client, headers = login(app, password)
    for name, data in [("hack.svg", b'<svg onload="alert(1)"/>'), ("pretend.jpg", b"<html>not an image</html>")]:
        response = client.post("/api/admin/upload", data={"file": (io.BytesIO(data), name)}, headers=headers)
        assert response.status_code == 400
    image = io.BytesIO()
    Image.new("RGB", (2400, 100), "green").save(image, "PNG")
    image.seek(0)
    response = client.post("/api/admin/upload", data={"file": (image, "../../photo.png")}, headers=headers)
    assert response.status_code == 201
    media = response.json["url"]
    assert media.startswith("/media/") and media.endswith(".webp")
    decoded = Image.open(io.BytesIO(client.get(media).data))
    assert decoded.format == "WEBP" and decoded.width == 2000
    public = app.test_client()
    assert public.get(media).status_code == 404
    item = client.post("/api/admin/companies", json=company(image=media, published=True), headers=headers).json["item"]
    assert public.get(media).status_code == 200
    client.patch("/api/admin/companies/" + item["id"], json={"version": item["version"], "published": False}, headers=headers)
    assert public.get(media).status_code == 404
    assert client.get("/media/../../content.sqlite3").status_code == 404


def test_rate_limit_and_password_reset_revoke_access(configured):
    app, password = configured
    client, headers = login(app, password)
    upsert_admin(app, "tiago", secrets.token_urlsafe(24), replace=True)
    assert client.get("/api/admin/content").status_code == 401
    anonymous = app.test_client()
    token = anonymous.get("/api/admin/session").json["csrf_token"]
    for _ in range(7):
        assert anonymous.post("/api/admin/login", json={"username": "tiago", "password": "bad"}, headers={"Origin": "http://localhost", "X-CSRF-Token": token}).status_code == 401
    assert anonymous.post("/api/admin/login", json={"username": "tiago", "password": "bad"}, headers={"Origin": "http://localhost", "X-CSRF-Token": token}).status_code == 429


def test_metrics_are_aggregate_and_exclude_admin_and_bots(configured):
    app, password = configured
    admin, headers = login(app, password)
    assert admin.post("/api/visit", json={"section": "inicio"}, headers=headers).json["counted"] is False
    public = app.test_client()
    browser = {"Origin": "http://localhost", "User-Agent": "Mozilla/5.0"}
    assert public.post("/api/visit", json={"section": "inicio"}, headers={**browser, "User-Agent": "ExampleBot"}).json["counted"] is False
    assert public.post("/api/visit", json={"section": "inicio"}, headers=browser).json["counted"] is True
    assert public.post("/api/visit", json={"section": "eventos"}, headers=browser).status_code == 200
    assert public.post("/api/visit", json={"section": "admin"}, headers=browser).status_code == 400
    assert public.post("/api/visit", json={"section": []}, headers=browser).status_code == 400
    assert public.post("/api/visit", json={"section": "inicio"}, headers={**browser, "Origin": "https://attacker.example"}).status_code == 403
    statistics = admin.get("/api/admin/stats").json
    assert statistics["today"] == statistics["total"] == 1
    assert len(statistics["last_30_days"]) == 30
    assert {row["section"] for row in statistics["by_section"]} == {"inicio", "eventos"}


def test_settings_export_and_source_files_are_protected(configured):
    app, password = configured
    admin, headers = login(app, password)
    assert admin.patch("/api/admin/settings", json={"contact_whatsapp": "5588992410722"}, headers=headers).status_code == 200
    assert admin.patch("/api/admin/settings", json={"contact_whatsapp": "bad"}, headers=headers).status_code == 400
    assert admin.patch("/api/admin/settings", json={"password": "not allowed"}, headers=headers).status_code == 400
    assert admin.patch("/api/admin/settings", json={"catalog_url": "javascript:alert(1)"}, headers=headers).status_code == 400
    assert admin.patch("/api/admin/settings", json={"catalog_url": "https://wa.me/c/558892410722"}, headers=headers).json["settings"]["catalog_url"] == "https://wa.me/c/558892410722"
    assert admin.patch("/api/admin/settings", json={"catalog_url": ""}, headers=headers).status_code == 200
    export = admin.get("/api/admin/export")
    assert export.status_code == 200 and "attachment" in export.headers["Content-Disposition"]
    assert "password" not in export.get_data(as_text=True) and "csrf" not in export.get_data(as_text=True)
    for path in ("/server/app.py", "/server/seed.json", "/.git/config", "/assets/../server/app.py", "/admin/../server/app.py"):
        assert admin.get(path).status_code == 404
    assert "no-store" in admin.get("/api/admin/content").headers["Cache-Control"]


def test_database_cannot_be_created_inside_public_directory(tmp_path):
    with pytest.raises(RuntimeError):
        create_app({"DATA_DIR": tmp_path / "public/private", "SITE_ROOT": tmp_path / "public"})


def test_production_cookie_secure_and_untrusted_host_blocked(tmp_path):
    app = create_app({"TESTING": True, "DATA_DIR": tmp_path, "DEV_MODE": False, "COOKIE_SECURE": True, "TRUSTED_HOSTS": ["tiagoismar.com"]})
    response = app.test_client().get("/api/admin/session", base_url="https://tiagoismar.com")
    assert response.status_code == 200
    assert "Secure" in response.headers["Set-Cookie"]
    assert app.test_client().get("/api/admin/session", base_url="https://attacker.example").status_code == 400
