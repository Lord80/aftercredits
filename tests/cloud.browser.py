"""Real Supabase Auth, PostgREST and PostgreSQL; two disposable Chromium devices."""

from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import sys
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent / "cloud"))
from stack import ROOT, http, stack

HOST = "ac-browser-fixture.supabase.co"
PROJECT = "https://" + HOST
GUEST = "aftercredits.collection.v2"
SESSION = "aftercredits.cloud.v1." + HOST + ".session"
AT = "2024-06-01T22:18:30.100000+05:30"


def record(id_, title, media="movie", **extra):
    return (
        dict(id=id_, mediaType=media, title=title, rating=8.5, added=AT, tmdbId=None, metadata=None)
        | extra
    )


MOVIE = record(
    "legacy-film",
    "Window Seat · 朝",
    tmdbId=42,
    metadata=dict(
        genres=[dict(id=18, name="Drama")],
        originalLanguage="ja",
        releaseDate="2023-04-08",
        posterPath="/window.jpg",
        overview="Fixture.",
    ),
    edition={"cut": "Festival"},
)
SERIES = record("manual-tv", "Morning Paper", "tv")
GUEST_BYTES = json.dumps(dict(version=2, entries=[MOVIE, SERIES]), ensure_ascii=False, indent=2)


@contextmanager
def site(registration=False, captcha="", recovery=True):
    class Pages(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if not self.path.startswith("/aftercredits/"):
                self.send_error(404)
                return
            self.path = self.path[len("/aftercredits") :]
            if self.path == "/js/account-config.js":
                data = (
                    "export const allowRegistration="
                    + json.dumps(registration)
                    + ",turnstileSiteKey="
                    + json.dumps(captcha)
                    + ",recoveryEmailEnabled="
                    + json.dumps(recovery)
                    + ";"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript")
                self.end_headers()
                self.wfile.write(data)
                return
            if self.path == "/js/cloud-config.js":
                data = (
                    "export const projectUrl='"
                    + PROJECT
                    + "'; export const publishableKey='sb_publishable_browserfixture';"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            super().do_GET()

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Pages, directory=ROOT)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/aftercredits/"
        finally:
            server.shutdown()


def button(page, name):
    return page.get_by_role("button", name=name, exact=True)


def account(page):
    if not page.locator("#account-dialog").is_visible():
        page.locator("#account-open").click()
    expect(page.locator("#account-dialog")).to_be_visible()
    if read(page, SESSION) and page.locator("#account-heading").inner_text() != "Overview":
        page.locator("[data-center=overview]").click()


def vault(page):
    if not page.locator("#vault").is_visible():
        account(page)
        page.locator("[data-center=data]").click()
        expect(page.locator("#vault")).to_be_visible()


def device(browser, url, services, mobile=False):
    ctx = browser.new_context(
        viewport=dict(width=390 if mobile else 1440, height=844 if mobile else 960),
        reduced_motion="reduce",
        accept_downloads=True,
    )
    control = dict(block=False, drop=False, lost=False)
    errors = []

    def gateway(route):
        req = route.request
        path = req.url.removeprefix(PROJECT)
        if control["block"] or (control.get("block_rpc") and path.startswith("/rest/")):
            return route.abort()
        headers = {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "POST, PUT, GET, OPTIONS",
            "content-type": "application/json",
        }
        if req.method == "OPTIONS":
            return route.fulfill(status=200, headers=headers)
        service, relative = (
            ("auth", path.removeprefix("/auth/v1"))
            if path.startswith("/auth/v1/")
            else ("rest", path.removeprefix("/rest/v1"))
        )
        if (
            control.get("page_failure")
            and relative == "/rpc/ac_pull"
            and req.post_data_json["pinned_head"] is not None
        ):
            return route.fulfill(status=503, headers=headers, body="{}")
        code, raw = http(
            services[service] + relative,
            req.post_data_json if req.post_data else None,
            {k: v for k, v in req.headers.items() if k in ("authorization", "apikey")},
            req.method,
        )
        if "--verbose" in sys.argv:
            print("fixture", relative.split("?")[0], code, flush=True)
        if control["drop"] and relative == "/rpc/ac_apply" and code == 200:
            control.update(drop=False, block=True, lost=True)
            return route.abort()
        route.fulfill(status=code, headers=headers, body=raw)

    ctx.route(PROJECT + "/**", gateway)
    ctx.route("https://image.tmdb.org/**", lambda r: r.abort())
    page = ctx.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(8500)
    page.goto(url)
    return ctx, page, control, errors


def login(page, email, password):
    account(page)
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    button(page, "Sign in").click()


def capture(page, folder, name):
    if folder is None:
        return
    from PIL import Image

    folder.mkdir(parents=True, exist_ok=True)
    Image.open(BytesIO(page.screenshot(animations="disabled"))).convert("RGB").save(
        folder / (name + ".webp"), quality=83
    )


def signed_in(page, uid=None):
    page.wait_for_function("key=>JSON.parse(localStorage.getItem(key))?.linked", arg=SESSION)
    page.wait_for_function("async()=>!!(await import('./js/cloud/scope.js')).owner")
    if uid:
        assert json.loads(read(page, SESSION))["id"] == uid
    expect(page.locator("#account-dialog")).to_be_hidden()
    assert not page.locator("#vault").is_visible()


def synced(page):
    account(page)
    expect(page.locator(".cloud-state")).to_have_text("All changes saved", timeout=16000)


def force(page):
    account(page)
    key = "aftercredits.cloud.v1." + HOST + "." + json.loads(read(page, SESSION))["id"] + ".archive"
    last = json.loads(read(page, key))["lastSync"]
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function(
        "([k,last])=>{const c=JSON.parse(localStorage[k]);return c.lastSync!==last&&!c.pending.length&&!c.flight}",
        arg=[key, last],
        timeout=16000,
    )
    expect(page.locator(".cloud-state")).to_have_text("All changes saved")


def signout(page):
    account(page)
    if not page.locator("#center-signout").is_visible():
        page.locator("[data-center=security]").click()
        button(page, "Sign out of this device").click()
    else:
        page.locator("#center-signout").click()
    page.wait_for_function("key=>!localStorage.getItem(key)", arg=SESSION)
    page.wait_for_function("async()=>!(await import('./js/cloud/scope.js')).owner")
    account(page)
    expect(button(page, "Sign in")).to_be_visible()


def entries(page):
    return page.evaluate("async()=> (await import('./js/collection.js')).snapshot().items")


def change(page, data):
    return page.evaluate(
        "async args => (await import('./js/collection.js')).changeMovie(args)", data
    )


def read(page, key):
    return page.evaluate("k=>localStorage.getItem(k)", key)


def run(browser, url, s, folder):
    a, pa, net, errors = device(browser, url, s)
    b, pb, net2, errors2 = device(browser, url, s, True)
    email, pw, uid = s["users"][0]
    key = "aftercredits.cloud.v1." + HOST + "." + uid + ".archive"

    def head():
        return int(s["sql"]("select coalesce(max(revision),0) from aftercredits_private.heads"))

    pa.evaluate("([k,v])=>localStorage.setItem(k,v)", [GUEST, GUEST_BYTES])
    pa.reload()
    pa.locator('[data-layout="gallery"]').click()
    pa.locator("#query").fill("Window Seat")
    account(pa)
    expect(button(pa, "Create account")).to_have_count(0)
    assert http(s["auth"] + "/signup", dict(email="off@example.test", password=pw))[0] in (
        400,
        403,
        422,
    )
    capture(pa, folder, "signin-desktop")
    pa.get_by_label("Password", exact=True).fill("temporary")
    button(pa, "Show password").click()
    expect(pa.get_by_label("Password", exact=True)).to_have_attribute("type", "text")
    button(pa, "Hide password").click()
    login(pa, email, "incorrect-password")
    expect(pa.locator("#account-message")).to_contain_text("email and password")
    # A failed durable connection must stay in the guest archive.
    pa.evaluate(
        """k=>{const original=Storage.prototype.setItem; window.restoreStorage=()=>{Storage.prototype.setItem=original};
      Storage.prototype.setItem=function(name,value){if(name===k)throw new DOMException('Fixture','QuotaExceededError');return original.call(this,name,value)}}""",
        key,
    )
    login(pa, email, pw)
    expect(pa.locator("#account-message")).to_contain_text("could not save the private archive")
    assert read(pa, SESSION) is None and read(pa, GUEST) == GUEST_BYTES
    pa.evaluate("restoreStorage()")
    login(pa, email, pw)
    signed_in(pa, uid)
    assert head() == 0 and entries(pa) == [] and read(pa, GUEST) == GUEST_BYTES
    synced(pa)
    vault(pa)
    pa.locator("#vault-guest").click()
    expect(pa.locator("#vault-preview-title")).to_have_text("Review guest titles")
    expect(pa.locator(".vault-modes")).to_be_hidden()
    capture(pa, folder, "guest-import")
    pa.locator("#vault-cancel").click()
    assert entries(pa) == [] and head() == 0
    account(pa)
    vault(pa)
    pa.locator("#vault-guest").click()
    pa.locator("#vault-apply").click()
    expect(pa.locator("#vault-preview")).to_be_hidden()
    force(pa)
    assert read(pa, GUEST) == GUEST_BYTES and head() == 2
    expect(pa.locator("body")).to_have_attribute("data-browse", "screening")
    expect(pa.locator("#query")).to_have_value("")
    pa.locator("[data-center=profile]").click()
    pa.get_by_label("Display name").fill("Mira")
    button(pa, "Save name").click()
    expect(pa.locator("#center-name")).to_have_text("Mira")
    pa.locator("#account-close").click()
    pa.locator('[data-layout="compact"]').click()
    pa.locator("#query").fill("Transit")
    account(pa)
    altered = [dict(MOVIE, rating=4), SERIES]
    pb.evaluate(
        "([k,v])=>localStorage.setItem(k,v)", [GUEST, json.dumps(dict(version=2, entries=altered))]
    )
    pb.reload()
    login(pb, email, pw)
    signed_in(pb, uid)
    synced(pb)
    expect(pb.locator("#center-name")).to_have_text("Mira")
    vault(pb)
    pb.locator("#vault-guest").click()
    expect(pb.locator("#vault-summary")).to_contain_text("Already saved1Different versions1")
    expect(pb.locator("#vault-apply")).to_be_disabled()
    pb.get_by_label("Use the guest version").check()
    pb.evaluate("([k,v])=>localStorage.setItem(k,v)", [GUEST, GUEST_BYTES])
    pb.locator("#vault-apply").click()
    expect(pb.locator("#vault-message")).to_contain_text("guest collection changed")
    pb.locator("#vault-cancel").click()
    assert sorted(entries(pb), key=lambda x: x["id"]) == [MOVIE, SERIES]
    pb.wait_for_function("!!navigator.serviceWorker.controller")
    account(pb)
    capture(pb, folder, "account-mobile")
    if os.environ.get("AXE_JS"):
        pb.add_script_tag(path=os.environ["AXE_JS"])
        failures = pb.evaluate(
            "async()=> (await axe.run('#account-dialog',{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations.map(v=>v.id)"
        )
        assert not failures, failures
    assert not pb.evaluate("document.documentElement.scrollWidth>innerWidth")
    pb.locator("#account-close").click()
    pb.locator('[data-layout="gallery"]').click()
    pb.locator("#query").fill("Transit")
    account(pb)
    pg_count = lambda: int(s["sql"]("select count(*) from aftercredits_private.operations"))
    assert pg_count() == 1
    # A real transaction commits; the client never gets the reply.
    net["drop"] = True
    new = change(pa, dict(action="add", mediaType="movie", title="Lost reply", rating=9.5))
    expect(pa.locator(".cloud-state")).to_contain_text("Needs attention", timeout=16000)
    assert net["lost"] and pg_count() == 2 and json.loads(read(pa, key))["flight"]
    pa.reload()
    assert json.loads(read(pa, key))["flight"]
    net["block"] = False
    force(pa)
    assert pg_count() == 2 and json.loads(read(pa, key))["flight"] is None
    force(pb)
    assert any(r["id"] == new for r in entries(pb))
    # Install a real scoped shell, cold-open offline, then edit both copies of the same rating.
    pa.wait_for_function("!!navigator.serviceWorker.controller")
    a.set_offline(True)
    net["block"] = True
    pa.reload(wait_until="domcontentloaded")
    expect(pa.locator("#total")).to_have_text("03")
    change(pa, dict(action="edit", id=new, title="Lost reply", rating=7.5))
    account(pa)
    expect(pa.locator(".cloud-state")).to_contain_text("Offline")
    change(pb, dict(action="edit", id=new, title="Lost reply", rating=6))
    force(pb)
    net["block"] = False
    a.set_offline(False)
    expect(pa.locator(".cloud-state")).to_contain_text("Needs attention")
    button(pa, "Review changes").click()
    expect(button(pa, "Confirm resolutions")).to_be_disabled()
    expect(pa.locator(".account-comparison dd")).to_have_text(["7.5 / 10", "6.0 / 10"])
    capture(pa, folder, "conflict-desktop")
    pa.get_by_label("Version for Lost reply").select_option("device")
    button(pa, "Confirm resolutions").click()
    synced(pa)
    force(pb)
    assert next(x for x in entries(pb) if x["id"] == new)["rating"] == 7.5
    # Storage failures abort working data and queue in one write.
    pa.evaluate(
        """k=>{window.oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,v){
      if(key===k) throw new DOMException('Fixture storage full','QuotaExceededError');return oldSet.call(this,key,v)}}""",
        key,
    )
    before = read(pa, key)
    message = pa.evaluate("""async()=>{try {await (await import('./js/collection.js')).changeMovie({action:'delete',id:'manual-tv'})}
        catch(e){return e.name}}""")
    assert message == "QuotaExceededError" and read(pa, key) == before
    pa.evaluate("()=>{Storage.prototype.setItem=window.oldSet}")
    change(pa, dict(action="delete", id=new))
    force(pa)
    force(pb)
    assert all(x["id"] != new for x in entries(pb))
    # Use the actual Phase 3A vault controls for merge, replacement and recovery.
    imported = record("imported", "Transit")

    def upload(data):
        vault(pa)
        pa.locator("#vault-file").set_input_files(
            dict(
                name="archive.json",
                mimeType="application/json",
                buffer=json.dumps(dict(version=2, entries=data)).encode(),
            )
        )

    def replace():
        with pa.expect_download():
            pa.locator("#vault-copy").click()
        pa.locator("#vault-consent").check()
        pa.locator("#vault-apply").click()
        expect(pa.locator("#vault-preview")).to_be_hidden()

    upload([imported])
    pa.locator("#vault-apply").click()
    expect(pa.locator("#vault-preview")).to_be_hidden()
    force(pa)
    force(pb)
    assert any(i["id"] == "imported" for i in entries(pb))
    expect(pb.locator(".library-card")).to_have_count(1)
    expect(pb.locator(".library-title")).to_have_text("Transit")
    upload([SERIES])
    pa.locator("#vault-replace summary").click()
    pa.locator('[name="vault-mode"][value="restore"]').check()
    replace()
    force(pa)
    force(pb)
    assert entries(pb) == [SERIES]
    expect(pb.locator(".library-card")).to_have_count(0)
    vault(pa)
    pa.locator("#vault-advanced summary").first.click()
    pa.locator("#vault-history button").first.click()
    replace()
    force(pa)
    force(pb)
    assert set(x["id"] for x in entries(pb)) == {"imported", "legacy-film", "manual-tv"}
    # Refresh rotation, local logout with an unsent change, then an unrelated account.
    old = pa.evaluate(
        "k=>{const s=JSON.parse(localStorage[k]);s.expires=0;localStorage[k]=JSON.stringify(s);return s.refresh}",
        SESSION,
    )
    force(pa)
    assert json.loads(read(pa, SESSION))["refresh"] != old
    a.set_offline(True)
    net["block"] = True
    change(pa, dict(action="add", title="Private queued series", mediaType="tv", rating=10))
    signout(pa)
    expect(button(pa, "Sign in")).to_be_visible()
    assert entries(pa) == [MOVIE, SERIES] and read(pa, GUEST) == GUEST_BYTES
    expect(pa.locator("body")).to_have_attribute("data-browse", "gallery")
    expect(pa.locator("#query")).to_have_value("Window Seat")
    net["block"] = False
    a.set_offline(False)
    email2, pw2, _ = s["users"][1]
    login(pa, email2, pw2)
    signed_in(pa)
    synced(pa)
    assert entries(pa) == [] and read(pa, GUEST) == GUEST_BYTES
    expect(pa.locator("body")).to_have_attribute("data-browse", "screening")
    expect(pa.locator("#query")).to_have_value("")
    vault(pa)
    pa.locator("#vault-advanced summary").first.click()
    assert pa.locator("#vault-history button").count() == 0
    account(pa)
    signout(pa)
    expect(button(pa, "Sign in")).to_be_visible()
    login(pa, email, pw)
    signed_in(pa, uid)
    synced(pa)
    force(pb)
    assert any(x["title"] == "Private queued series" for x in entries(pb))
    assert read(pa, GUEST) == GUEST_BYTES
    expect(pa.locator("body")).to_have_attribute("data-browse", "compact")
    expect(pa.locator("#query")).to_have_value("Transit")
    capture(pa, folder, "account-desktop")
    # Account recovery code: deliver real SMTP mail, verify a real GoTrue OTP, update the password.
    signout(pa)
    button(pa, "Forgot password?").click()
    pa.get_by_label("Email", exact=True).fill(email)
    button(pa, "Send recovery code").click()
    expect(pa.locator(".cloud-message")).to_contain_text("check your email")
    messages = json.loads(http(s["mail"] + "/api/v1/messages")[1])
    assert messages["total"] >= 1
    letter = json.loads(http(s["mail"] + "/api/v1/message/" + messages["messages"][0]["ID"])[1])
    import re

    match = re.search(r"<strong[^>]*>\s*(\d{6,10})\s*</strong>", letter["HTML"], re.I)
    assert "Reset your AFTERCREDITS password" in letter["HTML"]
    assert match, "Recovery email must include the one-time code"
    pa.get_by_label("Recovery code", exact=True).fill(match[1])
    from secrets import token_urlsafe

    renewed = token_urlsafe(20)
    pa.get_by_label("New password", exact=True).fill(renewed)
    button(pa, "Set new password").click()
    expect(pa.locator(".cloud-message")).to_contain_text("Password updated")
    login(pa, email, renewed)
    signed_in(pa, uid)
    synced(pa)
    # A revoked refresh token returns every tab to the guest journal. Queued edits survive.
    sibling = a.new_page()
    sibling.goto(url)
    expect(sibling.locator("#total")).to_have_text("04")
    a.set_offline(True)
    net["block"] = True
    change(pa, dict(action="edit", id=MOVIE["id"], title=MOVIE["title"], rating=7))
    access = json.loads(read(pa, SESSION))["access"]
    assert (
        http(
            s["auth"] + "/logout?scope=local",
            headers={"Authorization": "Bearer " + access},
            method="POST",
        )[0]
        == 204
    )
    pa.evaluate(
        "k=>{const s=JSON.parse(localStorage[k]);s.expires=0;localStorage[k]=JSON.stringify(s)}",
        SESSION,
    )
    net["block"] = False
    a.set_offline(False)
    expect(sibling.locator("#total")).to_have_text("02", timeout=15000)
    expect(pa.locator("#total")).to_have_text("02", timeout=15000)
    assert read(pa, SESSION) is None and json.loads(read(pa, key))["pending"]
    sibling.close()
    login(pa, email, renewed)
    signed_in(pa, uid)
    synced(pa)
    assert next(x for x in entries(pa) if x["id"] == MOVIE["id"])["rating"] == 7
    assert not errors and not errors2, (errors, errors2)
    a.close()
    b.close()


def paginated_archive(browser, url, services):
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4

    email, password, uid = services["users"][1]
    ctx, page, network, errors = device(browser, url, services)
    login(page, email, password)
    signed_in(page, uid)
    synced(page)
    expect(page.get_by_role("button", name="Review guest titles", exact=False)).to_have_count(0)
    path = services["rest"] + "/rpc/"
    count = 205
    status, raw = http(
        services["auth"] + "/token?grant_type=password", dict(email=email, password=password)
    )
    assert status == 200
    headers = {"Authorization": "Bearer " + json.loads(raw)["access_token"]}

    def apply(expected, records):
        body = dict(
            expected=expected,
            operation_id=str(uuid4()),
            changes=[dict(id=e["id"], entry=e) for e in records],
        )
        code, raw = http(path + "ac_apply", body, headers)
        assert code == 200
        return json.loads(raw)

    assert http(path + "ac_pull", dict(after_revision=0, pinned_head=None))[0] in (401, 403)
    data = [record(str(n), "Transit " + str(n)) for n in range(count)]
    assert apply(0, data)["head"] == count
    network["page_failure"] = True
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.locator(".cloud-state")).to_contain_text("Needs attention")
    cache = json.loads(read(page, "aftercredits.cloud.v1." + HOST + "." + uid + ".archive"))
    assert cache["cursor"] == 0 and entries(page) == []
    with ThreadPoolExecutor(max_workers=2) as writers:
        outcomes = list(
            writers.map(lambda rating: apply(count, [dict(data[0], rating=rating)]), [6.5, 9.5])
        )
    assert sorted(r["status"] for r in outcomes) == ["ok", "stale"]
    assert (
        json.loads(http(path + "ac_pull", dict(after_revision=100, pinned_head=count), headers)[1])[
            "status"
        ]
        == "stale"
    )
    network["page_failure"] = False
    force(page)
    assert len(entries(page)) == count and {r["id"] for r in entries(page)} == {
        r["id"] for r in data
    }
    assert not errors
    ctx.close()


if __name__ == "__main__":
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    with stack() as services, site() as url, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
        run(browser, url, services, folder)
        paginated_archive(browser, url, services)
        browser.close()
    print(
        "PASS · two-device auth, migration, lost response, offline restart, conflicts, vault operations, account isolation and recovery."
    )
