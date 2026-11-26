"""Discovery against disposable local records. No cloud or catalog requests are required."""

from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

URL = sys.argv[1]
CAPTURES = Path(sys.argv[2]) if len(sys.argv) > 2 else None
ROOT = Path(__file__).resolve().parents[1]
GUEST = "aftercredits.collection.v2"
NAMES = [
    "Morning Rail",
    "The Lake at Dawn",
    "Twilight Passage",
    "A Window in Rain",
    "After the Last Show",
    "Across the Plaza",
    "Night Projection",
    "The Ticket Office",
    "Letters from Home",
    "First Light",
]
ART = [
    "morning-rail",
    "lakeside-morning",
    "twilight",
    "morning-tickets",
    "celluloid",
    "tickets",
    "projection",
]


def fixture(i, media="movie"):
    title = NAMES[i % 10] + (f" · {i // 10 + 1}" if i >= 10 else "")
    meta = (
        None
        if i % 10 == 9
        else dict(
            title=title,
            originalTitle="朝の列車" if i % 10 == 0 else title,
            originalLanguage="ja" if i % 2 == 0 else "fr",
            releaseDate=f"{1990 + i % 32}-06-15",
            overview="A local artwork fixture.",
            genres=[dict(id=18, name="Drama")] if i % 2 == 0 else [dict(id=12, name="Adventure")],
            posterPath="/" + ART[i % len(ART)] + ".webp",
            backdropPath=None,
        )
    )
    return dict(
        id=f"{media}-{i}",
        mediaType=media,
        title=title,
        rating=6 + i % 9 / 2,
        added=f"2024-01-{i % 28 + 1:02}T12:00:00Z",
        tmdbId=i + 10 if meta else None,
        metadata=meta,
    )


def capture(page, name):
    if CAPTURES:
        from PIL import Image

        CAPTURES.mkdir(parents=True, exist_ok=True)
        Image.open(BytesIO(page.screenshot(animations="disabled"))).convert("RGB").save(
            CAPTURES / (name + ".webp"), quality=85
        )


def layout(page, name):
    page.locator('[data-layout="' + name + '"]').click()
    expect(page.locator("body")).to_have_attribute("data-browse", name)


def seed(page, count):
    entries = [fixture(i) for i in range(count)] + ([fixture(0, "tv")] if count else [])
    data = json.dumps(dict(version=2, entries=entries), ensure_ascii=False)
    page.evaluate("([k,v])=>localStorage.setItem(k,v)", [GUEST, data])
    page.reload()
    expect(page.locator("#result-status")).to_contain_text(str(count))
    return data


def artwork(route):
    name = Path(urlsplit(route.request.url).path).name
    assert name in [v + ".webp" for v in ART]
    route.fulfill(path=ROOT / "assets/images" / name, content_type="image/webp")


def check(browser, mobile):
    ctx = browser.new_context(
        viewport=dict(width=390 if mobile else 1440, height=844 if mobile else 960),
        reduced_motion="reduce",
        has_touch=mobile,
        is_mobile=mobile,
    )
    ctx.route("https://image.tmdb.org/**", artwork)
    errors = []
    cloud = []
    ctx.on(
        "request",
        lambda r: cloud.append(r.url)
        if r.url.startswith("https:") and not r.url.startswith("https://image.tmdb.org/")
        else None,
    )
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    expect(page.locator(".empty")).to_be_visible()
    for name in ["gallery", "compact", "screening"]:
        layout(page, name)
        expect(page.locator(".empty")).to_be_visible()
    raw = seed(page, 10)
    page.evaluate("window.scrollTo(0,0)")
    if not mobile:
        capture(page, "screening-desktop")
    layout(page, "gallery")
    page.evaluate("window.scrollTo(0,0)")
    page.locator(".library-open img").first.wait_for()
    page.wait_for_function(
        "Array.from(document.querySelectorAll('.library-open img')).slice(0,2).every(img=>img.complete && img.naturalWidth)"
    )
    capture(page, "gallery-phone" if mobile else "gallery-desktop")
    page.locator("#filter-open").click()
    form = page.locator("#discovery-form")
    form.locator("#filter-decade").select_option("1990")
    form.locator("[data-preset=highest]").click()
    form.locator("[name=addedFrom]").fill("2024-01-03")
    form.locator("[name=addedTo]").fill("2024-01-06")
    form.locator("[name=missing]").select_option("backdrop")
    form.get_by_role("button", name="Apply", exact=True).click()
    expect(page.locator("#result-status")).to_have_text("4 of 10 movies")
    expect(page.locator("#order")).to_have_value("highest")
    expect(page.locator(".library-card").first).to_have_attribute("data-film", "movie-5")
    page.locator("#active-filters").get_by_role("button", name="Clear all").click()
    page.locator("#filter-open").click()
    form.get_by_label("Drama").check()
    form.get_by_label("Japanese").check()
    form.locator("[name=ratingFrom]").fill("6.5")
    form.locator("[name=yearTo]").fill("1996")
    expect(page.locator("#filter-preview")).to_have_text("3 matches")
    form.locator("[name=ratingTo]").fill("6")
    expect(form.get_by_role("button", name="Apply", exact=True)).to_be_disabled()
    form.locator("[name=ratingTo]").fill("")
    if not mobile:
        capture(page, "filter-sheet")
    form.get_by_role("button", name="Apply", exact=True).click()
    expect(page.locator(".library-card")).to_have_count(3)
    expect(page.locator("#filter-open")).to_be_focused()
    page.locator("#active-filters").get_by_role("button", name="Remove Drama").click()
    expect(page.locator("#active-filters button").first).to_be_focused()
    for name in ["compact", "screening", "gallery"]:
        layout(page, name)
        expect(page.locator("#result-status")).to_have_text("3 of 10 movies")
    page.reload()
    expect(page.locator(".library-card")).to_have_count(3)
    page.locator("#query").fill("unmatched")
    expect(page.locator(".no-match")).to_be_visible()
    page.locator("[data-clear]").click()
    expect(page.locator(".library-card")).to_have_count(10)
    page.locator("#query").fill("朝 列車")
    expect(page.locator(".library-card")).to_have_count(1)
    page.locator("[data-section=tv]").click()
    expect(page.locator("#query")).to_have_value("")
    page.locator("[data-section=movie]").click()
    expect(page.locator("#query")).to_have_value("朝 列車")
    page.locator("#active-filters").get_by_role("button", name="Clear all").click()
    layout(page, "compact")
    page.evaluate("window.scrollTo(0,0)")
    capture(page, "compact-phone" if mobile else "compact-desktop")
    widths = [320, 360, 390, 430, 768] if mobile else [1024, 1440]
    for width in widths:
        page.set_viewport_size(dict(width=width, height=844 if mobile else 960))
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth"), width
        page.locator("#filter-open").click()
        assert page.locator("#discovery-filters").evaluate(
            "d=>d.scrollWidth<=d.clientWidth+1 && d.getBoundingClientRect().bottom<=innerHeight+1"
        )
        page.keyboard.press("Escape")
    page.set_viewport_size(dict(width=390 if mobile else 1440, height=844 if mobile else 960))
    assert page.evaluate("k=>localStorage.getItem(k)", GUEST) == raw
    for name in ["gallery", "compact", "screening"]:
        layout(page, name)
        btn = page.locator("#results [data-action=details]").first
        btn.press("Enter")
        expect(page.locator("#detail-dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(btn).to_be_focused()
    layout(page, "compact")
    page.locator("#results [data-action=edit]").first.click()
    page.locator("#title").fill("Revised print")
    page.locator("#increase").click()
    page.locator("#save").click()
    expect(page.locator("#results")).to_contain_text("Revised print")
    page.locator("#query").fill("revised")
    expect(page.locator("#result-status")).to_have_text("1 of 10 movies")
    page.locator("#results [data-action=delete]").click()
    page.locator("#delete-form button[type=submit]").click()
    expect(page.locator(".no-match")).to_be_visible()
    page.locator("[data-clear]").click()
    expect(page.locator("#result-status")).to_have_text("9 movies")
    page.locator("[data-section=tv]").click()
    layout(page, "gallery")
    page.locator(".library-card [data-action=edit]").click()
    page.locator("#title").fill("New series name")
    page.locator("#save").click()
    expect(page.locator(".library-title")).to_have_text("New series name")
    page.locator(".library-card [data-action=delete]").click()
    page.locator("#delete-form button[type=submit]").click()
    expect(page.locator(".empty")).to_be_visible()
    page.locator("[data-section=movie]").click()
    if not mobile:
        for size in [100, 300, 1000]:
            seed(page, size)
            for name, limit in [("screening", 72), ("gallery", 24), ("compact", 60)]:
                layout(page, name)
                page.locator("#browse-page").select_option(index=0)
                expect(page.locator("#results [data-film]")).to_have_count(limit)
                if name == "screening":
                    last = page.locator(".open-card").last
                    last.focus()
                    last.press("ArrowRight")
                    expect(page.locator("#browse-page")).to_have_value("1")
                    expect(page.locator(".open-card").first).to_be_focused()
                    page.keyboard.press("ArrowLeft")
                    expect(page.locator("#browse-page")).to_have_value("0")
                    expect(page.locator(".open-card").last).to_be_focused()
                page.locator("#browse-page").select_option(index=(size - 1) // limit)
                expect(page.locator("#results [data-film]")).to_have_count((size - 1) % limit + 1)
        page.locator("#query").fill("morning")
        expect(page.locator("#result-status")).to_have_text("100 of 1000 movies")
    if os.environ.get("AXE_JS"):
        page.add_script_tag(path=os.environ["AXE_JS"])
        for target in ["#collection", "#discovery-filters"]:
            if target != "#collection":
                page.locator("#filter-open").click()
            violations = page.evaluate(
                """async sel=>(await axe.run(sel,{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations.map(x=>[x.id,x.nodes[0].target])""",
                target,
            )
            assert not violations, violations
    assert not errors and not cloud, (errors, cloud)
    ctx.close()


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
    check(browser, False)
    check(browser, True)
    browser.close()
print(
    "Passed discovery, layouts, ranges, persistence, CRUD, responsive and collection-size checks."
)
