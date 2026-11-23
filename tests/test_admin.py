"""Exercise access boundaries and real persistence, not implementation details."""

import io
import importlib
from pathlib import Path
import secrets
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

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


def login(app, password, username="tiago"):
    client = app.test_client()
    csrf = client.get("/api/admin/session").json["csrf_token"]
    reply = client.post("/api/admin/login", json={"username": username, "password": password},
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


def test_event_rsvp_is_private_idempotent_and_kept_after_deletion(configured):
    app, password = configured
    admin, headers = login(app, password)
    public = app.test_client()
    public_headers = {"Origin": "http://localhost"}
    slug = "encontro-do-trade"
    path = f"/api/public/events/{slug}/rsvp"
    event = {"title": "Encontro do Trade", "city": "Tianguá", "registration_slug": slug}
    created = admin.post("/api/admin/events", json=event, headers=headers).json["item"]
    record_path = "/api/admin/events/" + created["id"]
    participant = {"name": "  Lívia   Mendes  ", "enterprise": "Pousada da Serra", "owner_phone": "+55 (88) 90000-0000"}

    assert public.post(path, json=participant, headers=public_headers).status_code == 404
    assert public.get("/api/admin/rsvps").status_code == 401
    assert admin.patch(
        record_path, json={"version": created["version"], "published": True}, headers=headers
    ).status_code == 200
    assert public.post(path, json=participant).status_code == 403
    for invalid in (
        {**participant, "name": ""},
        {**participant, "enterprise": "X" * 121},
        {"name": "Lívia", "enterprise": "Pousada da Serra"},
        {**participant, "owner_phone": ""},
        {**participant, "owner_phone": "90000-0000"},
        {**participant, "owner_phone": "+1 (88) 90000-0000"},
        {**participant, "owner_phone": "(88) 90000-0000 ramal 1"},
    ):
        assert public.post(path, json=invalid, headers=public_headers).status_code == 400

    assert public.post(path, json=participant, headers=public_headers).json == {"ok": True}
    retry = {"name": "li\u0301via mendes", "enterprise": "pousada da serra", "owner_phone": "(88) 3333-0000"}
    assert public.post(path, json=retry, headers=public_headers).json == {"ok": True}
    public_event = public.get("/api/public/content").json["events"][0]
    assert public_event["registration_slug"] == slug
    assert public_event["start_at"] == ""
    assert "Lívia Mendes" not in str(public_event)
    assert "owner_phone" not in public_event
    assert "900000000" not in str(public_event)
    result = admin.get("/api/admin/rsvps")
    assert "no-store" in result.headers["Cache-Control"]
    [registered_event] = result.json["events"]
    assert registered_event["id"] == created["id"]
    [registration] = registered_event["registrations"]
    assert registration["name"] == "Lívia Mendes"
    assert registration["enterprise"] == "Pousada da Serra"
    assert registration["owner_phone"] == "+5588900000000"
    assert registration["created_at"]

    assert admin.delete(record_path, json={"version": 2}, headers=headers).status_code == 200
    assert public.post(path, json=participant, headers=public_headers).status_code == 404
    [removed_event] = admin.get("/api/admin/rsvps").json["events"]
    assert removed_event["registration_slug"] == ""
    assert removed_event["registrations"] == [registration]


def test_rsvp_phone_migration_keeps_existing_confirmations(configured):
    app, password = configured
    admin, headers = login(app, password)
    slug = "encontro-legado"
    event = {"title": "Encontro", "city": "Tianguá", "registration_slug": slug, "published": True}
    assert admin.post("/api/admin/events", json=event, headers=headers).status_code == 201
    path = f"/api/public/events/{slug}/rsvp"
    public_headers = {"Origin": "http://localhost"}
    participant = {"name": "Maria", "enterprise": "Pousada", "owner_phone": "(88) 3333-0000"}
    assert app.test_client().post(path, json=participant, headers=public_headers).json == {"ok": True}
    [original] = admin.get("/api/admin/rsvps").json["events"][0]["registrations"]
    assert original["owner_phone"] == "8833330000"
    with sqlite3.connect(app.config["DATA_DIR"] / "content.sqlite3") as db:
        db.execute("ALTER TABLE event_rsvps DROP COLUMN owner_phone")

    migrated = create_app(app.config)
    admin, _ = login(migrated, password)
    assert admin.get("/api/admin/rsvps").json["events"][0]["registrations"] == [{**original, "owner_phone": ""}]
    assert migrated.test_client().post(path, json=participant, headers=public_headers).json == {"ok": True}
    assert admin.get("/api/admin/rsvps").json["events"][0]["registrations"] == [original]


def test_chapel_signup_requires_published_project_and_preserves_reviewed_names(configured):
    app, password = configured
    admin, headers = login(app, password)
    public = app.test_client()
    project = {"title": "Capela", "city": "Caminho da Fé", "participation_form": "capela-de-fatima"}
    item = admin.post("/api/admin/projects", json=project, headers=headers).json["item"]
    assert admin.post("/api/admin/projects", json=project, headers=headers).status_code == 409
    endpoint = f"/api/public/projects/{item['id']}/participation"
    signup = {"name": "Ana Lívia", "tribute_name": "Família D’Ávila", "submission_id": "edb693d6-de4a-4379-84c9-fc3c0d0870bd"}
    origin = {"Origin": "http://localhost"}
    assert public.get(endpoint).status_code == 404
    assert public.post(endpoint, json=signup, headers=origin).status_code == 404
    target = "/api/admin/projects/" + item["id"]
    live = admin.patch(target, json={"version": item["version"], "published": True}, headers=headers).json["item"]
    assert public.post(endpoint, json=signup).status_code == 403
    assert public.post(endpoint, json={**signup, "tribute_name": "   "}, headers=origin).status_code == 400
    for _ in range(2):
        assert public.post(endpoint, json=signup, headers=origin).json == {"ok": True, "limit": 61, "registered": 1}
    assert public.post(endpoint, json={**signup, "name": "Outro"}, headers=origin).status_code == 409
    assert public.get("/api/admin/rsvps").status_code == 401
    assert "tribute_name" not in public.get("/api/public/content").get_data(as_text=True)
    assert public.get(target + "/signups").status_code == 401
    listing = admin.get(target + "/signups")
    assert "no-store" in listing.headers["Cache-Control"]
    [participant] = listing.json["signups"]
    assert participant["name"] == signup["name"] and participant["tribute_name"] == signup["tribute_name"]
    assert admin.get("/api/admin/content").json["projects"][0]["signup_count"] == 1
    assert "signup_count" not in public.get("/api/public/content").json["projects"][0]
    other = admin.post("/api/admin/projects", json={"title": "Outro", "city": "Tianguá"}, headers=headers).json["item"]
    assert admin.get(f"/api/admin/projects/{other['id']}/signups").json == {"signups": []}
    deleted = admin.delete(target, json={"version": live["version"]}, headers=headers)
    assert deleted.status_code == 200
    assert public.post(endpoint, json=signup, headers=origin).status_code == 404
    [saved] = admin.get("/api/admin/rsvps").json["chapel_signups"]
    assert saved["name"] == signup["name"] and saved["tribute_name"] == signup["tribute_name"]


def test_chapel_limit_settings_apply_to_existing_signups_and_survive_restart(configured):
    app, password = configured
    admin, headers = login(app, password)
    public = app.test_client()
    project = {"title": "Capela", "city": "Tianguá", "participation_form": "capela-de-fatima", "published": True}
    project_id = admin.post("/api/admin/projects", json=project, headers=headers).json["item"]["id"]
    endpoint = f"/api/public/projects/{project_id}/participation"
    listing = f"/api/admin/projects/{project_id}/signups"
    settings = "/api/admin/settings"
    origin = {"Origin": "http://localhost"}

    def set_limit(value):
        return admin.patch(settings, json={"chapel_name_limit": value}, headers=headers)

    first = {"name": "Ana", "tribute_name": "Luz", "submission_id": str(uuid4())}
    second = {"name": "Maria", "tribute_name": "Paz", "submission_id": str(uuid4())}
    assert public.patch(settings, json={"chapel_name_limit": ""}, headers=origin).status_code == 401
    for invalid in ["0", "-1", "1.5", "sim", "9007199254740992"]:
        assert set_limit(invalid).status_code == 400
    assert public.get(endpoint).json["limit"] == 61
    assert set_limit("1").json["settings"]["chapel_name_limit"] == "1"
    assert public.post(endpoint, json=first, headers=origin).status_code == 200
    assert public.post(endpoint, json=second, headers=origin).status_code == 409
    assert set_limit("").json["settings"]["chapel_name_limit"] == ""
    assert admin.get(listing).json["limit"] is None
    restarted = create_app({"TESTING": True, "DATA_DIR": app.config["DATA_DIR"]})
    assert restarted.test_client().get(endpoint, base_url="https://tiagoismar.com").json == {"registered": 1, "limit": None}
    assert public.post(endpoint, json=second, headers=origin).json == {"ok": True, "registered": 2, "limit": None}
    assert set_limit("1").status_code == 200
    assert public.post(endpoint, json={**second, "submission_id": str(uuid4())}, headers=origin).status_code == 409
    assert public.post(endpoint, json=first, headers=origin).status_code == 200
    assert set_limit("2").status_code == 200
    assert len(admin.get(listing).json["signups"]) == 2
    assert set_limit("3").status_code == 200
    assert public.post(endpoint, json={**second, "submission_id": str(uuid4())}, headers=origin).status_code == 200


def test_chapel_last_place_is_atomic_and_existing_signup_can_retry(configured):
    app, password = configured
    admin, headers = login(app, password)
    project = {"title": "Capela", "city": "Tianguá", "participation_form": "capela-de-fatima", "published": True}
    project_id = admin.post("/api/admin/projects", json=project, headers=headers).json["item"]["id"]
    endpoint = f"/api/public/projects/{project_id}/participation"
    with sqlite3.connect(app.config["DATA_DIR"] / "content.sqlite3") as db:
        db.executemany("INSERT INTO project_signups VALUES (?,?,?,?,?)", [
            (project_id, str(uuid4()), f"Pessoa {i}", f"Homenagem {i}", "2026-11-20T12:00:00Z") for i in range(60)
        ])
    public = app.test_client()
    before = public.get(endpoint)
    assert before.json == {"registered": 60, "limit": 61} and before.headers["Cache-Control"] == "no-store"
    gate = threading.Barrier(2)
    def claim(place):
        signup = {"name": f"Pessoa {place}", "tribute_name": f"Nome {place}", "submission_id": str(uuid4())}
        gate.wait(timeout=10)
        response = app.test_client().post(endpoint, json=signup, headers={"Origin": "http://localhost"})
        return response.status_code, signup
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = dict(pool.map(claim, [61, 62]))
    assert set(results) == {200, 409}
    for code, signup in results.items():
        retry = public.post(endpoint, json=signup, headers={"Origin": "http://localhost"})
        assert retry.status_code == code and retry.json["registered"] == 61
    assert public.get(endpoint).json == {"registered": 61, "limit": 61}
    private = admin.get(f"/api/admin/projects/{project_id}/signups").json
    assert private["limit"] == len(private["signups"]) == 61
    assert results[409]["tribute_name"] not in [row["tribute_name"] for row in private["signups"]]


def test_event_registration_slug_validation_and_edits(configured):
    app, password = configured
    admin, headers = login(app, password)
    route = "/api/admin/events"
    event = {"title": "Encontro", "city": "Tianguá", "start_at": "2026-12-05T10:00"}
    for invalid in ("invalid slug", "hífen", "-inicio", "a--b", "x" * 81):
        assert admin.post(route, json={**event, "registration_slug": invalid}, headers=headers).status_code == 400
    registered = {**event, "registration_slug": "  Encontro-2026  ", "published": True}
    response = admin.post(route, json=registered, headers=headers)
    assert response.status_code == 201
    created = response.json["item"]
    assert created["registration_slug"] == "encontro-2026"
    assert admin.post(route, json=registered, headers=headers).status_code == 409
    second = admin.post(route, json=event, headers=headers).json["item"]
    assert admin.patch(
        f"{route}/{second['id']}",
        json={"version": second["version"], "registration_slug": "encontro-2026"},
        headers=headers,
    ).status_code == 409
    edited = admin.patch(
        f"{route}/{created['id']}", json={"version": created["version"], "title": "Novo título"}, headers=headers
    )
    assert edited.status_code == 200
    assert edited.json["item"]["registration_slug"] == "encontro-2026"


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


@pytest.mark.parametrize("username", ["owner", "owner+17@example.com"])
def test_rate_limit_and_password_reset_revoke_access(configured, username):
    app, _ = configured
    password = secrets.token_urlsafe(24)
    upsert_admin(app, username, password)
    client, headers = login(app, password, username)
    upsert_admin(app, username, secrets.token_urlsafe(24), replace=True)
    assert client.get("/api/admin/content").status_code == 401
    anonymous = app.test_client()
    token = anonymous.get("/api/admin/session").json["csrf_token"]
    for _ in range(7):
        assert anonymous.post("/api/admin/login", json={"username": username, "password": "bad"}, headers={"Origin": "http://localhost", "X-CSRF-Token": token}).status_code == 401
    assert anonymous.post("/api/admin/login", json={"username": username, "password": "bad"}, headers={"Origin": "http://localhost", "X-CSRF-Token": token}).status_code == 429


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


def test_admin_crud_project_signups_and_event_rsvps(configured):
    app, password = configured
    admin, headers = login(app, password)
    public = app.test_client()

    # 1. Project signups CRUD
    project = {"title": "Capela de Fátima", "city": "Ibiapaba", "participation_form": "capela-de-fatima", "published": True}
    p_item = admin.post("/api/admin/projects", json=project, headers=headers).json["item"]
    p_id = p_item["id"]

    # Public cannot mutate via admin routes
    assert public.post(f"/api/admin/projects/{p_id}/signups", json={"name": "Joao", "tribute_name": "Familia"}).status_code == 401
    assert public.patch(f"/api/admin/projects/{p_id}/signups/fake", json={"name": "Joao", "tribute_name": "Familia"}).status_code == 401
    assert public.delete(f"/api/admin/projects/{p_id}/signups/fake").status_code == 401

    # Admin Create project signup
    res_create = admin.post(f"/api/admin/projects/{p_id}/signups", json={"name": "Carlos Silva", "tribute_name": "Família Silva"}, headers=headers)
    assert res_create.status_code == 201
    s_id = res_create.json["signup"]["submission_id"]
    assert res_create.json["signup"]["name"] == "Carlos Silva"

    # Validation
    assert admin.post(f"/api/admin/projects/{p_id}/signups", json={"name": "", "tribute_name": "Ok"}, headers=headers).status_code == 400
    assert admin.post(f"/api/admin/projects/{p_id}/signups", json={"name": "Ok\nQuebra", "tribute_name": "Ok"}, headers=headers).status_code == 400

    # List verification
    listing = admin.get(f"/api/admin/projects/{p_id}/signups").json
    assert len(listing["signups"]) == 1
    assert listing["signups"][0]["submission_id"] == s_id

    # Admin Update project signup
    res_update = admin.patch(f"/api/admin/projects/{p_id}/signups/{s_id}", json={"name": "Carlos Eduardo Silva", "tribute_name": "Homenagem Pais"}, headers=headers)
    assert res_update.status_code == 200
    assert res_update.json["signup"]["name"] == "Carlos Eduardo Silva"
    assert res_update.json["signup"]["tribute_name"] == "Homenagem Pais"

    # Admin Delete project signup
    assert admin.delete(f"/api/admin/projects/{p_id}/signups/nonexistent", headers=headers).status_code == 404
    assert admin.delete(f"/api/admin/projects/{p_id}/signups/{s_id}", headers=headers).status_code == 200
    assert len(admin.get(f"/api/admin/projects/{p_id}/signups").json["signups"]) == 0

    # 2. Event RSVPs CRUD
    event = {"title": "Mesa Redonda da Serra", "city": "Ubajara", "registration_slug": "mesa-redonda", "published": True}
    e_item = admin.post("/api/admin/events", json=event, headers=headers).json["item"]
    e_id = e_item["id"]

    # Public cannot mutate via admin routes
    assert public.post(f"/api/admin/events/{e_id}/rsvps", json={"name": "A", "enterprise": "B", "owner_phone": "88999990000"}).status_code == 401
    assert public.patch(f"/api/admin/events/{e_id}/rsvps/fake", json={"name": "A", "enterprise": "B", "owner_phone": "88999990000"}).status_code == 401
    assert public.delete(f"/api/admin/events/{e_id}/rsvps/fake").status_code == 401

    # Admin Create RSVP
    res_rsvp = admin.post(f"/api/admin/events/{e_id}/rsvps", json={"name": "Marcos Costa", "enterprise": "Café Serrano", "owner_phone": "(88) 98888-7777"}, headers=headers)
    assert res_rsvp.status_code == 201
    pkey = res_rsvp.json["rsvp"]["participant_key"]
    assert res_rsvp.json["rsvp"]["owner_phone"] == "88988887777"

    # Duplicate create fails
    assert admin.post(f"/api/admin/events/{e_id}/rsvps", json={"name": "Marcos Costa", "enterprise": "Café Serrano", "owner_phone": "(88) 98888-7777"}, headers=headers).status_code == 409

    # Check listing
    rsvps_list = admin.get("/api/admin/rsvps").json["events"]
    [cur_event] = [ev for ev in rsvps_list if ev["id"] == e_id]
    assert len(cur_event["registrations"]) == 1
    assert cur_event["registrations"][0]["participant_key"] == pkey

    # Admin Update RSVP
    res_up_rsvp = admin.patch(f"/api/admin/events/{e_id}/rsvps/{pkey}", json={"name": "Marcos A. Costa", "enterprise": "Café Serrano Matriz", "owner_phone": "88999991111"}, headers=headers)
    assert res_up_rsvp.status_code == 200
    new_pkey = res_up_rsvp.json["rsvp"]["participant_key"]
    assert res_up_rsvp.json["rsvp"]["name"] == "Marcos A. Costa"
    assert res_up_rsvp.json["rsvp"]["owner_phone"] == "88999991111"

    # Admin Delete RSVP
    assert admin.delete(f"/api/admin/events/{e_id}/rsvps/nonexistent", headers=headers).status_code == 404
    assert admin.delete(f"/api/admin/events/{e_id}/rsvps/{new_pkey}", headers=headers).status_code == 200
    rsvps_list_after = admin.get("/api/admin/rsvps").json["events"]
    [cur_event_after] = [ev for ev in rsvps_list_after if ev["id"] == e_id]
    assert len(cur_event_after["registrations"]) == 0

