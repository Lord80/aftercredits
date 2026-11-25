"""Chromium regressions for archive startup, short pickers and interrupted projection."""
import json
import re
import shutil
import sys

from playwright.sync_api import expect, sync_playwright

URL = sys.argv[1]
KEY = "aftercredits.collection.v2"
ENTRY = dict(id="existing", title="Archive print", added="2026-01-01", mediaType="movie",
             tmdbId=None, rating=8.5, metadata=None)


def check_locked_archive(browser):
    ctx = browser.new_context()
    owner = ctx.new_page()
    owner.goto(URL)
    expect(owner.locator(".empty")).to_be_visible()
    raw = json.dumps(dict(version=2, entries=[ENTRY]))
    owner.evaluate("([key,raw])=>localStorage.setItem(key,raw)", [KEY, raw])
    owner.evaluate("""key => {
      navigator.locks.request(key, async () => {
        window.lockHeld=true;
        await new Promise(r=>window.releaseArchive=r);
      });
    }""", KEY)
    owner.wait_for_function("window.lockHeld")
    reader = ctx.new_page()
    reader.goto(URL)
    expect(reader.locator(".open-card")).to_have_accessible_name(re.compile(r"^Archive print.*Movie.*Your rating 8.5"))
    expect(reader.locator(".open-card")).to_have_accessible_description("Open title details")
    assert reader.evaluate("performance.getEntriesByType('resource').every(r=>!r.name.includes('gsap'))")
    reader.locator(".dock-add").click()
    reader.locator("#manual-mode").click()
    reader.locator("#title").fill("Concurrent addition")
    reader.locator("#save").click()
    reader.wait_for_function("navigator.locks.query().then(r=>r.pending.some(l=>l.name==='aftercredits.collection.v2'))")
    assert reader.evaluate("k=>localStorage.getItem(k)", KEY) == raw
    owner.evaluate("window.releaseArchive()")
    expect(reader.locator(".poster-card")).to_have_count(2)
    expect(owner.locator(".poster-card")).to_have_count(2)
    reader.reload()
    entries = reader.evaluate("k=>JSON.parse(localStorage.getItem(k)).entries", KEY)
    assert entries[1] == ENTRY and entries[0]["title"] == "Concurrent addition"
    ctx.close()


def check_picker(browser):
    ctx = browser.new_context(viewport=dict(width=390,height=844), is_mobile=True,
                              has_touch=True, reduced_motion="reduce")
    hits = [dict(mediaType="movie", tmdbId=i+1, metadata=dict(title=f"Print {i}", releaseDate="2026-01-01"))
            for i in range(12)]
    ctx.route("**.workers.dev/search?**", lambda r:r.fulfill(json={"results":hits},
                                                            headers={"Access-Control-Allow-Origin":"*"}))
    page = ctx.new_page()
    page.goto(URL)
    page.locator(".dock-add").click()
    page.locator("#catalog-query").fill("Print")
    expect(page.locator("#matches button")).to_have_count(12)
    for width,height in [(320,568),(360,640),(390,385),(430,680),(768,460),(844,390)]:
        page.set_viewport_size(dict(width=width,height=height))
        expect(page.locator("#editor")).to_have_attribute("data-tight", "")
        save = page.locator("#save").bounding_box()
        assert save and save["y"] >= 0 and save["y"]+save["height"] <= height, (width,height,save)
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        if (width, height) == (390, 385):
            page.locator(".editor-body").evaluate("el=>el.scrollTop=0")
            expect(page.locator("#matches button").first).to_be_in_viewport(ratio=1)
        page.locator("#matches button").last.scroll_into_view_if_needed()
        expect(page.locator("#save")).to_be_in_viewport(ratio=1)
    page.locator('.editor-foot [data-dismiss]').tap()
    expect(page.locator(".dock-add")).to_be_focused()
    ctx.close()


def check_interruption(browser):
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(URL)
    page.evaluate("([k,v])=>localStorage.setItem(k,v)",[KEY,json.dumps(dict(version=2,entries=[ENTRY]))])
    page.reload()
    page.locator("#latest").wait_for()
    opacity = page.evaluate("""async () => {
      document.querySelector('#latest').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const sheet=document.querySelector('.detail-sheet'), exposure=()=>Number(getComputedStyle(sheet).opacity);
      const before=exposure();
      document.querySelector('.detail-close').click();
      return [before,exposure()];
    }""")
    assert abs(opacity[0]-opacity[1]) < .03, opacity
    expect(page.locator("#detail-dialog")).to_be_hidden()
    expect(page.locator("#latest")).to_be_focused()
    ctx.close()


def check_sorted_strip(browser):
    entries = [dict(ENTRY, id=str(i), title=f"Print {i:02}", rating=1 + i % 10)
               for i in range(50)]
    expected = [entry["id"] for entry in sorted(entries, key=lambda entry: -entry["rating"])]
    for use_fallback in (False, True):
        ctx = browser.new_context(reduced_motion="reduce")
        if use_fallback:
            ctx.add_init_script("delete Element.prototype.moveBefore")
        page = ctx.new_page()
        page.goto(URL)
        page.evaluate("([key,entries])=>localStorage.setItem(key, JSON.stringify({version:2,entries}))",
                      [KEY, entries])
        page.reload()
        row = page.locator('[data-film="9"] .open-card')
        row.evaluate("el=>window.originalPrint=el")
        if not use_fallback:
            row.focus()
        page.locator("#order").evaluate("el=>{el.value='highest';el.dispatchEvent(new Event('change'))}")
        assert page.locator(".poster-card").evaluate_all("rows=>rows.map(row=>row.dataset.film)") == expected
        assert row.evaluate("el=>el===window.originalPrint")
        if not use_fallback:
            expect(row).to_be_focused()
        ctx.close()


with sync_playwright() as pw:
    chromium = pw.chromium.launch(executable_path=shutil.which("chromium"))
    check_locked_archive(chromium)
    check_picker(chromium)
    check_interruption(chromium)
    check_sorted_strip(chromium)
    chromium.close()
print("Passed locked archive reads, serialized saves, filmstrip names and reordering, short pickers and interrupted projection.")
