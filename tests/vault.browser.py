"""End-to-end Data Vault checks. Only disposable Chromium contexts and fixture files are used."""
import csv
import io
import json
from pathlib import Path
import shutil
import sys

from playwright.sync_api import expect, sync_playwright

URL = sys.argv[1]
KEY = "aftercredits.collection.v2"
HISTORY = "aftercredits.vault.recovery.v1"
AT = "2025-11-02T19:15:12.000Z"


def record(id_, title, rating=8.5, media="movie", **extra):
    return dict(id=id_, title=title, added=AT, rating=rating, mediaType=media,
                tmdbId=None, metadata=None) | extra


movie = record("film", "Morning Rail", tmdbId=8, metadata=dict(title="Morning Rail", genres=[dict(id=18, name="Drama")],
               posterPath="/morning-rail.webp", backdropPath="/lakeside-morning.webp", releaseDate="2020-11-02",
               originalTitle="朝の線路", originalLanguage="ja", overview="Collection review fixture."))
series = record("series", "After the Rain", 9, "tv", tmdbId=8, metadata=dict(originalLanguage="ja"))
manual = record("manual", '=Horizon, "雪"\n第二幕', 7.5)
initial = [movie, series, manual]
file_version = dict(movie, id="from-file", title="朝の線路", rating=6.5, added="2023-06-02")
new_title = record("new", "West Window", 10)


def raw(entries):
    return json.dumps(dict(version=2, entries=entries), ensure_ascii=False, indent=2)


def stored(page, key=KEY):
    return page.evaluate("key=>localStorage.getItem(key)", key)


def upload(page, data):
    if isinstance(data, str):
        data = data.encode()
    page.locator("#vault-file").set_input_files(dict(name="travel.json", mimeType="application/json", buffer=data))


def enter(page):
    page.locator("#vault-open").press("Enter")
    expect(page.locator("#vault-close")).to_be_focused()


def tab(page, name):
    page.locator(f'[data-vault-tab="{name}"]').click()


def download(page, selector):
    with page.expect_download() as pending:
        page.locator(selector).click()
    artifact = pending.value
    assert artifact.failure() is None
    return artifact.suggested_filename, Path(artifact.path()).read_bytes()


def seeded(browser, **options):
    ctx = browser.new_context(accept_downloads=True, **options)
    ctx.route("https://image.tmdb.org/**", lambda r: r.abort())
    page = ctx.new_page()
    page.goto(URL)
    expect(page.locator(".empty")).to_be_visible()
    page.evaluate("([key,bytes])=>localStorage.setItem(key,bytes)", [KEY, raw(initial)])
    page.reload()
    return ctx, page


def check_portability(browser):
    ctx, page = seeded(browser)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    enter(page)
    expect(page.locator("#vault-movies")).to_have_text("2")
    expect(page.locator("#vault-series")).to_have_text("1")
    tab(page, "cloud")
    expect(page.locator("#vault-cloud")).to_contain_text("local to this browser")
    assert page.evaluate("performance.getEntriesByType('resource').every(r=>!r.name.endsWith('/cloud/auth.js') && !r.name.includes('.supabase.co/'))")
    tab(page, "export")
    name, backup = download(page, "#vault-json")
    assert name.startswith("aftercredits-backup-")
    assert json.loads(backup)["collection"]["entries"] == initial
    expect(page.locator("#vault-last")).not_to_have_text("None recorded")
    last = page.locator("#vault-last").inner_text()
    _, sheet = download(page, "#vault-csv")
    rows = list(csv.DictReader(io.StringIO(sheet.decode("utf-8-sig"), newline="")))
    assert rows[2]["Title"] == "'" + manual["title"]
    assert rows[1]["Media type"] == "tv" and rows[0]["Genres"] == "Drama"
    expect(page.locator("#vault-last")).to_have_text(last)
    tab(page, "import")
    before = stored(page)
    for data, expected in [(b"[", "readable JSON"), (b'["\xff"]', "UTF-8"),
                           (json.dumps(dict(version=9, entries=[])), "version")]:
        upload(page, data)
        expect(page.locator("#vault-message")).to_contain_text(expected)
        assert stored(page) == before and stored(page, HISTORY) is None
    upload(page, raw([new_title, dict(movie, rating=11)]))
    expect(page.locator("#vault-errors")).to_contain_text("Entry 2")
    expect(page.locator("#vault-apply")).to_be_hidden()
    assert stored(page) == before
    page.locator("#vault-cancel").click()
    upload(page, raw([series, file_version, new_title]))
    expect(page.locator("#vault-preview-title")).to_be_focused()
    assert page.locator("#vault-summary dd").all_text_contents() == ["3", "2", "1", "1", "1", "1", "0"]
    page.locator("#vault-cancel").click()
    assert stored(page) == before and stored(page, HISTORY) is None
    upload(page, raw([series,file_version,new_title]))
    page.locator("#vault-apply").click()
    expect(page.locator("#vault-message")).to_contain_text("Collection saved")
    merged = json.loads(stored(page))["entries"]
    assert merged == [new_title, *initial]
    upload(page, raw([file_version]))
    expect(page.locator("#vault-apply")).to_be_disabled()
    page.locator(".vault-conflict summary").click()
    expect(page.locator(".vault-conflict pre").first).to_be_visible()
    page.locator(".vault-conflict input").check()
    page.locator("#vault-apply").click()
    expect(page.locator("#vault-preview")).to_be_hidden()
    assert json.loads(stored(page))["entries"][1] == dict(file_version, id=movie["id"])
    upload(page, raw([]))
    page.locator('[name="vault-mode"][value="restore"]').check()
    expect(page.locator("#vault-apply")).to_be_disabled()
    _, protective = download(page, "#vault-copy")
    assert json.loads(protective)["collection"]["entries"] == json.loads(stored(page))["entries"]
    expect(page.locator("#vault-apply")).to_be_disabled()
    page.locator("#vault-consent").check()
    page.locator("#vault-apply").click()
    expect(page.locator("#vault-preview")).to_be_hidden()
    assert json.loads(stored(page))["entries"] == []
    tab(page, "recovery")
    assert page.locator("#vault-history button").count() == 3
    page.locator("#vault-history button").last.click()
    expect(page.locator("#vault-preview-title")).to_have_text("Recovery preview")
    download(page, "#vault-copy")
    page.locator("#vault-consent").check()
    page.locator("#vault-apply").click()
    expect(page.locator("#vault-preview")).to_be_hidden()
    assert json.loads(stored(page))["entries"] == initial
    page.keyboard.press("Escape")
    expect(page.locator("#vault-open")).to_be_focused()
    page.reload()
    expect(page.locator("#total")).to_have_text("03")
    assert json.loads(stored(page))["entries"] == initial and not errors, errors
    page.evaluate("localStorage.setItem('aftercredits.vault.status.v1',JSON.stringify({changes:5, dismissedAt:0, exportedAt:null}))")
    page.reload()
    expect(page.locator("#vault-open")).to_have_accessible_name("Data Vault, backup reminder")
    enter(page)
    tab(page, "recovery")
    page.locator("#vault-dismiss").click()
    expect(page.locator("#vault-reminder")).to_be_hidden()
    expect(page.locator('[data-vault-tab="recovery"]')).to_be_focused()
    assert json.loads(stored(page))["entries"] == initial
    ctx.close()


def check_tabs(browser):
    ctx, importer = seeded(browser, reduced_motion="reduce")
    owner = ctx.new_page()
    owner.goto(URL)
    enter(importer)
    tab(importer, "import")
    upload(importer, raw([new_title]))
    owner.evaluate("""key=>{navigator.locks.request(key, async()=>{
      window.held=true;await new Promise(r=>window.release=r)
    })}""", KEY)
    owner.wait_for_function("window.held")
    # A real app write queues ahead of the import on the same lock.
    owner.locator(".dock-add").click()
    owner.locator("#manual-mode").click()
    owner.locator("#title").fill("Saved in another tab")
    owner.locator("#save").click()
    owner.wait_for_function("navigator.locks.query().then(q=>q.pending.length===1)")
    importer.locator("#vault-apply").click()
    owner.wait_for_function("navigator.locks.query().then(q=>q.pending.length===2)")
    owner.evaluate("window.release()")
    expect(owner.locator("#total")).to_have_text("04")
    expect(importer.locator("#vault-message")).to_contain_text("changed")
    assert stored(importer, HISTORY) is None
    assert json.loads(stored(importer))["entries"][0]["title"] == "Saved in another tab"
    importer.locator("#vault-apply").click()
    expect(importer.locator("#vault-preview")).to_be_hidden()
    expect(owner.locator("#total")).to_have_text("05")
    assert json.loads(stored(owner))["entries"][-3:] == initial
    # Cancel a confirmed import that is still waiting for a lock.
    upload(importer, raw([record("cancelled","Cancelled save")]))
    owner.evaluate("""key=>{window.held=false;navigator.locks.request(key, async()=>{
      window.held=true;await new Promise(r=>window.release=r)
    })}""", KEY)
    owner.wait_for_function("window.held")
    before = stored(owner)
    importer.locator("#vault-apply").click()
    owner.wait_for_function("navigator.locks.query().then(q=>q.pending.length===1)")
    importer.locator("#vault-cancel").click()
    owner.evaluate("window.release()")
    owner.wait_for_function("navigator.locks.query().then(q=>!q.held.length&&!q.pending.length)")
    assert stored(owner) == before
    ctx.close()


def check_storage(browser):
    ctx, page = seeded(browser, reduced_motion="reduce")
    enter(page)
    tab(page,"import")
    upload(page,raw([new_title]))
    before=stored(page)
    page.evaluate("""key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k===key) throw new DOMException('Full','QuotaExceededError');return set.call(this,k,v)}}""", KEY)
    page.locator("#vault-apply").click()
    expect(page.locator("#vault-message")).to_contain_text("intact")
    assert stored(page)==before and stored(page,HISTORY) is None
    ctx.close()
    ctx=browser.new_context()
    ctx.add_init_script("Storage.prototype.getItem=function(){throw new DOMException('Blocked','SecurityError')}")
    page=ctx.new_page()
    page.goto(URL)
    enter(page)
    expect(page.locator("#vault-local")).to_contain_text("Session only")
    tab(page,"import")
    upload(page,raw([new_title]))
    expect(page.locator("#vault-errors")).to_contain_text("unavailable")
    expect(page.locator("#vault-apply")).to_be_hidden()
    ctx.close()


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=shutil.which("chromium"))
    check_portability(browser)
    check_tabs(browser)
    check_storage(browser)
    browser.close()
print("Passed file downloads, CSV readback, validation, merge choices, restore and recovery, cancellation, lock contention and storage failures.")
