"""Exercise motion interruptions with real Chromium and disposable storage."""
import json
import shutil
import sys
from playwright.sync_api import expect, sync_playwright

URL = sys.argv[1]
KEY = "aftercredits.collection.v2"
entries = [dict(id=str(i), title=f"Print {i}", mediaType="movie" if i < 5 else "tv",
                rating=7.5, tmdbId=None, metadata=None, added=f"2026-01-0{i}T12:00:00Z")
           for i in range(1, 7)]
raw = json.dumps(dict(version=2, entries=entries))


def exercise(browser, animation_mode):
    ctx = browser.new_context(viewport=dict(width=1100, height=780))
    ctx.route("**/gsap.min.js", lambda route: route.abort())
    if animation_mode == "unavailable":
        ctx.add_init_script("Element.prototype.animate = undefined")
    elif animation_mode == "rejected":
        ctx.add_init_script("Element.prototype.animate = () => { throw new TypeError('Unsupported keyframe'); }")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    expect(page.locator(".empty")).to_be_visible()
    page.evaluate("([k,v])=>localStorage.setItem(k,v)", [KEY, raw])
    page.reload()
    page.wait_for_selector("#latest")
    control = page.locator("#ambient-control")
    control.click()
    expect(control).to_have_attribute("aria-pressed", "false")
    assert page.locator(".rain-light i").first.evaluate("e=>getComputedStyle(e).animationPlayState") == "paused"
    page.reload()
    expect(control).to_have_attribute("aria-pressed", "false")
    control.press("Enter")
    page.evaluate("""() => {
      const next=document.querySelector('.shuttle [data-step="1"]');
      for (let i=0;i<15;i++) next.click();
      for (let i=0;i<10;i++) document.querySelector('[data-section="'+(i%2?'movie':'tv')+'"]').click();
    }""")
    expect(page.locator("#headline")).to_have_text("Print 1")
    for i in range(4):
        page.locator("#latest").press("Enter")
        expect(page.locator(".detail-close")).to_be_focused()
        page.keyboard.press("Escape")
        if i == 0:
            page.emulate_media(reduced_motion="reduce")
        if i == 1:
            page.set_viewport_size(dict(width=768, height=850))
        expect(page.locator("dialog[open]")).to_have_count(0)
        expect(page.locator("#latest")).to_be_focused()
        page.emulate_media(reduced_motion="no-preference")
    page.locator("#order").select_option("alpha")
    page.locator(".header-inner [data-add]").click()
    page.locator("#manual-mode").click()
    page.locator("#title").fill("Zulu, saved in alphabetical order")
    page.locator("#rating").press("ArrowRight")
    page.locator("#save").click()
    # Inspect the write before any reload or dependency on the exit transition.
    page.wait_for_function("JSON.parse(localStorage.getItem('aftercredits.collection.v2')).entries.length===7")
    expect(page.locator("#headline")).to_have_text("Zulu, saved in alphabetical order")
    expect(page.locator("#stage-score strong")).to_have_text("7.5")
    expect(page.locator(".departing-print, .departing-frame")).to_have_count(0)
    saved = json.loads(page.evaluate("key => localStorage.getItem(key)", KEY))
    assert saved["entries"][1:] == entries
    page.reload()
    expect(page.locator("#headline")).to_have_text("Zulu, saved in alphabetical order")
    assert not errors, errors
    ctx.close()


def check_phone_artwork(browser):
    ctx = browser.new_context(viewport=dict(width=320, height=568), is_mobile=True,
                              has_touch=True, reduced_motion="reduce")
    ctx.route("https://image.tmdb.org/**", lambda route: route.abort())
    page = ctx.new_page()
    page.goto(URL)
    items = [dict(entries[0], title="A long film title " * 35,
                  metadata=dict(posterPath="/missing.jpg")), entries[1]]
    page.evaluate("([k,v])=>localStorage.setItem(k,v)", [KEY, json.dumps(dict(version=2,entries=items))])
    page.reload()
    card = page.locator('[data-film="1"]')
    expect(card).to_be_attached()
    expect(card.locator("img")).to_have_count(0)
    expect(card.locator(".bookplate")).to_be_visible()
    ctx.close()


def check_visibility(browser):
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(URL)
    expect(page.locator(".empty")).to_be_visible()
    page.evaluate("""() => {
      const samples = [];
      document.addEventListener('visibilitychange', () => {
        samples.push([document.visibilityState, document.documentElement.hasAttribute('data-still'),
          getComputedStyle(document.querySelector('.rain-light i')).animationPlayState]);
        sessionStorage.setItem('lifecycle-test', JSON.stringify(samples));
      });
    }""")
    page.goto(URL.rstrip("/") + "/js/config.js")
    page.go_back(wait_until="commit")
    expect(page.locator(".empty")).to_be_visible()
    assert page.evaluate("JSON.parse(sessionStorage.getItem('lifecycle-test'))") == [
        ["hidden", True, "paused"], ["visible", False, "running"]]
    ctx.close()


with sync_playwright() as pw:
    chromium = pw.chromium.launch(executable_path=shutil.which("chromium"),
                                  ignore_default_args=["--disable-back-forward-cache"])
    for mode in ["normal", "unavailable", "rejected"]:
        exercise(chromium, mode)
    check_phone_artwork(chromium)
    check_visibility(chromium)
    chromium.close()
print("Passed rapid navigation, interrupted projection, resize, focus restoration, atmosphere lifecycle, saving under sorting and animation fallbacks.")
