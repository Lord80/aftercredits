"""One-window navigation, preferences and the foreground scheduler on a disposable origin."""

import os
import runpy
import shutil
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

f = runpy.run_path(str(Path(__file__).with_name("cloud.browser.py")))
capture_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def section(page, name):
    page.locator(f"[data-center='{name}']").click()
    expect(page.locator(f"[data-center='{name}']")).to_have_attribute("aria-current", "page")


def guest_center(browser, url, services):
    context, page, _, errors = f["device"](browser, url, services)
    page.locator("#vault-open").press("Enter")
    expect(page.locator("#vault-json")).to_be_visible()
    page.evaluate("window.centerIdentity = document.querySelector('#account-dialog')")
    assert page.locator("dialog:modal").count() == 1
    expect(page.locator("#vault-advanced")).not_to_have_attribute("open", "")
    f["capture"](page, capture_dir, "backup-desktop")
    for name in ["profile", "preferences", "security", "data", "overview"]:
        section(page, name)
        expect(page.locator("#account-heading")).to_be_focused()
        assert page.evaluate("window.centerIdentity===document.querySelector('dialog:modal')")
    expect(page.locator("#center-name")).to_have_text("Guest journal")
    expect(page.locator(".cloud-state")).to_have_text("Saved on this device")
    section(page, "preferences")
    page.get_by_role("combobox", name="Collection layout", exact=True).select_option("compact")
    page.get_by_label("Movie sort order").select_option("highest")
    page.get_by_label("TV series sort order").select_option("oldest")
    expect(page.get_by_role("checkbox", name="Ambient motion")).to_be_disabled()
    page.emulate_media(reduced_motion="no-preference")
    toggle = page.get_by_role("checkbox", name="Ambient motion")
    expect(toggle).to_be_enabled()
    expect(toggle).to_be_checked()
    toggle.uncheck()
    expect(page.locator("#ambient-control")).to_have_attribute("aria-pressed", "false")
    assert page.evaluate("localStorage.getItem('aftercredits.ambient-paused')") == "1"
    page.emulate_media(reduced_motion="reduce")
    for width in (320, 360, 390, 430, 768, 1440):
        page.set_viewport_size(dict(width=width, height=844))
        assert page.locator("#account-dialog").evaluate("""(e) => {
          const box=e.getBoundingClientRect(), pane=e.querySelector('.account-content');
          return e.scrollWidth<=e.clientWidth && pane.scrollWidth<=pane.clientWidth &&
            (innerWidth>680 || (box.width===innerWidth && box.height===innerHeight));
        }""")
    page.set_viewport_size(dict(width=390, height=844))
    f["capture"](page, capture_dir, "preferences-mobile")
    for name in ["overview", "profile", "security", "data", "preferences"]:
        section(page, name)
        if os.environ.get("AXE_JS"):
            if not page.evaluate("Boolean(window.axe)"):
                page.add_script_tag(path=os.environ["AXE_JS"])
            issues = page.evaluate(
                """async() => (await axe.run('#account-dialog',{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations.map(v=>[v.id,v.nodes.map(n=>n.target)])"""
            )
            assert not issues, (name, issues)
    page.keyboard.press("Escape")
    expect(page.locator("#vault-open")).to_be_focused()
    expect(page.locator("body")).to_have_attribute("data-browse", "compact")
    expect(page.locator("#order")).to_have_value("highest")
    page.locator("[data-section=tv]").click()
    expect(page.locator("#order")).to_have_value("oldest")
    page.locator("#account-open").click()
    f["button"](page, "Forgot password?").click()
    expect(page.locator("#account-body")).to_contain_text("Recovery email is unavailable")
    expect(f["button"](page, "Send recovery code")).to_have_count(0)
    page.locator("#center-guest").click()
    expect(page.locator("#center-name")).to_have_text("Guest journal")
    assert not errors, errors
    context.close()


def foreground(browser, url, services):
    a, reader, wire, errors = f["device"](browser, url, services)
    b, writer, _, other_errors = f["device"](browser, url, services)
    reader.clock.install()
    email, pw, uid = services["users"][0]
    key = "aftercredits.cloud.v1." + f["HOST"] + "." + uid + ".archive"
    for page in [reader, writer]:
        f["login"](page, email, pw)
        f["signed_in"](page, uid)
        f["synced"](page)
        page.locator("#account-close").click()
    # A remote edit arrives while the reader is already visible. No settings UI is open.
    f["change"](
        writer, dict(action="add", title="Morning screening", rating=8.5, mediaType="movie")
    )
    writer.wait_for_function(
        "key=>{const c=JSON.parse(localStorage[key]);return c.cursor===1&&!c.pending.length&&!c.flight}",
        arg=key,
    )
    reader.clock.fast_forward(61000)
    expect(reader.locator("#headline")).to_have_text("Morning screening")
    f["account"](reader)
    expect(reader.locator(".cloud-state")).to_have_text("All changes saved")
    pulls = []
    reader.on(
        "request", lambda req: pulls.append(req.url) if req.url.endswith("/rpc/ac_pull") else None
    )
    for _ in range(5):
        reader.evaluate("window.dispatchEvent(new Event('focus'))")
    reader.clock.run_for(300)
    assert not pulls, "Immediately repeated focus must reuse the fresh result"
    # Headless visibility override exercises the same browser lifecycle handler while advancing time.
    reader.evaluate(
        """() => {window.fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureHidden});document.dispatchEvent(new Event('visibilitychange'))}"""
    )
    reader.clock.fast_forward(180000)
    assert not pulls
    before = reader.evaluate("k=>JSON.parse(localStorage[k]).lastSync", key)
    reader.evaluate(
        "window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))"
    )
    reader.clock.run_for(250)
    reader.wait_for_function(
        "([k,before])=>JSON.parse(localStorage[k]).lastSync!==before", arg=[key, before]
    )
    expect(reader.locator(".cloud-state")).to_have_text("All changes saved")
    assert len(pulls) == 1, pulls
    # A hide event cancels an outstanding read. Bring it back and let the durable queue flush.
    reader.evaluate("""() => {
      const fetchReal=window.fetch;
      window.fetch=(path,opts)=>{
        if(String(path).endsWith('/rpc/ac_pull') && !window.heldRead) {
          window.heldRead=true;
          return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{
            window.cancelledRead=true;reject(new DOMException('Aborted','AbortError'));
          },{once:true}));
        }
        return fetchReal(path,opts);
      };
    }""")
    f["change"](reader, dict(action="add", title="Hidden tab edit", mediaType="tv", rating=9))
    reader.wait_for_function("window.heldRead===true")
    reader.evaluate(
        "window.fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'))"
    )
    reader.wait_for_function("window.cancelledRead===true")
    assert any(e["title"] == "Hidden tab edit" for e in f["entries"](reader))
    reader.evaluate(
        "window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))"
    )
    expect(reader.locator(".cloud-state")).to_have_text("All changes saved")
    f["force"](writer)
    assert any(e["title"] == "Hidden tab edit" for e in f["entries"](writer))
    # Once transient retries have stopped, a user can retry from the contextual error state.
    wire["block_rpc"] = True
    pulls.clear()
    reader.evaluate("window.dispatchEvent(new Event('online'))")
    expect(reader.locator(".cloud-state")).to_have_text("Needs attention")
    for n, delay in enumerate([2000, 4000, 8000, 16000, 32000], start=2):
        reader.clock.fast_forward(delay + 100)
        expect(reader.locator(".cloud-state")).to_have_text("Needs attention")
        assert len(pulls) == n, (n, pulls)
    reader.clock.fast_forward(120000)
    assert len(pulls) == 6
    wire["block_rpc"] = False
    reader.locator(".cloud-retry").click()
    expect(reader.locator(".cloud-state")).to_have_text("All changes saved")
    expect(reader.locator(".cloud-retry")).to_be_hidden()
    assert not errors and not other_errors, (errors, other_errors)
    a.close()
    b.close()


if __name__ == "__main__":
    with f["stack"]() as services, f["site"](recovery=False) as url, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
        guest_center(browser, url, services)
        foreground(browser, url, services)
        browser.close()
    print(
        "Passed unified navigation, shared preferences, mobile accessibility, automatic foreground convergence, cancellation and bounded retry checks."
    )
