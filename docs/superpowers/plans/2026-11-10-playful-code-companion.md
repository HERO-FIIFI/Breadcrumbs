# Playful Code Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Breadcrumbs webview a playful, responsive code-reading companion without changing explanation or privacy behavior.

**Architecture:** Keep the extension host as the source of truth for panel state and add a self-contained animation layer to the existing webview HTML. Load Anime.js as a bundled dependency, then animate only after `render(state)` has committed the real state to the DOM.

**Tech Stack:** TypeScript, VS Code Webview API, Anime.js, Node test runner, Mocha extension-host smoke test.

**Spec:** `docs/superpowers/specs/2026-11-10-playful-code-companion-design.md`

## Global Constraints

- Preserve provider, privacy, storage, and trail behavior.
- Honor `prefers-reduced-motion` by rendering state changes without animation.
- Use only VS Code theme variables; add no external network requests or imagery.
- Motion must not imply a provider response or approval before the real state is available.

## Review Focus

- Reduced-motion preference: no Anime.js motion is started.
- Empty-to-first-crumb change: state appears even if animation is unavailable.
- Provider error: visible error copy is never hidden by transition timing.
- Rapid cursor updates: only current DOM nodes are animated; stale nodes are not retained.
- Narrow panel widths: animated elements retain readable, non-overlapping text.

---

### Task 1: Bundle and test the motion dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/smoke-runner.test.ts`

**Interfaces:**
- Produces: an installed `animejs` package available to `src/extension.ts` for bundling into the webview.

- [ ] **Step 1: Write a failing dependency regression test**

Assert that the package manifest declares `animejs` and the lockfile resolves it.

- [ ] **Step 2: Run the regression test and verify it fails**

Run: `npm run compile && node --test dist/test/smoke-runner.test.js`
Expected: FAIL because Anime.js is not declared.

- [ ] **Step 3: Add Anime.js as an exact runtime dependency**

Use the package version compatible with the current Node and VS Code webview build path.

- [ ] **Step 4: Run the regression test and verify it passes**

Run: `npm run compile && node --test dist/test/smoke-runner.test.js`
Expected: PASS.

### Task 2: Add accessible, reduced-motion-aware panel animation

**Files:**
- Modify: `src/extension.ts`
- Test: `test/core.test.ts`

**Interfaces:**
- Consumes: `state`, `history`, `active`, `autoExplain`, `provider`, and `hasApiKey` emitted by `BreadcrumbsViewProvider.createState`.
- Produces: a webview `render(state)` that visually marks state transitions after the DOM updates.

- [ ] **Step 1: Write a failing webview-content regression test**

Assert the generated webview contains the reduced-motion guard and stable selectors for current status, empty state, and trail entries.

- [ ] **Step 2: Run the affected test and verify it fails**

Run: `npm test`
Expected: FAIL because no animation selectors or reduced-motion guard exist.

- [ ] **Step 3: Implement the playful interaction layer in `BreadcrumbsViewProvider.getHtml`**

Add Anime.js to the webview bundle, give current state regions stable semantic selectors, and animate the current card, status indicator, empty state, and newly rendered trail cards only when reduced motion is not requested.

- [ ] **Step 4: Run all unit tests and verify they pass**

Run: `npm test`
Expected: all tests PASS.

### Task 3: Rehearse the live extension panel

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the `test:smoke` command and the extension's existing provider setup UI.
- Produces: a short live-demo checklist covering panel discovery and motion states.

- [ ] **Step 1: Add a concise live-panel rehearsal checklist**

Cover opening the panel (not the Marketplace details page), first-run empty state, active-line change, pause/resume, clear trail, and provider missing-key/error states using a synthetic file.

- [ ] **Step 2: Run the real extension-host smoke test**

Run: `npm run test:smoke`
Expected: one passing activation/command test and exit code 0.

- [ ] **Step 3: Inspect the visible Extension Development Host panel**

Confirm motion does not obstruct text and that reduced-motion users retain all state feedback.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/extension.ts test README.md
git commit -m "feat: animate Breadcrumbs reading flow"
```
