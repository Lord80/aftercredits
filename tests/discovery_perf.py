"""Compare the same 1,000-entry local archive on two supplied HTTP revisions."""

import json
import shutil
import statistics
import sys
from playwright.sync_api import sync_playwright

urls = sys.argv[1:]
assert len(urls) == 2, "Supply Phase 3B and Phase 4A preview URLs."
entries = [
    dict(
        id=str(i),
        title=("Evening" if not i % 10 else "Morning") + f" print {i:04}",
        mediaType="movie",
        rating=1 + (i % 19) / 2,
        added="2025-01-01",
        metadata=None,
        tmdbId=None,
    )
    for i in range(1000)
]
observed = """new MutationObserver((_,obs)=>{if(document.querySelector('#result-status')?.textContent){
window.readyTime=performance.now();obs.disconnect()}}).observe(document,{subtree:true,childList:true})"""
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
    results = {url: [] for url in urls}
    for run in range(5):
        for url in urls if run % 2 == 0 else reversed(urls):
            ctx = browser.new_context(
                viewport=dict(width=1152, height=760), reduced_motion="reduce"
            )
            ctx.add_init_script(observed)
            page = ctx.new_page()
            page.goto(url)
            page.wait_for_function("window.readyTime")
            page.evaluate(
                "entries=>localStorage.setItem('aftercredits.collection.v2',JSON.stringify({version:2,entries}))",
                entries,
            )
            page.reload()
            page.wait_for_function(
                "document.querySelector('#result-status')?.textContent.startsWith('1000 ')"
            )
            ready = page.evaluate("readyTime")
            nodes = page.locator("#results *").count()
            cards = page.locator("#results [data-film]").count()
            page.wait_for_timeout(400)
            search = page.evaluate("""()=>new Promise(resolve=>{
              const start=performance.now(),input=document.querySelector('#query'),status=document.querySelector('#result-status');
              const changes=new MutationObserver(()=>{
                if(status.textContent.startsWith('100 ')){
                  document.querySelector('#results').getBoundingClientRect();changes.disconnect();resolve(performance.now()-start)
                }
              });changes.observe(status,{childList:true,subtree:true});
              input.value='Evening'; input.dispatchEvent(new Event('input'));
            })""")
            results[url].append(
                dict(
                    ready_ms=round(ready, 1),
                    search_ms=round(search, 1),
                    cards=cards,
                    result_elements=nodes,
                )
            )
            ctx.close()
    print(
        json.dumps(
            dict(
                chromium=browser.version,
                runs=results,
                medians={
                    url: {k: statistics.median(x[k] for x in data) for k in data[0]}
                    for url, data in results.items()
                },
            ),
            indent=2,
        )
    )
    browser.close()
