"""Disposable Supabase Auth, PostgREST and PostgreSQL stack for the cloud browser suite."""

import base64
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def http(url, body=None, headers=None, method=None):
    request = Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urlopen(request, timeout=12) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def docker(*args, data=None, env=None, check=True):
    result = subprocess.run(
        ["docker", *args],
        input=data,
        text=True,
        capture_output=True,
        env={**os.environ, **(env or {})},
        check=False,
    )
    if check and result.returncode:
        raise RuntimeError("Docker operation failed: " + args[0] + " " + result.stderr[-500:])
    return result.stdout.strip()


def token(secret, role):
    def encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    unsigned = b".".join(
        encode(json.dumps(x).encode())
        for x in ({"alg": "HS256", "typ": "JWT"}, {"role": role, "exp": int(time.time()) + 3600})
    )
    return (
        unsigned + b"." + encode(hmac.new(secret.encode(), unsigned, hashlib.sha256).digest())
    ).decode()


def wait(check, name):
    for _ in range(100):
        try:
            if check():
                return
        except (URLError, OSError):
            pass
        time.sleep(0.25)
    raise RuntimeError(name + " did not become ready")


@contextmanager
def stack():
    network = "ac-test-" + secrets.token_hex(5)
    containers = []
    docker("network", "create", network)

    def start(name, image, env, port=None):
        full = network + "-" + name
        args = ["run", "-d", "--name", full, "--network", network, "--network-alias", name]
        if port:
            args += ["-p", "127.0.0.1::" + str(port)]
        for key in env:
            args += ["-e", key]
        docker(*args, image, env=env)
        containers.append(full)
        if port:
            address = docker("port", full, str(port) + "/tcp").splitlines()[0]
            return "http://" + address

    secret = secrets.token_hex(32)
    password = secrets.token_hex(18)
    db = network + "-pg"

    def sql(text):
        return docker(
            "exec",
            "-i",
            db,
            "psql",
            "-X",
            "-qAt",
            "-U",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            data=text,
        )

    try:
        start("pg", "postgres:17-alpine", {"POSTGRES_PASSWORD": password})
        wait(
            lambda: "accepting connections"
            in docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", check=False),
            "Postgres",
        )
        sql(f"""create role anon; create role authenticated; create role service_role;
            create role ac_rest login password '{password}'; grant anon,authenticated to ac_rest;
            create role supabase_auth_admin login password '{password}';
            create schema auth authorization supabase_auth_admin;
            alter role supabase_auth_admin set search_path=auth,public;
            create extension if not exists pgcrypto; grant usage on schema public to supabase_auth_admin;""")
        smtp = start("mail", "axllent/mailpit:v1.21.8", {}, 8025)
        auth = start(
            "auth",
            "supabase/gotrue:v2.177.0",
            {
                "API_EXTERNAL_URL": "http://localhost",
                "GOTRUE_API_HOST": "0.0.0.0",
                "GOTRUE_API_PORT": "9999",
                "GOTRUE_SITE_URL": "http://localhost",
                "GOTRUE_DB_DRIVER": "postgres",
                "GOTRUE_DB_DATABASE_URL": f"postgres://supabase_auth_admin:{password}@pg:5432/postgres?sslmode=disable",
                "GOTRUE_JWT_SECRET": secret,
                "GOTRUE_JWT_AUD": "authenticated",
                "GOTRUE_JWT_DEFAULT_GROUP_NAME": "authenticated",
                "GOTRUE_JWT_ADMIN_ROLES": "service_role",
                "GOTRUE_DISABLE_SIGNUP": "true",
                "GOTRUE_EXTERNAL_EMAIL_ENABLED": "true",
                "GOTRUE_SMTP_HOST": "mail",
                "GOTRUE_SMTP_PORT": "1025",
                "GOTRUE_SMTP_ADMIN_EMAIL": "journal@example.test",
                "GOTRUE_LOG_LEVEL": "error",
            },
            9999,
        )
        wait(lambda: http(auth + "/health")[0] == 200, "Supabase Auth")
        sql("""create or replace function auth.uid() returns uuid stable language sql as $$
          select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
          grant usage on schema auth to authenticated,anon;""")
        migration = (ROOT / "supabase/migrations/001_private_archive.sql").read_text()
        sql(migration)
        sql(migration)
        rest = start(
            "rest",
            "postgrest/postgrest:v12.2.3",
            {
                "PGRST_DB_URI": f"postgres://ac_rest:{password}@pg:5432/postgres",
                "PGRST_DB_SCHEMAS": "public",
                "PGRST_DB_ANON_ROLE": "anon",
                "PGRST_JWT_SECRET": secret,
                "PGRST_LOG_LEVEL": "crit",
            },
            3000,
        )
        wait(lambda: http(rest + "/")[0] == 200, "PostgREST")
        admin = {"Authorization": "Bearer " + token(secret, "service_role")}
        users = []
        for name in ("first", "second"):
            email = name + "@archive.example.test"
            login = secrets.token_urlsafe(18)
            status, raw = http(
                auth + "/admin/users",
                {"email": email, "password": login, "email_confirm": True},
                admin,
            )
            assert status in (200, 201), ("create fixture", status)
            users.append((email, login, json.loads(raw)["id"]))
        checks = (ROOT / "tests/cloud/security.sql").read_text()
        for fixture, user in zip(
            ("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"), users
        ):
            checks = checks.replace(fixture, user[2])
        sql(checks)
        yield dict(auth=auth, rest=rest, mail=smtp, users=users, sql=sql)
    finally:
        # All names include this invocation's random prefix. Remove only this test's containers and volumes.
        for container in reversed(containers):
            docker("rm", "-fv", container, check=False)
        docker("network", "rm", network, check=False)
