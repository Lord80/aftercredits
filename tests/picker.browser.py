"""Optional Chromium regression check for the media switch and catalog selection."""

import json
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def catalog(route):
    url = urlparse(route.request.url)
    media = parse_qs(url.query)["type"][0]
    item = {"mediaType": media, "tmdbId": 1, "metadata": {"title": "Browser fixture"}}
    response = {"results": [item]} if url.path == "/search" else {"item": item}
    route.fulfill(json=response, headers={"Access-Control-Allow-Origin": "*"})


def check_picker(page):
    page.locator(".header-inner [data-add]").click()
    page.locator('input[value="movie"]').focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("radio", name="TV Series")).to_be_checked()
    query = page.locator("#catalog-query")
    page.route("https://fixture.invalid/search?**", lambda route: route.fulfill(
        status=429, json={"error": "busy"}, headers={"Access-Control-Allow-Origin": "*"}
    ), times=1)
    query.fill("fixture")
    expect(page.locator("#catalog-status")).to_have_attribute("data-loading", "true")
    retry = page.locator("#retry")
    expect(retry).to_be_visible()
    retry.press("Enter")
    expect(query).to_be_focused()
    result = page.locator("#matches button")
    expect(result).to_have_count(1)
    expect(retry).to_be_hidden()
    query.press("Enter")
    expect(result).to_be_focused()
    result.press("Enter")
    expect(page.locator("#picked button")).to_be_focused()
    expect(page.locator("#save")).to_be_enabled()

    # The selection and results now sit outside the lookup input panel.
    # Switching mode must clear both before a manual title can be saved.
    page.locator("#manual-mode").click()
    expect(page.locator("#picked")).to_be_hidden()
    expect(result).to_have_count(0)
    page.locator("#title").fill("Manual series")
    page.locator("#rating").press("ArrowRight")
    expect(page.locator("#score")).to_have_text("7.5")
    page.locator("#save").click()
    expect(page.locator("[data-section=tv]")).to_have_attribute("aria-pressed", "true")
    page.reload()
    archive = json.loads(page.evaluate("localStorage.getItem('aftercredits.collection.v2')"))
    entry, = archive["entries"]
    assert (entry["mediaType"], entry["title"], entry["rating"], entry["tmdbId"]) == (
        "tv", "Manual series", 7.5, None
    )


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
                ctx = browser.new_context(reduced_motion="reduce")
                ctx.route("**/js/config.js", lambda route: route.fulfill(
                    content_type="text/javascript", body="export const catalogOrigin='https://fixture.invalid';"
                ))
                ctx.route("https://fixture.invalid/**", catalog)
                page = ctx.new_page()
                page.goto(f"http://127.0.0.1:{server.server_port}/")
                check_picker(page)
                browser.close()
        finally:
            server.shutdown()
    print("Passed keyboard media selection, catalog preview cleanup and saved half-point score.")
