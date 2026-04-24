---
name: sync-docs
description: Use when the user asks to sync, translate, or mirror changes between English (docs/src/content/docs/en/) and Simplified Chinese (docs/src/content/docs/zh-cn/) versions of the browser-cli Starlight docs. Triggers on phrases like "sync docs", "同步文档", "翻译文档", "把文档补一下中文", or after the user edits files in either locale and wants the other side updated.
---

# Sync Docs (EN ↔ zh-CN)

## Overview

The browser-cli docs site is a Starlight site with two locales under `docs/src/content/docs/`: `en/` and `zh-cn/`. This skill keeps them in sync — translate new pages, mirror edits in either direction, flag conflicts.

**Source of truth rule:** whichever side the user just edited is authoritative for that change. Never guess — if both sides changed in overlapping spans, stop and ask.

## Trigger detection

Run this skill when the user asks to sync / translate / mirror docs. Always start by running:

```bash
git diff HEAD -- docs/src/content/docs/en/ docs/src/content/docs/zh-cn/
git status -- docs/src/content/docs/
```

Include both staged and unstaged changes, plus untracked files (new pages).

## File layout

- English source: `docs/src/content/docs/en/*.md[x]`
- Chinese target: `docs/src/content/docs/zh-cn/*.md[x]`
- Sidebar + locale config: `docs/astro.config.mjs` (the `sidebar` array uses `label` for English and `translations: { 'zh-CN': '...' }` for Chinese)

Mirror the tree exactly — same filenames, same directory shape. Starlight resolves pages by matching path under each locale root, so `en/concepts/workflow.md` must have `zh-cn/concepts/workflow.md`.

## Three cases

### Case A: Initial translation (zh-cn file missing)

1. Read the `en/` file.
2. Create `zh-cn/<same path>` with the same frontmatter keys; translate the values of `title` and `description`, keep other keys verbatim.
3. Translate body following the terminology and structure rules below.

### Case B: Incremental sync (both exist, one edited)

1. From the diff, identify which side changed.
2. For each added/modified block, apply the mirror change to the other locale. Preserve surrounding untouched content.
3. For deleted blocks, delete the corresponding block on the other side.
4. Report a 1-line summary per file changed before handing back.

### Case C: Conflict (both sides changed overlapping content)

Stop. Show the user the conflicting spans and ask which side is authoritative. Do not merge heuristically.

## Terminology — keep in English

Product and domain terms stay in English, no italics, no quotes:

- `browser-cli`, `workflow`, `task`, `LLM`, `CLI`, `fallback`, `selector`
- Libraries: `Stagehand`, `Playwright`, `pnpm`, `npm`, `Astro`, `Starlight`
- APIs: `pageFetch`, `waitForJsonResponse`, `unsafe()`, and any exported function name
- File paths, shell commands, flags, env vars, code identifiers

Everything else translates to 简体中文. Tone: 技术文档口语化风格（参考 Astro / Vite 中文文档），不要写成学术翻译腔。`you` 译为"你"，不要"您"。

## Structural rules

- **Preserve heading levels, list structure, and code block count/order exactly.** This is what lets future `git diff` map one-to-one. If you reorder sections in one locale, future syncs break.
- **Never translate inside code blocks or inline `code spans`** — including comments in example code, unless the en/ file itself has translatable prose comments meant for readers.
- **Frontmatter:** translate only `title` and `description` values. All other keys (e.g. `sidebar.order`, `slug`, custom Starlight fields) are copied unchanged.
- **Admonitions / MDX components** (`:::note`, `<Card>`, etc.): translate the content inside, keep the tag syntax and attributes identical.

## Internal links — absolute URL paths only

Starlight / Astro does **not** rewrite `[text](./foo.md)` links in Markdown bodies in this project. `.md` extensions survive into the HTML output and 404 in production. Always use absolute URL paths with the locale prefix:

- ✅ `[text](/en/concepts/task/)` in `en/*.md`
- ✅ `[text](/zh-cn/concepts/task/)` in `zh-cn/*.md`
- ❌ `[text](./task.md)` — renders as `<a href="./task.md">`, broken
- ❌ `[text](../philosophy/)` — survives, but drift-prone; prefer absolute

When mirroring a link from en/ to zh-cn/, rewrite the `/en/` prefix to `/zh-cn/`. That's the only difference.

## Anchor links — predict the slug, don't guess it

Starlight uses github-slugger. Be aware of the two gotchas that bite in this repo:

- **em-dash (`—`) becomes TWO dashes** in the slug. `## Layer 1 — Intercept the network` → `#layer-1--intercept-the-network` (double dash). Same in Chinese: `## Layer 1 — 拦截网络` → `#layer-1--拦截网络`.
- **CJK characters are preserved verbatim**, so a translated heading produces a translated slug. Link `#` targets must match the translated heading in the same locale's file.

When syncing a page that links into another page's heading, verify the target slug is still correct after translation. If the target heading was reworded, the linking file on the same side must be updated too — and the other locale's link must be re-derived from its own translated heading, not copied from the source locale.

## Sidebar updates

## Sidebar updates

When a new page is added under either locale, also update `docs/astro.config.mjs`:

- Add or adjust the English `label`.
- Add/adjust `translations: { 'zh-CN': '中文标签' }` on the same sidebar entry.
- Match the existing sidebar structure — don't introduce a new nesting style.

## Before finishing

1. Run `pnpm -C docs build` to verify both locales build without missing translations. The build itself does **not** fail on broken internal links — you must grep the output:

   ```bash
   # Any surviving .md extensions in rendered body hrefs? Should return nothing.
   grep -rn '\.md["#]' docs/dist/en/ docs/dist/zh-cn/ 2>/dev/null | grep -v '\.md\.html' | grep 'href='

   # Any anchor hrefs whose slug can't be found as an id in the target file?
   # (Eyeball check: compare `grep -oE 'href="[^"]*#[^"]*"' <page>/index.html` against `grep -oE 'id="[^"]*"' <target>/index.html`.)
   ```
2. Print a short summary to the user:

   ```
   Synced:
   - en/install.md → zh-cn/install.md  (3 paragraphs updated)
   - new: zh-cn/concepts/task.md       (initial translation)
   ```
3. Do **not** `git commit` unless the user asked for a commit. Default is to leave changes staged for the user's review.

## Red flags — stop and ask

- Both locales changed in overlapping spans (case C).
- The `en/` structure diverges from `zh-cn/` in heading count or code block order — this means a prior sync drifted. Surface this before syncing further, don't silently reorder.
- A term not in the keep-in-English list but that looks like product jargon — ask before translating.
