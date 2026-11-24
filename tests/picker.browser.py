"""Chromium regression checks for catalog choice, persistence and poster navigation."""

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
    expect(query).to_be_hidden()
    page.locator("#picked button").press("Enter")
    expect(query).to_be_focused()
    result.click()
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


def check_featured_title(page):
    latest = page.locator("#latest")
    expect(latest).to_be_hidden()
    page.locator('[data-section="tv"]').click()
    expect(latest).to_contain_text("Manual series")
    latest.press("Enter")
    expect(page.locator("#detail-score")).to_have_text("7.5")
    page.keyboard.press("Escape")
    expect(latest).to_be_focused()
    page.locator('[data-section="movie"]').click()
    expect(latest).to_be_hidden()
    page.locator(".header-inner [data-add]").click()
    page.locator("#catalog-query").fill("fixture")
    page.locator("#matches button").click()
    page.locator("#save").click()
    expect(latest).to_contain_text("Browser fixture")
    page.locator("#query").fill("Unmatched query")
    expect(page.locator(".no-match")).to_be_visible()
    expect(latest).to_contain_text("Browser fixture")
    page.locator("[data-clear]").click()
    page.locator('[data-action="delete"]').click()
    page.locator("#delete-form [type=submit]").click()
    expect(latest).to_be_hidden()
    page.locator('[data-section="tv"]').click()
    expect(latest).to_contain_text("Manual series")


def check_stage_browsing(page):
    page.locator('[data-section="movie"]').click()
    for title in ["First frame", "Second frame", "Third frame"]:
        page.locator(".header-inner [data-add]").click()
        page.locator("#manual-mode").click()
        page.locator("#title").fill(title)
        page.locator("#save").click()
        expect(page.locator("#headline")).to_have_text(title)

    read_archive = "localStorage.getItem('aftercredits.collection.v2')"
    raw = page.evaluate(read_archive)
    expect(page.locator(".mount:visible")).to_have_count(3)
    page.get_by_role("button", name="Next poster", exact=True).click()
    expect(page.locator("#headline")).to_have_text("Second frame")
    page.locator("#return-latest").click()
    expect(page.locator("#detail-title")).to_have_text("Third frame")
    page.keyboard.press("Escape")
    page.locator("#latest").press("ArrowRight")
    expect(page.locator("#headline")).to_have_text("First frame")
    page.locator("#latest").press("ArrowRight")
    expect(page.locator("#headline")).to_have_text("Third frame")
    page.locator(".open-card").first.focus()
    page.keyboard.press("ArrowRight")
    expect(page.locator(".open-card").nth(1)).to_be_focused()
    expect(page.locator("#headline")).to_have_text("Second frame")
    page.keyboard.press("Enter")
    expect(page.locator("#detail-title")).to_have_text("Second frame")
    page.keyboard.press("Escape")
    expect(page.locator(".open-card").nth(1)).to_be_focused()
    page.locator("#query").fill("First frame")
    expect(page.locator(".mount:visible")).to_have_count(1)
    expect(page.locator(".shuttle")).to_be_hidden()
    assert page.evaluate(read_archive) == raw


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
                check_featured_title(page)
                check_stage_browsing(page)
                browser.close()
        finally:
            server.shutdown()
    print("Passed catalog, half-point persistence, poster stage and filmstrip navigation checks.")
