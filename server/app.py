"""Small, same-origin CMS. All durable state lives outside the public site."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import functools
import getpass
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import unicodedata
from urllib.parse import urlsplit
import uuid
import warnings
from zoneinfo import ZoneInfo

from flask import Flask, g, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash


ROOT = Path(__file__).resolve().parent.parent
KINDS = ("companies", "catalog_items", "events", "projects", "partners")
COMMON = {"title", "city", "description", "image", "published", "sort_order"}
FIELDS = {
    "companies": COMMON | {"category", "whatsapp", "url", "is_group"},
    "catalog_items": COMMON | {"company_id", "price_text", "url"},
    "events": COMMON | {"location", "start_at", "end_at", "url", "registration_slug"},
    "projects": COMMON | {"status", "url", "participation_form"},
    "partners": {"title", "city", "published", "sort_order"},
}
SETTING_LIMITS = {
    "chapel_name_limit": 16,
    "site_intro": 1500,
    "contact_whatsapp": 15,
    "catalog_url": 1200,
    "companies_title": 120,
    "companies_intro": 600,
    "events_intro": 600,
    "projects_intro": 600,
}
SECTIONS = {"inicio", "tiago", "serra", "olhares", "empresas", "eventos", "projetos", "parceiros", "contato"}
MAX_RECORDS = 5000
REGISTRATION_SLUG_LIMIT = 80
REGISTRATION_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
REGISTRATION_FIELD_LIMIT = 120
Image.MAX_IMAGE_PIXELS = 20_000_000


class APIError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def connection():
    if "database" not in g:
        g.database = sqlite3.connect(g.app_data / "content.sqlite3", timeout=15)
        g.database.row_factory = sqlite3.Row
        g.database.execute("PRAGMA foreign_keys = ON")
        g.database.execute("PRAGMA busy_timeout = 15000")
    return g.database


def initialize_database(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    (data_dir / "uploads").mkdir(exist_ok=True, mode=0o700)
    db = sqlite3.connect(data_dir / "content.sqlite3", timeout=30)
    db.execute("PRAGMA journal_mode = WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS records_kind ON records(kind, deleted);
        CREATE TABLE IF NOT EXISTS event_rsvps (
            event_id TEXT NOT NULL REFERENCES records(id),
            participant_key TEXT NOT NULL,
            name TEXT NOT NULL,
            enterprise TEXT NOT NULL,
            created_at TEXT NOT NULL,
            owner_phone TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(event_id, participant_key)
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_signups (
            project_id TEXT NOT NULL REFERENCES records(id),
            submission_id TEXT NOT NULL,
            name TEXT NOT NULL,
            tribute_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(project_id, submission_id)
        );
        CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT NOT NULL, bucket INTEGER NOT NULL, hits INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, PRIMARY KEY(key, bucket)
        );
        CREATE TABLE IF NOT EXISTS views (
            date TEXT NOT NULL, section TEXT NOT NULL, views INTEGER NOT NULL,
            PRIMARY KEY(date, section)
        );
        CREATE TABLE IF NOT EXISTS surveys (
            id TEXT PRIMARY KEY, slug TEXT NOT NULL, data TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS surveys_slug ON surveys(slug) WHERE deleted=0;
        CREATE TABLE IF NOT EXISTS survey_responses (
            id TEXT PRIMARY KEY, survey_id TEXT NOT NULL REFERENCES surveys(id),
            answers TEXT NOT NULL, answered_on TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS survey_responses_survey ON survey_responses(survey_id);
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL,
            target TEXT NOT NULL, happened_at TEXT NOT NULL
        );
    """)
    # Serialize first startup across production workers; also upgrades an early preview DB.
    with db:
        db.execute("BEGIN IMMEDIATE")
        if "expires_at" not in {row[1] for row in db.execute("PRAGMA table_info(rate_limits)")}:
            db.execute("ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        if "owner_phone" not in {row[1] for row in db.execute("PRAGMA table_info(event_rsvps)")}:
            db.execute("ALTER TABLE event_rsvps ADD COLUMN owner_phone TEXT NOT NULL DEFAULT ''")
        db.execute("INSERT OR IGNORE INTO metadata VALUES ('rate_salt', ?)", (secrets.token_hex(32),))
        db.execute("INSERT OR IGNORE INTO metadata VALUES ('metrics_since', ?)", (utc_now(),))
        seed = json.loads((Path(__file__).parent / "seed.json").read_text(encoding="utf-8"))
        for key, value in seed["settings"].items():
            db.execute("INSERT OR IGNORE INTO settings VALUES (?, ?)", (key, value))
        if not db.execute("SELECT 1 FROM metadata WHERE key='seed_version'").fetchone():
            for index, entry in enumerate(seed["partners"]):
                entry["sort_order"] = index
                db.execute("INSERT INTO records(id, kind, data, updated_at) VALUES (?, 'partners', ?, ?)",
                           (secrets.token_hex(12), json.dumps(entry, ensure_ascii=False), utc_now()))
            db.execute("INSERT INTO metadata VALUES ('seed_version','1')")
        if not db.execute("SELECT 1 FROM metadata WHERE key='survey_seed_version'").fetchone():
            surveys = json.loads((Path(__file__).parent / "surveys.json").read_text(encoding="utf-8"))
            for entry in surveys["surveys"]:
                slug = entry.pop("slug")
                if not db.execute("SELECT 1 FROM surveys WHERE slug=? AND deleted=0", (slug,)).fetchone():
                    db.execute("INSERT INTO surveys(id,slug,data,created_at,updated_at) VALUES (?,?,?,?,?)",
                               (secrets.token_hex(12), slug, json.dumps(entry, ensure_ascii=False), utc_now(), utc_now()))
            db.execute("INSERT INTO metadata VALUES ('survey_seed_version','1')")
    db.close()


SURVEY_TYPES = {"single", "multiple", "scale", "text"}
SURVEY_QUESTION_ID = re.compile(r"[a-z0-9_]{1,24}")
SURVEY_TEXT_LIMIT = 1000


def survey_definition(source, text_field):
    """Validate a survey written in the panel. Returns the stored data (without slug)."""
    if not isinstance(source, dict):
        raise APIError("Envie a pesquisa em formato JSON.")
    data = {
        "title": text_field(source.get("title", ""), "título", 160, required=True),
        "intro": text_field(source.get("intro", ""), "apresentação", 1500),
        "thanks": text_field(source.get("thanks", ""), "mensagem de agradecimento", 600),
        "open": source.get("open", False),
    }
    if not isinstance(data["open"], bool):
        raise APIError("Informe se a pesquisa está aberta.")
    questions = source.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 40:
        raise APIError("A pesquisa precisa ter de 1 a 40 perguntas.")
    seen, result = set(), []
    for number, question in enumerate(questions, 1):
        if not isinstance(question, dict):
            raise APIError(f"Confira a pergunta {number}.")
        kind = question.get("type")
        if kind not in SURVEY_TYPES:
            raise APIError(f"Escolha o tipo da pergunta {number}.")
        identifier = question.get("id") or f"p{secrets.token_hex(4)}"
        if not isinstance(identifier, str) or not SURVEY_QUESTION_ID.fullmatch(identifier) or identifier in seen:
            raise APIError(f"Identificador inválido na pergunta {number}.")
        seen.add(identifier)
        required = question.get("required", True)
        if not isinstance(required, bool):
            raise APIError(f"Confira se a pergunta {number} é obrigatória.")
        item = {"id": identifier, "type": kind, "required": required,
                "text": text_field(question.get("text", ""), f"texto da pergunta {number}", 300, required=True)}
        if kind in {"single", "multiple"}:
            options = question.get("options")
            if not isinstance(options, list):
                raise APIError(f"Informe as opções da pergunta {number}.")
            options = [text_field(option, f"opção da pergunta {number}", 120) for option in options]
            options = [option for option in options if option]
            if not 2 <= len(options) <= 15 or len({option.casefold() for option in options}) != len(options):
                raise APIError(f"A pergunta {number} precisa de 2 a 15 opções diferentes.")
            item["options"] = options
            if kind == "multiple":
                maximum = question.get("max", len(options))
                if type(maximum) is not int or not 1 <= maximum <= len(options):
                    raise APIError(f"Confira quantas opções podem ser marcadas na pergunta {number}.")
                item["max"] = maximum
        if kind == "scale":
            item["min_label"] = text_field(question.get("min_label", ""), f"rótulo da nota 1 da pergunta {number}", 40)
            item["max_label"] = text_field(question.get("max_label", ""), f"rótulo da nota 5 da pergunta {number}", 40)
        result.append(item)
    data["questions"] = result
    return data


def survey_answers(survey, source):
    """Validate one anonymous response against the survey's questions."""
    if not isinstance(source, dict):
        raise APIError("Envie as respostas em formato JSON.")
    questions = {question["id"]: question for question in survey["questions"]}
    if set(source) - set(questions):
        raise APIError("A pesquisa mudou. Atualize a página e responda novamente.", 409)
    answers = {}
    for identifier, question in questions.items():
        value = source.get(identifier)
        if value in (None, "", []):
            if question["required"]:
                raise APIError(f"Responda: {question['text']}")
            continue
        kind = question["type"]
        if kind == "single":
            if value not in question["options"]:
                raise APIError(f"Escolha uma opção em: {question['text']}")
        elif kind == "multiple":
            if (not isinstance(value, list) or len(set(map(str, value))) != len(value)
                    or not 1 <= len(value) <= question["max"]
                    or any(option not in question["options"] for option in value)):
                raise APIError(f"Marque até {question['max']} opções em: {question['text']}")
        elif kind == "scale":
            if type(value) is not int or not 1 <= value <= 5:
                raise APIError(f"Escolha uma nota de 1 a 5 em: {question['text']}")
        else:
            if not isinstance(value, str):
                raise APIError("Confira sua resposta escrita.")
            value = value.strip()
            invalid = any((ord(char) < 32 and char not in "\n\r\t") or 0xD800 <= ord(char) <= 0xDFFF for char in value)
            if len(value) > SURVEY_TEXT_LIMIT or invalid:
                raise APIError(f"A resposta escrita pode ter até {SURVEY_TEXT_LIMIT} caracteres.")
            if not value:
                if question["required"]:
                    raise APIError(f"Responda: {question['text']}")
                continue
        answers[identifier] = value
    return answers


def survey_results(survey, rows):
    """Aggregate answers. Written answers are shuffled so they cannot be matched to other choices."""
    total = len(rows)
    parsed = [json.loads(row["answers"]) for row in rows]
    results = []
    for question in survey["questions"]:
        values = [answer[question["id"]] for answer in parsed if question["id"] in answer]
        item = {key: question[key] for key in ("id", "type", "text") if key in question}
        item["answered"] = len(values)
        if question["type"] in {"single", "multiple"}:
            counts = {option: 0 for option in question["options"]}
            for value in values:
                for option in (value if question["type"] == "multiple" else [value]):
                    if option in counts:
                        counts[option] += 1
            item["options"] = [{"label": label, "count": count} for label, count in counts.items()]
            if question["type"] == "multiple":
                item["max"] = question["max"]
        elif question["type"] == "scale":
            item["options"] = [{"label": str(score), "count": values.count(score)} for score in range(1, 6)]
            item["average"] = round(sum(values) / len(values), 1) if values else None
            item["min_label"], item["max_label"] = question.get("min_label", ""), question.get("max_label", "")
        else:
            texts = list(values)
            secrets.SystemRandom().shuffle(texts)
            item["answers"] = texts
        results.append(item)
    return {"total": total, "questions": results}


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    development = os.environ.get("TIAGO_DEV") == "1"
    app.config.update(
        DATA_DIR=Path(os.environ.get("TIAGO_DATA_DIR", str(Path.home() / ".local/share/tiago-admin"))),
        SITE_ROOT=Path(os.environ.get("TIAGO_SITE_DIR", str(ROOT))),
        ADMIN_ROOT=Path(os.environ.get("TIAGO_ADMIN_DIR", str(ROOT / "admin"))),
        PUBLIC_ORIGIN=os.environ.get("TIAGO_PUBLIC_ORIGIN", "https://tiagoismar.com"),
        COOKIE_SECURE=not development,
        DEV_MODE=development,
        SESSION_SECONDS=8 * 60 * 60,
        MAX_CONTENT_LENGTH=10 * 1024 * 1024,
        MAX_FORM_MEMORY_SIZE=100_000,
        MAX_FORM_PARTS=10,
        TRUSTED_HOSTS=["tiagoismar.com", "www.tiagoismar.com", "127.0.0.1", "localhost"] if development else ["tiagoismar.com", "www.tiagoismar.com"],
    )
    if test_config:
        app.config.update(test_config)
    app.config["DATA_DIR"] = Path(app.config["DATA_DIR"]).resolve()
    app.config["SITE_ROOT"] = Path(app.config["SITE_ROOT"]).resolve()
    app.config["ADMIN_ROOT"] = Path(app.config["ADMIN_ROOT"]).resolve()
    if app.config["DATA_DIR"].is_relative_to(app.config["SITE_ROOT"]):
        raise RuntimeError("TIAGO_DATA_DIR must be outside the public site directory.")
    initialize_database(app.config["DATA_DIR"])
    # Enable only when deployed behind our one trusted, loopback-bound Nginx proxy.
    if os.environ.get("TIAGO_TRUST_PROXY") == "1":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=0, x_port=0)
    dummy_hash = generate_password_hash(secrets.token_urlsafe(24))

    @app.before_request
    def prepare_request():
        g.app_data = app.config["DATA_DIR"]
        g.session = None
        token = request.cookies.get("tiago_session", "")
        if token and re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            g.session = connection().execute(
                "SELECT s.*, u.username FROM sessions s LEFT JOIN users u ON u.id=s.user_id "
                "WHERE token_hash=? AND expires_at>?", (digest(token), int(time.time()))
            ).fetchone()

    @app.teardown_appcontext
    def close_database(error=None):
        db = g.pop("database", None)
        if db is not None:
            db.close()

    @app.errorhandler(APIError)
    def api_error(error):
        return jsonify(error=error.message), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            message = {413: "A imagem deve ter no máximo 8 MB.", 404: "Não encontrado.", 405: "Método não permitido.", 400: "Requisição inválida."}.get(error.code, "Não foi possível concluir a solicitação.")
            return jsonify(error=message), error.code
        return error

    @app.after_request
    def response_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith(("/api/admin", "/admin")):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        if request.path.startswith("/admin"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; "
                "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
            )
        return response

    def rate_limit(scope, limit, seconds):
        db = connection()
        salt = db.execute("SELECT value FROM metadata WHERE key='rate_salt'").fetchone()[0]
        identity = request.remote_addr or "unknown"
        key = digest(salt + "\0" + scope + "\0" + identity)
        bucket = int(time.time()) // seconds
        with db:
            db.execute("DELETE FROM rate_limits WHERE expires_at <= ?", (int(time.time()),))
            db.execute("INSERT INTO rate_limits VALUES (?, ?, 1, ?) ON CONFLICT(key,bucket) DO UPDATE SET hits=hits+1", (key, bucket, (bucket + 1) * seconds))
            hits = db.execute("SELECT hits FROM rate_limits WHERE key=? AND bucket=?", (key, bucket)).fetchone()[0]
        if hits > limit:
            raise APIError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429)

    def require_origin():
        expected = request.host_url.rstrip("/") if app.config["DEV_MODE"] or app.testing else app.config["PUBLIC_ORIGIN"].rstrip("/")
        if request.headers.get("Origin", "").rstrip("/") != expected:
            raise APIError("Origem da solicitação não autorizada.", 403)
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            raise APIError("Origem da solicitação não autorizada.", 403)

    def csrf():
        require_origin()
        supplied = request.headers.get("X-CSRF-Token", "")
        if not g.session or not supplied or not hmac.compare_digest(g.session["csrf"], supplied):
            raise APIError("A sessão mudou. Atualize a página e tente novamente.", 403)

    def authenticated(function):
        @functools.wraps(function)
        def decorated(*args, **kwargs):
            if not g.session or not g.session["user_id"]:
                raise APIError("Entre na sua conta para continuar.", 401)
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                csrf()
            return function(*args, **kwargs)
        return decorated

    def session_response(user_id=None, username=None, rotate=False):
        if not rotate and g.session:
            return jsonify(authenticated=bool(g.session["user_id"]),
                           user={"username": g.session["username"]} if g.session["user_id"] else None,
                           csrf_token=g.session["csrf"])
        rate_limit("session", 60, 60)
        token, csrf_value = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        duration = app.config["SESSION_SECONDS"] if user_id else 1200
        db = connection()
        with db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
            if g.session:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (g.session["token_hash"],))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (digest(token), user_id, csrf_value, int(time.time()) + duration))
        response = jsonify(authenticated=bool(user_id), user={"username": username} if user_id else None, csrf_token=csrf_value)
        response.set_cookie("tiago_session", token, max_age=duration, secure=app.config["COOKIE_SECURE"], httponly=True, samesite="Strict", path="/")
        return response

    def payload():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise APIError("Envie os dados em formato JSON.")
        return data

    def audit(action, target):
        connection().execute("INSERT INTO audit(user_id,action,target,happened_at) VALUES (?,?,?,?)",
                             (g.session["user_id"], action, target, utc_now()))

    def row_item(row):
        return {**json.loads(row["data"]), "id": row["id"], "version": row["version"], "updated_at": row["updated_at"]}

    def records(public=False):
        result = {kind: [] for kind in KINDS}
        for row in connection().execute("SELECT * FROM records WHERE deleted=0"):
            item = row_item(row)
            if not public or item.get("published"):
                result[row["kind"]].append(item)
        if public:
            published_companies = {item["id"] for item in result["companies"]}
            result["catalog_items"] = [item for item in result["catalog_items"] if item["company_id"] in published_companies]
        for kind in KINDS:
            result[kind].sort(key=lambda item: (item.get("sort_order", 0), item["title"].casefold()))
            if public:
                for item in result[kind]:
                    item.pop("version", None)
        result["settings"] = dict(connection().execute("SELECT key,value FROM settings"))
        return result

    def record(kind, item_id):
        if kind not in KINDS:
            raise APIError("Tipo de conteúdo não encontrado.", 404)
        row = connection().execute("SELECT * FROM records WHERE id=? AND kind=? AND deleted=0", (item_id, kind)).fetchone()
        if row is None:
            raise APIError("Conteúdo não encontrado.", 404)
        return row

    def text_field(value, name, max_length, required=False):
        if not isinstance(value, str):
            raise APIError(f"O campo {name} precisa ser um texto.")
        value = value.strip()
        invalid_character = any((ord(char) < 32 and char not in "\n\r\t") or 0xD800 <= ord(char) <= 0xDFFF for char in value)
        if (required and not value) or len(value) > max_length or invalid_character:
            raise APIError(f"Confira o campo {name} (até {max_length} caracteres).")
        return value

    def url_field(value, field):
        value = text_field(value, field, 1200)
        if not value:
            return ""
        try:
            parts = urlsplit(value)
        except ValueError:
            raise APIError(f"Confira o endereço de {field}.") from None
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or "\\" in value or any(char.isspace() for char in value):
            raise APIError(f"Use um endereço HTTPS válido em {field}.")
        try:
            parts.port
        except ValueError:
            raise APIError(f"Confira o endereço de {field}.") from None
        return value

    def image_field(value):
        value = text_field(value, "imagem", 350)
        if not value:
            return ""
        # Uploaded images and existing approved local photos only; never fetch arbitrary URLs.
        if re.fullmatch(r"/media/[a-f0-9]{32}\.webp", value):
            if not (g.app_data / "uploads" / value.rsplit("/", 1)[-1]).is_file():
                raise APIError("A imagem enviada não foi encontrada.")
            return value
        if re.fullmatch(r"/assets/[A-Za-z0-9_./-]+\.(?:webp|jpg|jpeg|png|avif)", value) and ".." not in value:
            candidate = (app.config["SITE_ROOT"] / value.lstrip("/")).resolve()
            if candidate.is_relative_to(app.config["SITE_ROOT"] / "assets") and candidate.is_file():
                return value
        raise APIError("Envie uma imagem pelo painel ou use uma foto existente do site.")

    def registration_event(slug):
        return connection().execute(
            "SELECT id, data FROM records WHERE kind='events' AND deleted=0 "
            "AND json_extract(data, '$.registration_slug')=?",
            (slug,),
        ).fetchone()

    def validated(kind, source, previous=None, item_id=None):
        if kind not in KINDS:
            raise APIError("Tipo de conteúdo não encontrado.", 404)
        unknown = set(source) - FIELDS[kind] - {"version"}
        if unknown:
            raise APIError("O formulário contém campos desconhecidos.")
        data = {field: "" for field in FIELDS[kind]}
        data.update(published=False, sort_order=0)
        if kind == "companies":
            data["is_group"] = False
        if kind == "projects":
            data["status"] = "idea"
        if previous:
            data.update(previous)
        data.update({key: value for key, value in source.items() if key != "version"})
        for key in FIELDS[kind]:
            if key in {"published", "is_group"}:
                if not isinstance(data[key], bool):
                    raise APIError(f"O campo {key} deve ser verdadeiro ou falso.")
            elif key == "sort_order":
                if type(data[key]) is not int or not -10000 <= data[key] <= 10000:
                    raise APIError("A ordem deve ser um número inteiro entre -10000 e 10000.")
            elif key == "image":
                data[key] = image_field(data[key])
            elif key == "url":
                data[key] = url_field(data[key], "link")
            elif key == "registration_slug":
                data[key] = text_field(data[key], "link de confirmação", REGISTRATION_SLUG_LIMIT).lower()
            else:
                limit = {"title": 160, "description": 6000, "city": 100, "location": 250, "company_id": 24, "whatsapp": 20, "start_at": 32, "end_at": 32}.get(key, 150)
                data[key] = text_field(data[key], key, limit, key == "title" or (key == "city" and kind != "catalog_items"))
        if kind == "companies" and data["whatsapp"] and not re.fullmatch(r"[1-9][0-9]{9,14}", data["whatsapp"]):
            raise APIError("Use o WhatsApp com país e DDD, somente números.")
        if kind == "projects" and data["status"] not in {"idea", "planning", "in_progress", "completed"}:
            raise APIError("Escolha uma situação válida para o projeto.")
        if kind == "projects" and data["participation_form"]:
            if data["participation_form"] != "capela-de-fatima":
                raise APIError("Escolha um formulário de projeto válido.")
            existing = connection().execute(
                "SELECT id FROM records WHERE kind='projects' AND deleted=0 "
                "AND json_extract(data, '$.participation_form')=?", (data["participation_form"],)
            ).fetchone()
            if existing and existing["id"] != item_id:
                raise APIError("O formulário da capela já está vinculado a outro projeto.", 409)
        if kind == "catalog_items":
            company = record("companies", data["company_id"])
            if data["published"] and not json.loads(company["data"])["published"]:
                raise APIError("Publique a empresa antes de publicar seus itens de catálogo.")
        if kind == "events":
            slug = data["registration_slug"]
            if slug and not REGISTRATION_SLUG.fullmatch(slug):
                raise APIError("Use apenas letras sem acento, números e hífens no link de confirmação.")
            if slug:
                existing = registration_event(slug)
                if existing and existing["id"] != item_id:
                    raise APIError("Este link de confirmação já pertence a outro evento.", 409)
            if not data["start_at"] and (not slug or data["end_at"]):
                raise APIError("Informe a data e o horário do evento.")
            parsed = []
            for field in ("start_at", "end_at"):
                if data[field]:
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", data[field]):
                        raise APIError("Use uma data e um horário válidos para o evento.")
                    try:
                        parsed.append(datetime.fromisoformat(data[field]))
                    except ValueError:
                        raise APIError("A data do evento é inválida.") from None
            if len(parsed) == 2 and parsed[1] < parsed[0]:
                raise APIError("O encerramento deve acontecer após o início do evento.")
        return data

    @app.get("/api/admin/session")
    def session_info():
        return session_response()

    @app.post("/api/admin/login")
    def login():
        csrf()
        rate_limit("login", 8, 900)
        data = payload()
        username = str(data.get("username", "")).strip().casefold()[:100]
        password = data.get("password", "")
        if not isinstance(password, str) or not 1 <= len(password) <= 1024:
            raise APIError("Usuário ou senha inválidos.", 401)
        user = connection().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        valid = check_password_hash(user["password_hash"] if user else dummy_hash, password)
        if not user or not valid:
            raise APIError("Usuário ou senha inválidos.", 401)
        return session_response(user["id"], user["username"], rotate=True)

    @app.post("/api/admin/logout")
    @authenticated
    def logout():
        return session_response(rotate=True)

    @app.get("/api/public/content")
    def public_content():
        response = jsonify(records(public=True))
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.post("/api/public/events/<slug>/rsvp")
    def confirm_event_presence(slug):
        require_origin()
        if len(slug) > REGISTRATION_SLUG_LIMIT or not REGISTRATION_SLUG.fullmatch(slug):
            raise APIError("Confirmações indisponíveis para este evento.", 404)
        rate_limit("event-rsvp", 30, 60)
        data = payload()
        if set(data) != {"name", "enterprise", "owner_phone"}:
            raise APIError("Informe seu nome, o nome do empreendimento e o telefone do proprietário.")
        name = " ".join(text_field(data["name"], "nome", REGISTRATION_FIELD_LIMIT, required=True).split())
        enterprise = " ".join(
            text_field(data["enterprise"], "empreendimento", REGISTRATION_FIELD_LIMIT, required=True).split()
        )
        phone = text_field(data["owner_phone"], "telefone do proprietário", 32, required=True)
        phone = re.sub(r"[\s().-]+", "", phone)
        if re.fullmatch(r"\+?55[1-9][0-9]{9,10}", phone):
            phone = "+" + phone.lstrip("+")
        elif not re.fullmatch(r"[1-9][0-9]{9,10}", phone):
            raise APIError("Informe um telefone válido com DDD, como (88) 99999-9999.")
        identity = [unicodedata.normalize("NFKC", value).casefold() for value in (name, enterprise)]
        participant_key = digest(json.dumps(identity))
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            event = registration_event(slug)
            if not event or not json.loads(event["data"]).get("published"):
                raise APIError("Confirmações indisponíveis para este evento.", 404)
            db.execute(
                "INSERT INTO event_rsvps(event_id,participant_key,name,enterprise,created_at,owner_phone) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(event_id,participant_key) DO UPDATE "
                "SET owner_phone=excluded.owner_phone WHERE event_rsvps.owner_phone=''",
                (event["id"], participant_key, name, enterprise, utc_now(), phone),
            )
        return jsonify(ok=True)

    @app.get("/api/admin/content")
    @authenticated
    def admin_content():
        content = records()
        counts = dict(connection().execute("SELECT project_id, COUNT(*) FROM project_signups GROUP BY project_id"))
        for project in content["projects"]:
            project["signup_count"] = counts.get(project["id"], 0)
        return jsonify(content)

    @app.get("/api/admin/projects/<project_id>/signups")
    @authenticated
    def project_signup_list(project_id):
        project = json.loads(record("projects", project_id)["data"])
        rows = connection().execute(
            "SELECT submission_id, project_id, name, tribute_name, created_at FROM project_signups WHERE project_id=? "
            "ORDER BY created_at DESC, rowid DESC", (project_id,)
        )
        result = {"signups": [dict(row) for row in rows]}
        if project.get("participation_form") == "capela-de-fatima":
            result["limit"] = chapel_name_limit()
        return jsonify(result)

    @app.post("/api/admin/projects/<project_id>/signups")
    @authenticated
    def admin_create_project_signup(project_id):
        record("projects", project_id)
        data = payload()
        if not isinstance(data, dict):
            raise APIError("Dados inválidos.")
        name = text_field(data.get("name", ""), "seu nome", 120, required=True)
        tribute = text_field(data.get("tribute_name", ""), "nome na capela", 120, required=True)
        if any(not value.isprintable() for value in (name, tribute)):
            raise APIError("Escreva cada nome em uma única linha.")
        token = str(uuid.uuid4())
        created = utc_now()
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO project_signups(project_id, submission_id, name, tribute_name, created_at) VALUES (?,?,?,?,?)",
                (project_id, token, name, tribute, created),
            )
            audit("create_signup", f"projects/{project_id}/signups/{token}")
        return jsonify(
            ok=True,
            signup={
                "submission_id": token,
                "project_id": project_id,
                "name": name,
                "tribute_name": tribute,
                "created_at": created,
            },
        ), 201

    @app.patch("/api/admin/projects/<project_id>/signups/<submission_id>")
    @authenticated
    def admin_update_project_signup(project_id, submission_id):
        data = payload()
        if not isinstance(data, dict):
            raise APIError("Dados inválidos.")
        name = text_field(data.get("name", ""), "seu nome", 120, required=True)
        tribute = text_field(data.get("tribute_name", ""), "nome na capela", 120, required=True)
        if any(not value.isprintable() for value in (name, tribute)):
            raise APIError("Escreva cada nome em uma única linha.")
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT submission_id, created_at FROM project_signups WHERE project_id=? AND submission_id=?",
                (project_id, submission_id),
            ).fetchone()
            if not row:
                raise APIError("Inscrição não encontrada.", 404)
            db.execute(
                "UPDATE project_signups SET name=?, tribute_name=? WHERE project_id=? AND submission_id=?",
                (name, tribute, project_id, submission_id),
            )
            audit("update_signup", f"projects/{project_id}/signups/{submission_id}")
        return jsonify(
            ok=True,
            signup={
                "submission_id": submission_id,
                "project_id": project_id,
                "name": name,
                "tribute_name": tribute,
                "created_at": row["created_at"],
            },
        )

    @app.delete("/api/admin/projects/<project_id>/signups/<submission_id>")
    @authenticated
    def admin_delete_project_signup(project_id, submission_id):
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute(
                "DELETE FROM project_signups WHERE project_id=? AND submission_id=?",
                (project_id, submission_id),
            )
            if not result.rowcount:
                raise APIError("Inscrição não encontrada.", 404)
            audit("delete_signup", f"projects/{project_id}/signups/{submission_id}")
        return jsonify(ok=True)

    def chapel_name_limit():
        value = connection().execute("SELECT value FROM settings WHERE key='chapel_name_limit'").fetchone()[0]
        return int(value) if value else None

    def chapel_signup_count(project_id):
        project = json.loads(record("projects", project_id)["data"])
        if not project["published"] or project.get("participation_form") != "capela-de-fatima":
            raise APIError("As inscrições para este projeto estão indisponíveis.", 404)
        return connection().execute(
            "SELECT COUNT(*) FROM project_signups WHERE project_id=?", (project_id,)
        ).fetchone()[0]

    @app.get("/api/public/projects/<project_id>/participation")
    def project_availability(project_id):
        response = jsonify(registered=chapel_signup_count(project_id), limit=chapel_name_limit())
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/public/projects/<project_id>/participation")
    def register_project_participant(project_id):
        require_origin()
        rate_limit("project-signup", 30, 60)
        data = payload()
        if set(data) != {"submission_id", "name", "tribute_name"}:
            raise APIError("Preencha seu nome e o nome para a homenagem.")
        token = text_field(data["submission_id"], "inscrição", 36)
        if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", token):
            raise APIError("Reabra o formulário e tente novamente.")
        name = text_field(data["name"], "seu nome", 120, required=True)
        tribute = text_field(data["tribute_name"], "nome na capela", 120, required=True)
        if any(not value.isprintable() for value in (name, tribute)):
            raise APIError("Escreva cada nome em uma única linha.")
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            registered = chapel_signup_count(project_id)
            limit = chapel_name_limit()
            saved = db.execute(
                "SELECT name, tribute_name FROM project_signups WHERE project_id=? AND submission_id=?",
                (project_id, token),
            ).fetchone()
            if saved and tuple(saved) != (name, tribute):
                raise APIError("Este pedido já foi registrado com outra grafia. Contate a organização.", 409)
            if not saved:
                if limit is not None and registered >= limit:
                    return jsonify(error="Todas as vagas da capela foram preenchidas.",
                                   registered=registered, limit=limit), 409
                db.execute("INSERT INTO project_signups VALUES (?,?,?,?,?)", (project_id, token, name, tribute, utc_now()))
                registered += 1
        return jsonify(ok=True, registered=registered, limit=limit)

    @app.get("/api/admin/rsvps")
    @authenticated
    def admin_rsvps():
        rows = connection().execute(
            """
            SELECT event.id, event.data, event.deleted, rsvp.participant_key, rsvp.name, rsvp.enterprise, rsvp.created_at, rsvp.owner_phone
              FROM records AS event
              LEFT JOIN event_rsvps AS rsvp ON rsvp.event_id=event.id
             WHERE event.kind='events'
               AND (rsvp.event_id IS NOT NULL OR
                    (event.deleted=0 AND json_extract(event.data, '$.registration_slug') <> ''))
             ORDER BY event.updated_at DESC, event.id, rsvp.created_at DESC, rsvp.rowid DESC
            """
        )
        events = {}
        for row in rows:
            event_id = row["id"]
            if event_id not in events:
                data = json.loads(row["data"])
                events[event_id] = {
                    "id": event_id,
                    "title": data["title"],
                    "registration_slug": "" if row["deleted"] else data.get("registration_slug", ""),
                    "registrations": [],
                }
            if row["name"] is not None:
                events[event_id]["registrations"].append(
                    {key: row[key] for key in ("participant_key", "name", "enterprise", "created_at", "owner_phone")}
                )
        benefactors = connection().execute(
            "SELECT submission_id, project_id, name, tribute_name, created_at FROM project_signups ORDER BY created_at DESC, rowid DESC"
        )
        return jsonify(events=list(events.values()), chapel_signups=[dict(row) for row in benefactors])

    @app.post("/api/admin/events/<event_id>/rsvps")
    @authenticated
    def admin_create_event_rsvp(event_id):
        record("events", event_id)
        data = payload()
        if not isinstance(data, dict):
            raise APIError("Dados inválidos.")
        name = " ".join(text_field(data.get("name", ""), "nome", REGISTRATION_FIELD_LIMIT, required=True).split())
        enterprise = " ".join(
            text_field(data.get("enterprise", ""), "empreendimento", REGISTRATION_FIELD_LIMIT, required=True).split()
        )
        phone = text_field(data.get("owner_phone", ""), "telefone do proprietário", 32, required=True)
        phone = re.sub(r"[\s().-]+", "", phone)
        if re.fullmatch(r"\+?55[1-9][0-9]{9,10}", phone):
            phone = "+" + phone.lstrip("+")
        elif not re.fullmatch(r"[1-9][0-9]{9,10}", phone):
            raise APIError("Informe um telefone válido com DDD, como (88) 99999-9999.")
        identity = [unicodedata.normalize("NFKC", value).casefold() for value in (name, enterprise)]
        participant_key = digest(json.dumps(identity))
        created = utc_now()
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT participant_key FROM event_rsvps WHERE event_id=? AND participant_key=?",
                (event_id, participant_key),
            ).fetchone()
            if existing:
                raise APIError("Já existe uma confirmação com este nome e empreendimento para este evento.", 409)
            db.execute(
                "INSERT INTO event_rsvps(event_id,participant_key,name,enterprise,created_at,owner_phone) "
                "VALUES (?,?,?,?,?,?)",
                (event_id, participant_key, name, enterprise, created, phone),
            )
            audit("create_rsvp", f"events/{event_id}/rsvps/{participant_key}")
        return jsonify(
            ok=True,
            rsvp={
                "event_id": event_id,
                "participant_key": participant_key,
                "name": name,
                "enterprise": enterprise,
                "created_at": created,
                "owner_phone": phone,
            },
        ), 201

    @app.patch("/api/admin/events/<event_id>/rsvps/<participant_key>")
    @authenticated
    def admin_update_event_rsvp(event_id, participant_key):
        record("events", event_id)
        data = payload()
        if not isinstance(data, dict):
            raise APIError("Dados inválidos.")
        name = " ".join(text_field(data.get("name", ""), "nome", REGISTRATION_FIELD_LIMIT, required=True).split())
        enterprise = " ".join(
            text_field(data.get("enterprise", ""), "empreendimento", REGISTRATION_FIELD_LIMIT, required=True).split()
        )
        phone = text_field(data.get("owner_phone", ""), "telefone do proprietário", 32, required=True)
        phone = re.sub(r"[\s().-]+", "", phone)
        if re.fullmatch(r"\+?55[1-9][0-9]{9,10}", phone):
            phone = "+" + phone.lstrip("+")
        elif not re.fullmatch(r"[1-9][0-9]{9,10}", phone):
            raise APIError("Informe um telefone válido com DDD, como (88) 99999-9999.")
        identity = [unicodedata.normalize("NFKC", value).casefold() for value in (name, enterprise)]
        new_key = digest(json.dumps(identity))
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute(
                "SELECT participant_key, created_at FROM event_rsvps WHERE event_id=? AND participant_key=?",
                (event_id, participant_key),
            ).fetchone()
            if not current:
                raise APIError("Confirmação não encontrada.", 404)
            if new_key != participant_key:
                conflict = db.execute(
                    "SELECT participant_key FROM event_rsvps WHERE event_id=? AND participant_key=?",
                    (event_id, new_key),
                ).fetchone()
                if conflict:
                    raise APIError("Já existe outra confirmação com este nome e empreendimento para este evento.", 409)
            db.execute(
                "UPDATE event_rsvps SET participant_key=?, name=?, enterprise=?, owner_phone=? WHERE event_id=? AND participant_key=?",
                (new_key, name, enterprise, phone, event_id, participant_key),
            )
            audit("update_rsvp", f"events/{event_id}/rsvps/{new_key}")
        return jsonify(
            ok=True,
            rsvp={
                "event_id": event_id,
                "participant_key": new_key,
                "name": name,
                "enterprise": enterprise,
                "created_at": current["created_at"],
                "owner_phone": phone,
            },
        )

    @app.delete("/api/admin/events/<event_id>/rsvps/<participant_key>")
    @authenticated
    def admin_delete_event_rsvp(event_id, participant_key):
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute(
                "DELETE FROM event_rsvps WHERE event_id=? AND participant_key=?",
                (event_id, participant_key),
            )
            if not result.rowcount:
                raise APIError("Confirmação não encontrada.", 404)
            audit("delete_rsvp", f"events/{event_id}/rsvps/{participant_key}")
        return jsonify(ok=True)

    @app.post("/api/admin/<kind>")
    @authenticated
    def create_record(kind):
        source = payload()
        db = connection()
        item_id = secrets.token_hex(12)
        with db:
            # Parent validation and child write share the writer lock. A company
            # cannot disappear or be unpublished between validation and insert.
            db.execute("BEGIN IMMEDIATE")
            data = validated(kind, source)
            if db.execute("SELECT COUNT(*) FROM records WHERE deleted=0").fetchone()[0] >= MAX_RECORDS:
                raise APIError("O limite de conteúdos foi atingido.", 409)
            db.execute("INSERT INTO records(id,kind,data,updated_at) VALUES(?,?,?,?)", (item_id, kind, json.dumps(data, ensure_ascii=False), utc_now()))
            audit("create", kind + "/" + item_id)
            item = row_item(record(kind, item_id))
        return jsonify(item=item), 201

    @app.patch("/api/admin/<kind>/<item_id>")
    @authenticated
    def update_record(kind, item_id):
        source = payload()
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            row = record(kind, item_id)
            if type(source.get("version")) is not int or source["version"] != row["version"]:
                raise APIError("Este conteúdo mudou em outra aba. Atualize antes de salvar.", 409)
            data = validated(kind, source, json.loads(row["data"]), item_id)
            result = db.execute("UPDATE records SET data=?, version=version+1, updated_at=? WHERE id=? AND version=? AND deleted=0",
                                (json.dumps(data, ensure_ascii=False), utc_now(), item_id, source["version"]))
            if not result.rowcount:
                raise APIError("Este conteúdo mudou em outra aba. Atualize antes de salvar.", 409)
            audit("update", kind + "/" + item_id)
            item = row_item(record(kind, item_id))
        return jsonify(item=item)

    @app.delete("/api/admin/<kind>/<item_id>")
    @authenticated
    def delete_record(kind, item_id):
        row = record(kind, item_id)
        version = payload().get("version")
        if type(version) is not int or version != row["version"]:
            raise APIError("Este conteúdo mudou em outra aba. Atualize antes de excluir.", 409)
        db = connection()
        with db:
            result = db.execute("UPDATE records SET deleted=1, version=version+1, updated_at=? WHERE id=? AND version=? AND deleted=0", (utc_now(), item_id, version))
            if not result.rowcount:
                raise APIError("Este conteúdo mudou em outra aba. Atualize antes de excluir.", 409)
            if kind == "companies":
                for child in db.execute("SELECT * FROM records WHERE kind='catalog_items' AND deleted=0").fetchall():
                    if json.loads(child["data"]).get("company_id") == item_id:
                        db.execute("UPDATE records SET deleted=1, version=version+1, updated_at=? WHERE id=?", (utc_now(), child["id"]))
            audit("delete", kind + "/" + item_id)
        return jsonify(ok=True)

    @app.patch("/api/admin/settings")
    @authenticated
    def update_settings():
        data = payload()
        if not data or set(data) - SETTING_LIMITS.keys():
            raise APIError("Confira os campos de configuração.")
        for key, value in data.items():
            data[key] = text_field(value, key, SETTING_LIMITS[key], required=key not in {"catalog_url", "chapel_name_limit"})
        limit = data.get("chapel_name_limit")
        if limit and (not re.fullmatch(r"[1-9][0-9]*", limit) or int(limit) > 2**53 - 1):
            raise APIError("Informe um número inteiro de nomes, a partir de 1.")
        if "catalog_url" in data:
            data["catalog_url"] = url_field(data["catalog_url"], "link do catálogo")
        if "contact_whatsapp" in data and not re.fullmatch(r"[1-9][0-9]{9,14}", data["contact_whatsapp"]):
            raise APIError("Use o WhatsApp com país e DDD, somente números.")
        db = connection()
        with db:
            for key, value in data.items():
                db.execute("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
            audit("settings", ",".join(sorted(data)))
        return jsonify(settings=dict(db.execute("SELECT key,value FROM settings")))

    @app.post("/api/admin/upload")
    @authenticated
    def upload():
        rate_limit("upload", 40, 3600)
        incoming = request.files.get("file")
        if not incoming:
            raise APIError("Escolha uma imagem JPEG, PNG ou WebP.")
        contents = incoming.read(8 * 1024 * 1024 + 1)
        if len(contents) > 8 * 1024 * 1024:
            raise APIError("A imagem deve ter no máximo 8 MB.", 413)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                image = Image.open(io.BytesIO(contents))
                if image.format not in {"JPEG", "PNG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
                    raise APIError("Use uma imagem estática JPEG, PNG ou WebP.")
                image.load()
                image = ImageOps.exif_transpose(image)
                image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
                image = image.convert("RGBA" if image.mode in {"RGBA", "LA"} or "transparency" in image.info else "RGB")
                filename = secrets.token_hex(16) + ".webp"
                image.save(g.app_data / "uploads" / filename, "WEBP", quality=86, method=4)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise APIError("Não foi possível ler essa imagem. Use um JPEG, PNG ou WebP válido.") from None
        return jsonify(url="/media/" + filename), 201

    @app.get("/media/<filename>")
    def media(filename):
        if not re.fullmatch(r"[a-f0-9]{32}\.webp", filename):
            raise APIError("Imagem não encontrada.", 404)
        if not g.session or not g.session["user_id"]:
            public = records(public=True)
            if not any(item.get("image") == "/media/" + filename for kind in KINDS for item in public[kind]):
                raise APIError("Imagem não encontrada.", 404)
        response = send_from_directory(g.app_data / "uploads", filename, mimetype="image/webp", max_age=0)
        # A draft image should not remain in a shared cache after unpublishing.
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.post("/api/visit")
    def visit():
        require_origin()
        if g.session and g.session["user_id"]:
            return jsonify(ok=True, counted=False)
        if re.search(r"bot|crawl|spider|headless|preview", request.user_agent.string, re.I):
            return jsonify(ok=True, counted=False)
        section = payload().get("section")
        if not isinstance(section, str) or section not in SECTIONS:
            raise APIError("Seção inválida.")
        rate_limit("metrics", 80, 3600)
        local_day = datetime.now(ZoneInfo("America/Fortaleza")).date().isoformat()
        db = connection()
        with db:
            db.execute("INSERT INTO views VALUES(?,?,1) ON CONFLICT(date,section) DO UPDATE SET views=views+1", (local_day, section))
        return jsonify(ok=True, counted=True)

    @app.get("/api/admin/stats")
    @authenticated
    def stats():
        today = datetime.now(ZoneInfo("America/Fortaleza")).date()
        db = connection()
        rows = dict(db.execute("SELECT date, SUM(views) FROM views WHERE section='inicio' AND date>=? GROUP BY date", ((today - timedelta(days=29)).isoformat(),)))
        daily = [{"date": (today - timedelta(days=offset)).isoformat(), "views": rows.get((today - timedelta(days=offset)).isoformat(), 0)} for offset in range(29, -1, -1)]
        by_section = [{"section": row[0], "views": row[1]} for row in db.execute("SELECT section, SUM(views) FROM views GROUP BY section ORDER BY SUM(views) DESC")]
        total = db.execute("SELECT COALESCE(SUM(views),0) FROM views WHERE section='inicio'").fetchone()[0]
        since = db.execute("SELECT value FROM metadata WHERE key='metrics_since'").fetchone()[0]
        return jsonify(today=rows.get(today.isoformat(), 0), total=total, last_30_days=daily, by_section=by_section, since=since)

    @app.get("/api/admin/export")
    @authenticated
    def export():
        response = jsonify(exported_at=utc_now(), content=records())
        response.headers["Content-Disposition"] = 'attachment; filename="tiago-conteudos.json"'
        return response

    # Anonymous surveys: responses keep only the answers and the day, never IP, name or session.
    def survey_row(survey_id=None, slug=None):
        column, value = ("id", survey_id) if survey_id is not None else ("slug", slug)
        row = connection().execute(f"SELECT * FROM surveys WHERE {column}=? AND deleted=0", (value,)).fetchone()
        if row is None:
            raise APIError("Pesquisa não encontrada.", 404)
        return row

    def survey_item(row, with_count=True):
        item = {**json.loads(row["data"]), "id": row["id"], "slug": row["slug"], "updated_at": row["updated_at"]}
        if with_count:
            item["responses"] = connection().execute(
                "SELECT COUNT(*) FROM survey_responses WHERE survey_id=?", (row["id"],)).fetchone()[0]
        return item

    def survey_slug(value):
        slug = text_field(value, "link da pesquisa", REGISTRATION_SLUG_LIMIT, required=True).lower()
        if not REGISTRATION_SLUG.fullmatch(slug):
            raise APIError("Use apenas letras sem acento, números e hífens no link da pesquisa.")
        return slug

    def survey_link(slug):
        origin = request.host_url.rstrip("/") if app.config["DEV_MODE"] or app.testing else app.config["PUBLIC_ORIGIN"].rstrip("/")
        return f"{origin}/pesquisa/?s={slug}"

    @app.get("/api/public/surveys/<slug>")
    def public_survey(slug):
        if len(slug) > REGISTRATION_SLUG_LIMIT or not REGISTRATION_SLUG.fullmatch(slug):
            raise APIError("Pesquisa não encontrada.", 404)
        item = survey_item(survey_row(slug=slug), with_count=False)
        response = jsonify({key: item[key] for key in ("slug", "title", "intro", "thanks", "open", "questions")})
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.post("/api/public/surveys/<slug>/responses")
    def answer_survey(slug):
        require_origin()
        if len(slug) > REGISTRATION_SLUG_LIMIT or not REGISTRATION_SLUG.fullmatch(slug):
            raise APIError("Pesquisa não encontrada.", 404)
        # A whole meeting room may share one Wi-Fi address, so the limit is generous.
        rate_limit("survey-response", 300, 600)
        data = payload()
        row = survey_row(slug=slug)
        survey = json.loads(row["data"])
        if not survey.get("open"):
            raise APIError("Esta pesquisa já foi encerrada. Obrigado pelo interesse!", 409)
        answers = survey_answers(survey, data.get("answers"))
        if not answers:
            raise APIError("Responda pelo menos uma pergunta.")
        local_day = datetime.now(ZoneInfo("America/Fortaleza")).date().isoformat()
        db = connection()
        with db:
            db.execute("INSERT INTO survey_responses(id,survey_id,answers,answered_on) VALUES (?,?,?,?)",
                       (secrets.token_hex(16), row["id"], json.dumps(answers, ensure_ascii=False), local_day))
        return jsonify(ok=True, thanks=survey.get("thanks", ""))

    @app.get("/api/admin/surveys")
    @authenticated
    def admin_surveys():
        rows = connection().execute("SELECT * FROM surveys WHERE deleted=0 ORDER BY created_at DESC").fetchall()
        return jsonify(surveys=[{**survey_item(row), "link": survey_link(row["slug"])} for row in rows])

    @app.post("/api/admin/surveys")
    @authenticated
    def create_survey():
        source = payload()
        slug = survey_slug(source.get("slug", ""))
        data = survey_definition(source, text_field)
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM surveys WHERE slug=? AND deleted=0", (slug,)).fetchone():
                raise APIError("Este link já pertence a outra pesquisa.", 409)
            survey_id = secrets.token_hex(12)
            db.execute("INSERT INTO surveys(id,slug,data,created_at,updated_at) VALUES (?,?,?,?,?)",
                       (survey_id, slug, json.dumps(data, ensure_ascii=False), utc_now(), utc_now()))
            audit("create", f"surveys:{survey_id}")
        return jsonify(survey_item(survey_row(survey_id))), 201

    @app.patch("/api/admin/surveys/<survey_id>")
    @authenticated
    def update_survey(survey_id):
        source = payload()
        db = connection()
        with db:
            db.execute("BEGIN IMMEDIATE")
            row = survey_row(survey_id)
            previous = json.loads(row["data"])
            merged = {**previous, **{key: value for key, value in source.items() if key != "slug"}}
            slug = survey_slug(source["slug"]) if "slug" in source else row["slug"]
            data = survey_definition(merged, text_field)
            responses = db.execute("SELECT COUNT(*) FROM survey_responses WHERE survey_id=?", (survey_id,)).fetchone()[0]
            if responses and "questions" in source and data["questions"] != previous["questions"]:
                raise APIError("Esta pesquisa já tem respostas. Para mudar as perguntas, apague as respostas antes.", 409)
            if slug != row["slug"] and db.execute("SELECT 1 FROM surveys WHERE slug=? AND deleted=0", (slug,)).fetchone():
                raise APIError("Este link já pertence a outra pesquisa.", 409)
            db.execute("UPDATE surveys SET slug=?, data=?, updated_at=? WHERE id=?",
                       (slug, json.dumps(data, ensure_ascii=False), utc_now(), survey_id))
            audit("update", f"surveys:{survey_id}")
        return jsonify(survey_item(survey_row(survey_id)))

    @app.delete("/api/admin/surveys/<survey_id>")
    @authenticated
    def delete_survey(survey_id):
        db = connection()
        with db:
            survey_row(survey_id)
            db.execute("UPDATE surveys SET deleted=1, updated_at=? WHERE id=?", (utc_now(), survey_id))
            audit("delete", f"surveys:{survey_id}")
        return jsonify(ok=True)

    @app.delete("/api/admin/surveys/<survey_id>/responses")
    @authenticated
    def clear_survey_responses(survey_id):
        db = connection()
        with db:
            survey_row(survey_id)
            removed = db.execute("DELETE FROM survey_responses WHERE survey_id=?", (survey_id,)).rowcount
            audit("clear-responses", f"surveys:{survey_id}")
        return jsonify(ok=True, removed=removed)

    @app.get("/api/admin/surveys/<survey_id>/results")
    @authenticated
    def survey_results_view(survey_id):
        row = survey_row(survey_id)
        survey = json.loads(row["data"])
        rows = connection().execute("SELECT answers FROM survey_responses WHERE survey_id=?", (survey_id,)).fetchall()
        return jsonify(survey={"id": row["id"], "slug": row["slug"], "title": survey["title"], "open": survey["open"],
                               "link": survey_link(row["slug"])},
                       **survey_results(survey, rows))

    @app.get("/api/admin/surveys/<survey_id>/qr.<extension>")
    @authenticated
    def survey_qr(survey_id, extension):
        if extension not in {"svg", "png"}:
            raise APIError("Não encontrado.", 404)
        import segno  # Imported lazily so the public site never depends on it.
        row = survey_row(survey_id)
        code = segno.make(survey_link(row["slug"]), error="m")
        buffer = io.BytesIO()
        if extension == "svg":
            code.save(buffer, kind="svg", scale=10, border=2, dark="#13231b", light="#ffffff", xmldecl=False)
            mimetype = "image/svg+xml"
        else:
            code.save(buffer, kind="png", scale=24, border=2, dark="#13231b", light="#ffffff")
            mimetype = "image/png"
        response = app.response_class(buffer.getvalue(), mimetype=mimetype)
        if request.args.get("download") == "1":
            response.headers["Content-Disposition"] = f'attachment; filename="qrcode-{row["slug"]}.{extension}"'
        return response

    @app.get("/api/health")
    def health():
        connection().execute("SELECT 1").fetchone()
        return jsonify(ok=True)

    @app.get("/admin")
    @app.get("/admin/")
    def admin_page():
        return send_from_directory(app.config["ADMIN_ROOT"], "index.html")

    @app.get("/admin/apresentar")
    def admin_presentation():
        return send_from_directory(app.config["ADMIN_ROOT"], "apresentar.html")

    @app.get("/admin/<path:filename>")
    def admin_asset(filename):
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.(?:css|js|svg|webp|png|woff2)", filename):
            raise APIError("Não encontrado.", 404)
        return send_from_directory(app.config["ADMIN_ROOT"], filename)

    # Preview serves the existing static site through an explicit allowlist only.
    # Production Nginx continues serving these files independently.
    @app.get("/")
    def home():
        return send_from_directory(app.config["SITE_ROOT"], "index.html")

    @app.get("/pesquisa/")
    def survey_page():
        return send_from_directory(app.config["SITE_ROOT"] / "pesquisa", "index.html")

    @app.get("/<directory>/<path:filename>")
    def public_asset(directory, filename):
        if directory not in {"assets", "css", "js"} or not re.fullmatch(r"[A-Za-z0-9_./-]+", filename) or ".." in filename:
            raise APIError("Não encontrado.", 404)
        if Path(filename).suffix.lower() not in {".css", ".js", ".svg", ".webp", ".jpg", ".jpeg", ".png", ".avif", ".ico", ".woff", ".woff2"}:
            raise APIError("Não encontrado.", 404)
        return send_from_directory(app.config["SITE_ROOT"] / directory, filename)

    return app


def upsert_admin(app, username, password, *, replace=False):
    """Provision through a trusted CLI/test harness, never through a public endpoint."""
    username = username.strip().casefold()
    short_name = re.fullmatch(r"[a-z0-9_.-]{3,50}", username)
    email_name = len(username) <= 80 and re.fullmatch(
        r"[a-z0-9][a-z0-9_.+%-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",
        username,
    )
    if not short_name and not email_name:
        raise ValueError("Use um e-mail de até 80 caracteres ou um nome de usuário válido.")
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError("Use uma senha com pelo menos 12 caracteres.")
    db = sqlite3.connect(app.config["DATA_DIR"] / "content.sqlite3")
    try:
        with db:
            existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if replace and not existing:
                raise ValueError("Esse usuário não existe. Use init-admin para criar um acesso.")
            if existing and not replace:
                raise ValueError("Esse usuário já existe. Use reset-password para alterar a senha.")
            if existing:
                db.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(password), existing[0]))
                db.execute("DELETE FROM sessions WHERE user_id=?", (existing[0],))
            else:
                db.execute("INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)", (username, generate_password_hash(password), utc_now()))
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("serve", "init-admin", "reset-password", "backup"), default="serve")
    parser.add_argument("--username")
    parser.add_argument("--output", help="Backup destination outside the public site; backup command only.")
    args = parser.parse_args()
    app = create_app()
    if args.command in {"init-admin", "reset-password"}:
        username = args.username or input("Usuário: ")
        if args.command == "reset-password" and input("Revogar sessões e alterar a senha deste usuário? [sim/N] ").strip().casefold() != "sim":
            raise SystemExit("Nenhuma alteração realizada.")
        password = getpass.getpass("Nova senha (mínimo 12 caracteres): ")
        confirmation = getpass.getpass("Repita a senha: ")
        if password != confirmation:
            raise SystemExit("As senhas não conferem. Nenhuma alteração realizada.")
        try:
            upsert_admin(app, username, password, replace=args.command == "reset-password")
        except ValueError as error:
            raise SystemExit(str(error)) from None
        del password, confirmation
        print("Acesso configurado.")
    elif args.command == "backup":
        if not args.output:
            raise SystemExit("Informe --output fora da raiz pública.")
        destination = Path(args.output).resolve()
        if destination.exists() or destination.is_relative_to(app.config["SITE_ROOT"]):
            raise SystemExit("O destino deve ser novo e ficar fora da raiz pública.")
        with sqlite3.connect(app.config["DATA_DIR"] / "content.sqlite3") as source:
            with sqlite3.connect(destination) as target:
                source.backup(target)
        print("Banco copiado. As imagens ficam em TIAGO_DATA_DIR/uploads; copie-as no backup também.")
    else:
        if not app.config["DEV_MODE"]:
            raise SystemExit("Produção: use gunicorn 'server.app:create_app()' --bind 127.0.0.1:4180. Preview: defina TIAGO_DEV=1.")
        app.run(host="127.0.0.1", port=4180, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
