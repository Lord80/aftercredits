"""Exercise opt-in email verification, private reopening and optional CAPTCHA with disposable accounts."""

from pathlib import Path
from secrets import token_urlsafe
import json
import os
import re
import runpy
import shutil
import sys
from playwright.sync_api import expect, sync_playwright

fixture = runpy.run_path(str(Path(__file__).with_name("cloud.browser.py")))
stack, site, device, http, capture, account, login, signout, signed_in, synced, button, read = (
    fixture[k]
    for k in (
        "stack",
        "site",
        "device",
        "http",
        "capture",
        "account",
        "login",
        "signout",
        "signed_in",
        "synced",
        "button",
        "read",
    )
)
session_key = fixture["SESSION"]


def inbox(services, subject, template_text):
    messages = json.loads(http(services["mail"] + "/api/v1/messages")[1])["messages"]
    mail = next(row for row in messages if subject.lower() in row["Subject"].lower())
    letter = json.loads(http(services["mail"] + "/api/v1/message/" + mail["ID"])[1])
    assert template_text in letter["HTML"], "The published mail template should be used by Auth."
    return re.search(r"<strong[^>]*>\s*(\d{6,10})\s*</strong>", letter["HTML"], re.I)[1]


def registration(browser, services, folder):
    with site(registration=True) as url:
        ctx, page, net, errors = device(browser, url, services, mobile=True)
        downloads = []
        page.on("download", lambda d: downloads.append(d.suggested_filename))
        account(page)
        button(page, "Create account").click()
        expect(page.locator("#account-heading")).to_have_text("Create account")
        for width in [320, 360, 390, 430, 768, 1440]:
            page.set_viewport_size(dict(width=width, height=844))
            assert page.evaluate(
                "document.documentElement.scrollWidth<=innerWidth && document.querySelector('#account-dialog').scrollWidth<=document.querySelector('#account-dialog').clientWidth"
            )
        page.set_viewport_size(dict(width=390, height=844))
        capture(page, folder, "registration-mobile")
        if os.environ.get("AXE_JS"):
            page.add_script_tag(path=os.environ["AXE_JS"])
            violations = page.evaluate(
                "async()=> (await axe.run('#account-dialog',{runOnly:['wcag2a','wcag2aa','wcag21aa']})).violations.map(v=>v.id)"
            )
            assert not violations, violations
        email, password = "visitor@archive.example.test", token_urlsafe(24)
        page.get_by_label("Email", exact=True).fill(email)
        page.get_by_label("Display name", exact=True).fill("Sora")
        page.get_by_label("Password", exact=True).fill("short")
        assert not page.locator("form.cloud-form").evaluate("f=>f.checkValidity()")
        page.get_by_label("Password", exact=True).fill(password)
        button(page, "Create account").click()
        expect(page.locator("#account-heading")).to_have_text("Verify your email")
        assert read(page, session_key) is None
        code = inbox(services, "confirm", "Confirm your AFTERCREDITS account")
        button(page, "Back to sign in").click()
        login(page, email, password)
        expect(page.locator("#account-heading")).to_have_text("Verify your email")
        assert read(page, session_key) is None
        page.get_by_label("Confirmation code").fill("000000" if code != "000000" else "111111")
        button(page, "Verify email").click()
        expect(page.locator("#account-message")).to_have_attribute("data-error", "")
        page.get_by_label("Confirmation code").fill(code)
        button(page, "Verify email").click()
        signed_in(page)
        assert downloads == [] and fixture["entries"](page) == []
        synced(page)
        expect(page.locator("#center-name")).to_have_text("Sora")
        expect(page.get_by_role("button", name=re.compile("Review guest titles"))).to_have_count(0)
        # Account security uses the verified address. An unavailable mail provider keeps the form open.
        page.locator("[data-center=security]").click()
        button(page, "Reset password").click()
        expect(page.get_by_label("Email", exact=True)).to_have_value(email)
        expect(page.get_by_label("Email", exact=True)).not_to_be_editable()
        ctx.route(
            fixture["PROJECT"] + "/auth/v1/recover",
            lambda route: route.fulfill(
                status=503, json={}, headers={"Access-Control-Allow-Origin": "*"}
            ),
            times=1,
        )
        button(page, "Send recovery code").click()
        expect(page.locator("#account-message")).to_contain_text("recovery email is unavailable")
        expect(page.locator("#account-heading")).to_have_text("Forgot password?")
        button(page, "Send recovery code").click()
        expect(page.locator("#account-heading")).to_have_text("Set a new password")
        recovery_code = inbox(services, "reset", "Reset your AFTERCREDITS password")
        page.get_by_label("Recovery code").fill(recovery_code)
        password = token_urlsafe(24)
        page.get_by_label("New password", exact=True).fill(password)
        button(page, "Set new password").click()
        expect(page.locator("#account-heading")).to_have_text("Security")
        expect(page.locator("#account-message")).to_have_text("Password updated.")
        page.locator("#account-close").click()
        expect(page.locator("#account-open")).to_be_focused()
        # Editing with the network stopped leaves a real private copy and a pending change.
        net["block"] = True
        fixture["change"](
            page, dict(action="add", mediaType="movie", title="A private screening", rating=9.5)
        )
        signout(page)
        assert not fixture["entries"](page)
        net["block"] = False
        net["block_rpc"] = True
        login(page, email, password)
        signed_in(page)
        expect(page.locator("#headline")).to_have_text("A private screening")
        assert fixture["entries"](page)[0]["rating"] == 9.5
        account(page)
        expect(page.locator(".cloud-state")).to_have_text("Needs attention")
        net["block_rpc"] = False
        fixture["force"](page)
        # An older release could leave a signed-in account waiting for a migration decision.
        # Resuming that session must preserve its cache, read-only guest source, and private focus.
        page.evaluate(
            "key=>{const s=JSON.parse(localStorage.getItem(key));s.linked=false;localStorage.setItem(key,JSON.stringify(s))}",
            session_key,
        )
        page.reload()
        signed_in(page)
        expect(page.locator("#headline")).to_have_text("A private screening")
        # A guest copy of a deleted title stays local; a different rating needs explicit consent.
        private = fixture["entries"](page)[0]
        gone_id = fixture["change"](
            page, dict(action="add", mediaType="tv", title="Retired print", rating=6)
        )
        fixture["force"](page)
        gone = next(e for e in fixture["entries"](page) if e["id"] == gone_id)
        fixture["change"](page, dict(action="delete", id=gone_id))
        fixture["force"](page)
        guest_bytes = json.dumps(dict(version=2, entries=[dict(private, rating=3.5), gone]))
        page.evaluate("([k,v])=>localStorage.setItem(k,v)", [fixture["GUEST"], guest_bytes])
        page.locator("#account-close").click()
        account(page)
        fixture["vault"](page)
        page.locator("#vault-guest").click()
        expect(page.locator("#vault-source")).to_contain_text("1 previously deleted")
        expect(page.locator("#vault-apply")).to_be_disabled()
        page.get_by_label("Use the guest version").check()
        page.locator("#vault-apply").click()
        expect(page.locator("#vault-preview")).to_be_hidden()
        assert fixture["entries"](page) == [dict(private, rating=3.5)]
        assert read(page, fixture["GUEST"]) == guest_bytes
        page.locator("#vault-advanced summary").first.click()
        expect(page.locator("#vault-history button")).to_have_count(1)
        assert not downloads and not errors
        ctx.close()


def challenge(browser, services):
    # This stub exercises only the adapter. Supabase's production challenge verification needs real keys.
    with site(captcha="fixture-site-key") as url:
        ctx, page, _, errors = device(browser, url, services)
        tokens = []
        page.on(
            "request",
            lambda req: tokens.append(req.post_data_json.get("gotrue_meta_security"))
            if "/token?grant_type=password" in req.url and req.method == "POST"
            else None,
        )
        route = "https://challenges.cloudflare.com/turnstile/**"
        ctx.route(route, lambda r: r.abort())
        email, pw, uid = services["users"][0]
        login(page, email, pw)
        assert not tokens and read(page, session_key) is None
        page.locator("#account-close").click()
        ctx.unroute(route)
        ctx.route(
            route,
            lambda r: r.fulfill(
                content_type="application/javascript",
                body="window.turnstile={render(n,o){o.callback('fixture-response');return 'example'},remove(){},reset(){}}",
            ),
        )
        account(page)
        login(page, email, pw)
        signed_in(page, uid)
        assert tokens == [{"captcha_token": "fixture-response"}] and not errors
        ctx.close()


if __name__ == "__main__":
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    with stack(registration=True) as services, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
        registration(browser, services, folder)
        challenge(browser, services)
        browser.close()
    print(
        "Passed opt-in signup, confirmed email codes, profile, empty first connection, cached return and CAPTCHA adapter checks."
    )
