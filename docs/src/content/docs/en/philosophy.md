---
title: Design Philosophy
description: The three-layer triage that decides how a workflow fetches data — skip the browser, intercept the network, or delegate the DOM to Stagehand.
---

browser-cli has one opinion about how you should fetch data, and it shapes the entire tool:

> **Avoid the browser if you can. If you need the browser, prefer intercepting the network over parsing the DOM. If you must touch the DOM, let the LLM hold the reins via Stagehand.**

This is a triage, not a rulebook. Every workflow walks these three layers top-down and stops at the highest one that actually works. Each layer is faster than the one below it, and less durable against change. You trade speed for resilience as you go deeper.

## Layer 0 — Skip the browser entirely

Before you reach for browser-cli at all, ask:

- Is there a public REST or GraphQL API?
- Does the site publish an Atom or RSS feed?
- Can you replicate the auth with a static token, an API key, or basic auth?

If the answer to any of these is yes, don't write a workflow. Write a shell script and a cron line. You save the cost of launching Chrome, keeping a CDP connection alive, and managing page lifecycles. You keep the loop debuggable with `curl` and `jq`. You don't have to worry about orphaned browser processes leaking memory at 3 a.m.

Reddit at `/r/<sub>.json`, most GitHub data, anything behind a published API — all of this belongs outside browser-cli.

## Layer 1 — Intercept the network

When the browser is the only way in — because of auth cookies, CSRF handshakes, or client-side routing — the browser is a vehicle, not the destination. What you actually want is the JSON the page is already fetching. So capture it.

```
page.captureResponses(matcher)    // bulk XHR/fetch spy
page.waitForJsonResponse(url)     // wait for the first matching JSON
page.fetch(url, init)             // fire an authenticated request yourself
```

These three helpers live in `src/helpers/network.ts`. The bulk spy is injected as a string at page init so it catches every request — `fetch`, `XMLHttpRequest`, both — into a rolling 500-entry buffer. The two waiter helpers poll that buffer.

JSON beats the DOM on every axis that matters:

- **Stability**: endpoints version slowly; class names churn on every A/B test.
- **Structure**: parsing JSON is parsing; parsing DOM is archaeology.
- **Debuggability**: you can diff two JSON responses. You cannot meaningfully diff two rendered DOMs.
- **Auth comes free**: `page.fetch` runs in the page's own JS context, inheriting cookies and origin.

If the page fetches the data you want, intercept the fetch. Don't scrape the screen.

## Layer 2 — Stagehand for the DOM

Some data only exists in the rendered DOM. Some interactions — clicking a button, filling a form, dismissing a modal — only exist as pixels. When you reach this layer, delegate to [Stagehand](https://github.com/browserbase/stagehand):

```
page.act("click the 'Export' button")
page.extract("extract the export metadata", schema)
```

Stagehand's selectors are LLM-backed: it translates your intent into an actual element at runtime. When a site reorders its DOM or renames a CSS class, your workflow still works because Stagehand re-resolves from the instruction, not from a cached XPath. We enable `selfHeal: true` so successful selections are cached; if the cached selector fails later, Stagehand transparently re-queries the LLM and updates the cache.

This layer is slow (a few seconds per `act` or `extract`) and costs tokens. That's the price of durability.

## The escape hatch — and why it's dangerous

Raw `page.evaluate` + `document.querySelector` is **not the default**. It's an escape hatch. It's appropriate when the DOM is *trivially stable* — structure that hasn't changed in years and isn't behind an A/B test. Hacker News is the canonical example: `tr.athing` has survived every redesign.

The trap is that *every* page looks trivially stable at first glance. Then the site ships a new class name prefix, your selectors shatter, and your workflow fails silently. If you drop to raw DOM queries, leave a comment explaining why this page is exempt. Assume any reviewer (including future you) will challenge it.

## Why this ordering

| Layer | Speed | Reliability under drift | Debuggability | Token cost |
|---|---|---|---|---|
| 0 — curl/fetch | ~50 ms | Breaks only if the API changes | Trivial | None |
| 1 — intercept | ~500 ms | Breaks only if the JSON contract changes | JSON logs | None |
| 2 — Stagehand | 2–5 s | Adapts to selector drift | LLM reasoning traces | ~1–2 k per call |

Each step down is 10× slower and ~10× more forgiving. Pick the highest feasible layer, not the lowest you can get to work.

## Decision tree

1. **Is there a public API, RSS, or static data source?** → Don't use browser-cli. Use `curl`.
2. **Does the page fetch JSON client-side that contains what you need?** → Layer 1 (`page.captureResponses` / `page.waitForJsonResponse` / `page.fetch`).
3. **Is the data rendered only in the DOM?** → Layer 2 (`page.extract` with a Zod schema).
4. **Do you need to click, fill, or interact?** → Layer 2 (`page.act`).
5. **Is the structure trivially stable *and* LLM latency is a dealbreaker?** → Raw `page.evaluate`, documented as an exception.

Each layer has its own sharp edges — cross-origin cookies, race conditions on spy install, Cloudflare bot challenges on POSTs — which we'll document in a dedicated gotchas guide. The philosophy is the map; the gotchas are the terrain.
