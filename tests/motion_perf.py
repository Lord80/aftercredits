"""Compare two locally served revisions under the same Chromium conditions."""
import json
import shutil
import statistics
import sys
from playwright.sync_api import sync_playwright

urls = sys.argv[1:]
if not urls:
    sys.exit("Pass one or more locally served revisions to compare.")
entries = [dict(id=str(i), mediaType="movie", title=f"Screening {i:03}", rating=1+i%19/2,
                metadata=None, tmdbId=None, added="2026-01-01T00:00:00Z") for i in range(300)]
watch_ready = """new MutationObserver((_, observer) => {
  if (document.querySelector('#result-status')?.textContent) {
    window.archiveReady = performance.now(); observer.disconnect();
  }
}).observe(document, {childList:true, subtree:true})"""
sample_motion = """() => new Promise(resolve => {
  const times = [], button = document.querySelector('.shuttle [data-step="1"]');
  let last = 0, next = 0, start;
  function sample(time) {
    start ??= time;
    if (last) times.push(time - last);
    if (time - start >= next) { button.click(); next += 240; }
    last = time;
    if (time - start < 1400) requestAnimationFrame(sample); else resolve(times);
  }
  requestAnimationFrame(sample);
})"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
    reports = {url: dict(cold=[], warm=[], sort=[], interval_p95=[]) for url in urls}
    for run in range(5):
        # Alternate which revision goes first on the same machine.
        for url in (urls if run % 2 == 0 else reversed(urls)):
            report = reports[url]
            context = browser.new_context(viewport=dict(width=1152, height=760))
            context.add_init_script(watch_ready)
            page = context.new_page()
            for cache in ["cold", "warm"]:
                page.goto(url)
                page.wait_for_function("window.archiveReady")
                report[cache].append(round(page.evaluate("archiveReady"), 1))
                if cache == "cold":
                    page.goto("about:blank")
            page.evaluate("v => localStorage.setItem('aftercredits.collection.v2',v)",
                          json.dumps(dict(version=2, entries=entries)))
            page.reload()
            page.wait_for_timeout(1400)
            report["sort"].append(round(page.evaluate("""() => {
              const start=performance.now(), order=document.querySelector('#order');
              order.value='highest'; order.dispatchEvent(new Event('change'));
              document.querySelector('.movie-list').getBoundingClientRect();
              return performance.now()-start;
            }"""), 1))
            page.wait_for_timeout(500)
            intervals = sorted(page.evaluate(sample_motion))
            report["interval_p95"].append(round(intervals[int(.95*(len(intervals)-1))], 1))
            context.close()
    for url, report in reports.items():
        print(json.dumps(dict(url=url, chromium=browser.version, runs=report,
                              medians_ms={k: statistics.median(v) for k,v in report.items()}), indent=2))
    browser.close()
