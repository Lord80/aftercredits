"""Exercise a real 3B -> 4A service-worker lifecycle on one disposable origin.
Pass a checkout of the configured Phase 3B release as the first argument.
"""

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import sys
from threading import Thread
from playwright.sync_api import expect, sync_playwright

BASE = Path(sys.argv[1]).resolve()
ROOT = Path(__file__).resolve().parents[1]
release = [BASE]


class Fixture(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(release[0]), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/upgrade-check.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<title>Upgrade observer</title>")
            return
        if not self.path.startswith("/aftercredits/"):
            self.send_error(404)
            return
        self.path = self.path.removeprefix("/aftercredits")
        if self.path == "/js/cloud-config.js":
            data = b"export const projectUrl='https://ac-upgrade.supabase.co',publishableKey='sb_publishable_upgrade';"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
prefix = "aftercredits.cloud.v1.ac-upgrade.supabase.co."
entry = dict(
    id="vintage",
    mediaType="movie",
    tmdbId=None,
    metadata=None,
    title="Archive opening",
    rating=7.5,
    added="2020-02-19",
)
cache = dict(
    version=1,
    cursor=1,
    rows=[dict(id=entry["id"], entry=entry, revision=1)],
    order=[entry["id"]],
    pending=[],
    flight=None,
    incoming=None,
    lastSync="2025-01-01T12:05:05Z",
)
session = dict(
    id=uid,
    email="offline@example.test",
    access="fixture",
    refresh="fixture",
    expires=0,
    linked=True,
)
with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server, sync_playwright() as pw:
    Thread(target=server.serve_forever, daemon=True).start()
    browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
    context = browser.new_context(reduced_motion="reduce")
    context.route("https://**", lambda r: r.abort())
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    url = f"http://127.0.0.1:{server.server_port}/aftercredits/"
    urlsplit_origin = f"http://127.0.0.1:{server.server_port}"
    page.goto(url)
    page.evaluate(
        "pairs=>pairs.forEach(([k,v])=>localStorage.setItem(k,JSON.stringify(v)))",
        [[prefix + "session", session], [prefix + uid + ".archive", cache]],
    )
    page.reload()
    expect(page.locator("#headline")).to_have_text(entry["title"])
    page.wait_for_function("!!navigator.serviceWorker.controller")
    assert page.evaluate("caches.keys().then(keys=>keys.some(k=>k.includes('3b.1:')))")
    release[0] = ROOT
    page.evaluate("async()=>{const r=await navigator.serviceWorker.ready;await r.update()}")
    page.evaluate("""async()=>{const r=await navigator.serviceWorker.ready;
      if(!r.waiting) await new Promise((resolve,reject)=>{
        const w=r.installing;if(!w)throw Error('No pending upgrade');
        w.onstatechange=()=>{if(w.state==='installed')resolve();if(w.state==='redundant')reject(Error('Install failed'))}
      })}""")
    assert not page.locator("#filter-open").count()
    observer = context.new_page()
    observer.goto(urlsplit_origin + "/upgrade-check.html")
    observer.evaluate(
        """async scope=>{const r=await navigator.serviceWorker.getRegistration(scope), w=r.waiting;
      if(!w)throw Error('Expected the installed 4A worker to wait for the 3B client');
      window.newShell=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('Upgrade never activated')),12000);
        w.onstatechange=()=>{if(w.state==='activated'){clearTimeout(timeout);resolve()}}
      })
    }""",
        url,
    )
    page.close()
    observer.evaluate("window.newShell")
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    # The old page has released its controller. A fresh client opens the new version.
    page.goto(url)
    page.wait_for_selector("#filter-open", timeout=5000)
    assert page.evaluate(
        "caches.keys().then(keys=>keys.some(k=>k.includes('4a.1:'))&&!keys.some(k=>k.includes('3b.1:')))"
    )
    page.locator("[data-layout=gallery]").click()
    page.locator("#query").fill("archive")
    expect(page.locator(".library-card")).to_have_count(1)
    context.set_offline(True)
    page.reload()
    expect(page.locator("[data-layout=gallery]")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#query")).to_have_value("archive")
    page.locator("#filter-open").click()
    page.locator("[name=source]").select_option("manual")
    page.locator("#discovery-form [type=submit]").click()
    page.locator(".library-card [data-action=edit]").click()
    page.locator("#increase").click()
    page.locator("#save").click()
    expect(page.locator(".library-card .score-badge")).to_contain_text("8.0")
    page.reload()
    value = page.evaluate("k=>JSON.parse(localStorage.getItem(k))", prefix + uid + ".archive")
    assert value["pending"][0]["entry"] == dict(entry, rating=8)
    assert value["rows"][0]["entry"] == entry and not errors, errors
    expect(page.locator("#active-filters")).to_contain_text("Manual")
    browser.close()
print(
    "Passed waiting-worker isolation, full shell upgrade, scoped offline reopening, filtering and queued rating edit."
)
