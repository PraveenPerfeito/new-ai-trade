# UI.UX.MODERNIZATION.1

**Date:** 2026-06-16
**Author:** Principal Product Designer + Staff UX + Senior Frontend Architect
**Status:** APPROVED FOR IMPLEMENTATION
**Scope:** Visual modernization only — zero functionality changes

---

## 1. Executive Summary

The admin dashboard works. The signal logic, gating pipeline, and analytics are solid. But the presentation is a 2022 terminal clone in a market where the reference bar is Linear, Stripe, and TradingView. Every component fights for attention at the same visual weight. The result is cognitive overload, not clarity.

The three problems:

1. **Everything is equally loud.** Bold everywhere. Uppercase everywhere. Mono everywhere. Nothing is actually important because everything claims to be.
2. **Color is meaningless.** 10 lifecycle stage colors. 4 scan mode colors. 5 grade colors. Each section invents its own palette. The eye learns to ignore it.
3. **Density without hierarchy.** Useful data is buried beside redundant data. Entry/TP/SL share row weight with timestamps and metadata. The scanner card competes with the regime card for the same visual weight.

The fix is not a redesign. It is a discipline pass: one typography scale, one color system, one card anatomy, applied uniformly. Zero features added. Zero features removed.

**Confidence this can ship without regressions: HIGH.** All changes are Tailwind class swaps. No logic changes. No API changes. No component restructuring beyond layout.

---

## 2. Current Design Audit

### Scores (1–10)

| Category | Score | Key Issue |
|---|---|---|
| Typography | 3/10 | No hierarchy. `text-[9px]` through `text-sm` with 6 intermediate steps. Mono used everywhere. |
| Spacing | 4/10 | px-3/4/5 py-2/2.5/3/3.5/4 used interchangeably. No grid unit. |
| Alignment | 5/10 | Flex rows work. Grid works. But card internal alignment is inconsistent. |
| Color | 3/10 | 3 green systems (`bull-default`, `emerald-*`, `green-*`). Dual naming (`terminal-*` + `zinc-*`). Badge rainbow. |
| Hierarchy | 3/10 | Scanner status == entry price == timestamp visually. |
| Visual Weight | 3/10 | Uppercase + tracking + bold applied to everything including footnotes. |
| Information Density | 5/10 | Dense but not wrong. Scannable in some places, impenetrable in others. |
| Navigation | 6/10 | Tab structure is clear. Active states are subtle but functional. |

**Overall: 4/10.** Not broken. Not modern.

---

## 3. Typography Improvements

### Current Problem

Six font sizes with no semantic meaning:
```
text-[9px]   — card label (uppercase tracking-widest)
text-[10px]  — body text, chips, captions
text-[11px]  — emphasis, values
text-xs      — table cells, general body (12px)
text-sm      — headings, status text (14px)
text-xl      — page headers only (20px)
```

`font-mono` is used for: card values, labels, page headers, table cells, badge text, tab labels. It has no semantic meaning.

`uppercase tracking-wider/widest` is used for: card labels, table headers, section dividers, badge text. Zero hierarchy signal.

### Proposed Type Scale

```
Display   — text-2xl  font-semibold tracking-tight          — Page-level KPI numbers (WR%, Exp)
Heading   — text-base font-semibold text-white              — Card titles, section headers
Section   — text-xs   font-semibold uppercase tracking-wide text-zinc-400  — Section dividers, group labels
CardTitle — text-sm   font-medium   text-white              — Within-card headers
Label     — text-[10px] font-medium text-zinc-500           — Field labels (REMOVE uppercase)
Body      — text-xs   text-zinc-300                         — Content text
Mono      — text-xs   font-mono     text-zinc-200           — Numbers, prices, rates ONLY
Caption   — text-[10px] text-zinc-600                       — Timestamps, IDs, metadata
```

### Rules

1. **Remove `uppercase` from all non-section labels.** Labels reading "LAST SCAN AT" in small caps are noise. "Last scan" in Label style is enough.
2. **Remove `tracking-widest` everywhere except Section type.** Tight tracking for everything except explicit section dividers.
3. **Reserve `font-mono` for numbers and codes only.** Price, %, R-values, confidence scores, timestamps, Redis keys. Not button labels. Not page headers. Not tab names.
4. **Remove 9px, 11px.** Collapse to the 7-step scale above. These intermediate sizes are imperceptible and add maintenance burden.
5. **Reduce bold weight.** Replace `font-bold` with `font-semibold` everywhere except Display (KPI numbers). `font-bold` on a 10px label is visual noise.

---

## 4. Color System Improvements

### Current Problems

**Three green systems in simultaneous use:**
- `bull-default` (#00d084) — CTAs, active states, performance positive
- `emerald-400/500` — success badges, TP hit, healthy states  
- `green-400/500` — BULL_TREND regime, some value text

**Dual naming system:**
- `text-terminal-muted` and `text-zinc-500` are used interchangeably for the same visual intent
- `bg-terminal-surface` and `bg-zinc-900` are used interchangeably
- Creates confusion when reading code, both produce slightly different values

**Badge rainbow syndrome:**
10 lifecycle stage colors, 4 mode colors, 5 grade colors, 6 regime colors = 25 distinct colors in one signal card. The eye learns to ignore all of them.

### Proposed Color Token System

```
Surface tokens (replace terminal-* with zinc-* directly):
  Page background:    bg-zinc-950      (was terminal-bg)
  Card surface:       bg-zinc-900      (was terminal-surface)
  Elevated card:      bg-zinc-800/60   (was terminal-card / glass-card)
  Border:             border-zinc-800  (was terminal-border — unify to one)
  Border subtle:      border-zinc-700/50

Text tokens:
  Primary:   text-white           (was terminal-text — reserved for highest priority)
  Secondary: text-zinc-300        (was terminal-text at lower weight)
  Muted:     text-zinc-500        (was terminal-muted — standardize to /500 not /400 /600)
  Dim:       text-zinc-600        (was terminal-muted/50 / terminal-dim)

Semantic colors (ONLY these four, used consistently):
  Success:   emerald-400 / emerald-500  — TP hit, healthy, enabled, positive value
  Warning:   amber-400 / amber-500     — overdue, partial, degraded, caution
  Danger:    red-400 / red-500         — SL hit, critical, stopped, negative value
  Info:      blue-400 / blue-500       — scanning, sent, informational
  
  Accent (actions + brand):
  Brand:     #00d084 (bull-default)    — CTAs, active nav indicator ONLY
```

### Badge Color Reduction

**Lifecycle stages — reduce from 10 colors to 4:**
```
Active group  (ACTIVE, TELEGRAM_SENT, AI_APPROVED, SCREENED):   blue — all mean "in play"
Won           (TP_HIT):                                           emerald
Lost          (SL_HIT):                                           red
Closed group  (STALE, CLOSED, ANALYZED, VALIDATED):              zinc — all mean "done"
```

The current system gives VALIDATED, SCREENED, AI_APPROVED, TELEGRAM_SENT four different colors despite the user needing only one question: "is this signal currently live?"

**Grade colors — keep 4, consolidate greens:**
```
A / A+:  emerald-400   (success)
B / B+:  blue-400      (info)
C:       amber-400     (caution — good but not great)
D / F:   red-400       (danger)
```

**Scan mode chips — reduce from 4 colors to 1 style, use label differentiation:**
```
All modes: text-zinc-400 border-zinc-700 bg-zinc-800/50
Active mode: text-white border-zinc-500 bg-zinc-700  (one highlight, not 4 colors)
```

Rationale: the mode name IS the differentiator. Color is redundant information that trains the eye to ignore it.

**Regime colors — keep 6, they carry real meaning:**
```
BULL_TREND:      emerald-400
BEAR_TREND:      red-400
SIDEWAYS:        zinc-400
HIGH_VOLATILITY: amber-400
EUPHORIA:        purple-400
CAPITULATION:    rose-400
```
These six are justified — market regime is a fundamental state that deserves strong color coding.

---

## 5. Signals Center Improvements

### 5a. System Status Banner

**Current:** Full-width bar with colored border. Text is fine but dense.

**Improvement:**
- When all OK: reduce visual weight significantly. It's the normal state. Use `text-zinc-500` not `text-emerald-300` — green is a precious color, save it for real good news.
- When issues: keep amber/red but increase font weight of the issue names, not the prefix.

```
OK state:    bg-transparent border-zinc-800 text-zinc-500 — calm, not green-glowing
Issue state: bg-amber-500/5 border-amber-500/25 — keep current
Issue text:  font-medium (the issue name), text-zinc-400 (the "·" separators)
```

### 5b. Scanner + Regime Hero Row

**Current:** Scanner card has 5 distinct sub-sections (status header, last/next grid, manual scan section, lifecycle chips). Feels like 4 stacked forms.

**Improvement — consolidate into 2 zones:**

Zone 1 (top): Status + controls in one flex row
```
[● Active]     [Spot ▼]    [Scan Now]    [Stop Scanner]
 or                                        (red, prominent)
[● Stopped]    [—]         [—]           [Start Scanner]
               mode label                  (emerald, prominent)
```

Zone 2 (bottom): Metrics grid — Last scan / Next scan / Running mode
```
bg-zinc-800/40 rounded-lg px-4 py-2 grid grid-cols-3 gap-4
Label: Caption style (text-[10px] text-zinc-600)
Value: Mono style (font-mono text-sm text-white)
```

Remove: separate "Manual Scan" label, separate border-t divider. It's all one scanner card.

The mode selector buttons below the scan trigger: make them smaller, right-aligned, ghost buttons without individual colors.

### 5c. Signal Card (collapsed)

**Current layout (problem):**
```
[Symbol] [Type chip] [Mode chip] [TF] [Lifecycle] [Grade] [ConfBar] [RegimeAlign] [Freshness] [chevron]
[Entry: $X  TP: $X (+Y%)  SL: $X (-Y%)]
```

Too much in one row. The second row (entry/TP/SL) is the most important but is visually equal to the first.

**Improved layout:**
```
Row 1:  [Symbol bold]  [BUY/SELL large]  [Mode ghost chip]   [Lifecycle chip]    [↑↓]
Row 2:  Entry $X  →  TP $X (+Y%)  /  SL $X (-Y%)          [Conf: 87%]  [Grade B]
```

Changes:
- Symbol: `text-sm font-semibold text-white` — headline weight
- BUY/SELL: larger `text-sm font-bold` with color (emerald/red), no chip border needed
- Entry/TP/SL: give them the most visual weight — `text-xs font-mono text-white` with `→` separator
- Confidence: single number `87%` in mono, remove ConfBar (it duplicates the number)
- Grade: keep badge, single letter
- Lifecycle chip: simplified to 4-color system
- Remove: RegimeAlignDot (it's in the Intelligence Panel), FreshnessTag (visible in expanded only)

### 5d. Signal Card (expanded) — IntelligencePanel

**Current:** Flat list of 20+ chips with no grouping. Intelligence, Technical, AI, Futures all visually identical.

**Improved — 4 sections with visual separation:**
```
Section 1: Signal Quality (always visible on expand)
  [Confidence: 87%]  [Grade: B]  [Setup: 74]  [Expectancy: +0.62R]  [Empirical WR: 52% n=38]

Section 2: Intelligence (collapsed by default → one click to open)
  [Trend: ACCELERATING]  [Breakout: HIGH MOM]  [OI: NEW LONGS]  [Positioning: SHORT HEAVY]

Section 3: Technical (collapsed by default)
  [RSI 1h: 47]  [MACD: ↑]  [EMA200: ABOVE]  [ADX: 38]  [Vol: 2.1×]  [BB SQUEEZE ⚡]

Section 4: Trade Levels (always visible on expand)
  Entry $92,400 → TP $97,800 (+5.8%) / SL $90,100 (-2.5%)  RR: 2.32
  [AI Reasoning quote — italic, zinc-400]
```

Changes:
- Remove the inline `<details>` expand inside expand — it's a UX trap
- 2 sections always open, 2 collapsed = balance of information and density
- Section headers: Section type (text-[10px] font-medium text-zinc-500 uppercase tracking-wide)

### 5e. Signals Tab — Preset Filter Row

**Current:** `['active','sent','won','lost','expired','all']` as text buttons with counts.

**Improvement:** Pill-style tabs with count bubbles, NOT buttons:
```
[● Active  12]  [Sent  3]  [Won  8]  [Lost  14]  [All  47]
```

Active pill: `bg-white text-zinc-900 rounded-full` — high contrast, no color
Inactive pill: `text-zinc-400 hover:text-zinc-200` — just text

This mimics Linear's task status filters. No borders, no backgrounds on inactive.

### 5f. Confidence Distribution Strip

**Current:** `90+: 3 · 85-89: 7 · 80-84: 4 · <80: 1` in plain text.

**Improvement:** Horizontal bar chart in 4 segments:
```
[■■■■■■■■ 90+: 3] [■■■■■■■■■■■■■ 85: 7] [■■■■■■■ 80: 4] [■■ <80: 1]
```
Each segment colored by the confidence tier (emerald/blue/amber/red), proportional width.
Total height: 6px. No labels above, just the colored bars with count tooltips.

---

## 6. Performance Center Improvements

### 6a. Track Record Tab

**Current:** Three `glass-card` boxes with lists of metrics, each with identical visual weight.

**Problem:** WR, Expectancy, and PF are what matters. They're listed in the same style as "Total Resolved" and "Wins".

**Improvement — Hero metrics + secondary details:**

For each window (7d / 30d / 90d):
```
Card:
  [7 Days]
  ━━━━━━━━━━━━━━━━━━━━━━━━
  WR        Expectancy    PF
  42.1%     +0.62R        2.8
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Resolved: 38   Wins: 16   Losses: 22
```

Hero numbers: `Display` type (text-2xl font-semibold font-mono)
Secondary: `Caption` type (text-[10px] text-zinc-600)
The break line between hero and secondary is a visual divider, not whitespace.

Color rules:
- WR ≥ 50%: emerald-400
- WR ≥ 40%: amber-400  
- WR < 40%: red-400
- Expectancy > 0: emerald-400, else red-400
- PF > 1.5: emerald-400, else amber-400

### 6b. Edge Tab — Reduce Table Fatigue

**Current:** Multiple `DimTable` components (By Regime, By State, By Grade, By McapTier, By Timeframe) all look identical. Reading them requires re-reading headers.

**Improvement:**
1. **Default to top-3 rows only**, with "Show all" expander. Most tables have 6–12 rows but 3 rows tell the story.
2. **Add a WR sparkbar** beside each row — a 40px horizontal bar showing win rate proportionally. No numbers needed — the shape communicates faster.
3. **Sort by Expectancy** not alphabetically. The best-performing cohorts should be first.
4. **Merge the section header into the table** — remove the `text-[9px] uppercase tracking-wider` label above each table and use a proper `<caption>` with CardTitle styling.

### 6c. Attribution Tab — Grade Validation

**Current:** `GradeValidationTable` shows A+ through D with WR, Exp, PF, n. Works well but small.

**Improvement:**
- Increase row height slightly (py-2.5 → py-3)
- Add a thin left-border accent in grade color (4px) — gives immediate visual scan of grade hierarchy
- Move monotonicity check badge to be more prominent — this is the key signal

---

## 7. System Center Improvements

### 7a. Health Tab — Operations Card

**Current:** Operations card changes border/bg when critical/warning. But the controls (Scan Now, Stop Scanner, AI toggle, Telegram toggle, Emergency Stop) are all the same small text-xs buttons in a flex-wrap row.

**Problem:** Emergency Stop has the same visual weight as "Scan Now". Critical action indistinguishable from routine action.

**Improved control hierarchy:**

**Tier 1 — Status (always visible, read-only):**
```
[● Running · Last scan 3m ago · Next: 12m]    [● Telegram ON]    [● AI ON]
```
These are status chips, not buttons. They inform.

**Tier 2 — Routine actions (one row):**
```
[Scan Now]    [Stop Scanner / Start Scanner]
```
Standard button weight.

**Tier 3 — Dangerous actions (separated by visual gap):**
```
────────────────────────────────────────
[Emergency Stop]    [Maintenance Mode]
```
Emergency Stop: `bg-red-500/10 border-red-500/30 text-red-400` — reserved zone, visually isolated.

This matches the Stripe dashboard pattern where destructive actions are spatially separated.

### 7b. Health Tab — Service Grid

**Current:** 8 `ServiceCard` boxes in a grid. Each has a dot, name, status text, detail line.

**Improvement — compact status row for healthy services:**
```
When all healthy:
[● Supabase DB]  [● Redis]  [● Binance]  [● CMC]  [● Telegram]  [● CloudAMQP]  [● Celery]
All text-zinc-400, dots bg-emerald-400, minimal padding
```

Only expand a card to full size when status is DEGRADED or DOWN. Healthy infrastructure should be invisible — it's working, you don't need to look at it.

When a service is degraded:
```
┌─────────────────────────────────────────────┐
│ ● Binance   DEGRADED                        │
│   451 geo-block detected · 23 errors today  │
└─────────────────────────────────────────────┘
```

### 7c. Anomalies Tab

**Current:** 4 count tiles (Critical/Warning/Info/Muted) then a flat list of anomalies with action buttons.

**Improvement:**

Count tiles — reduce font size of the `text-3xl` count to `text-2xl`. The current `text-3xl font-mono font-bold` for "0 Critical" feels like a warning siren even when it's zero.

When zero anomalies:
```
[✓ No anomalies · System operating within normal parameters]
```
Single calm line, no tiles, no prominent card. Nothing to look at = nothing to worry about.

Anomaly rows — improve description hierarchy:
```
Current:  type chip   state badge   full description text   metadata   actions
Improved: [● Critical]  win_rate_degradation   7D WR: 20% (30D: 44%)   3h ago   [•••]
```
The description should be the headline. Type and metadata are secondary. Action dots on hover.

### 7d. Settings Tab — Feature Flags

**Current:** `FeatureFlagCard` with amber borders for P0 items. Works. The SIGNAL.QUALITY.AUDIT.3 changes are excellent.

**Improvement — minor:**
- The `FeatureFlagCard` description text is `text-xs leading-relaxed`. At this size, the description reads like fine print. Users skip it.
- Change: show description only on hover/focus (tooltip or expand). Default state is just label + status + toggle.
- This reduces visual noise by ~60% on the flags panel.

---

## 8. Navigation Improvements

### 8a. Sidebar

**Current:**
- Width: 228px
- Active state: `bg-bull-default/10` + left accent line + pulse dot
- Sub text: `text-[10px] uppercase tracking-[0.18em]`

**Issues:**
- The sub text (`Overview · Signals · Regime`) in `tracking-[0.18em]` uppercase is illegible at 10px
- The pulse dot (`animate-pulse-slow`) on the active item creates constant movement — low-level distraction
- 228px feels slightly wide for 3 items

**Improvements:**
```
Width: 220px (save 8px)

Sub text: text-[10px] text-zinc-600 normal-case tracking-normal
  → "Overview · Signals · Regime" (no uppercase, no wide tracking)

Remove pulse dot on active state
  → The solid left border accent is enough

Active state: bg-zinc-800/60 (softer than bull-default/10)
  → Save bull-default for the left accent only

Footer: remove the ping animation on the live indicator
  → Single static dot bg-emerald-400 is enough
```

### 8b. Page Tab Navigation

**Current:** `text-xs font-mono uppercase tracking-wider border-b-2`

Monospace + uppercase on tab labels is a terminal aesthetic that fights the "Linear/Stripe" target.

**Improved:**
```
Active:   text-sm font-medium text-white border-b-2 border-white
Inactive: text-sm text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent
```

Wider tabs, normal font, clear active state. Same `border-b-2 border-white` pattern used by Linear and Stripe.

### 8c. Top Status Bar (if present)

If a global status bar shows system health at the top, it should:
- Show only when there are issues (hide when everything is OK)
- Height: 32px maximum
- Single line: `⚠ 1 anomaly · Telegram OFF`

---

## 9. Component Improvements

### 9a. Buttons

**Current state:** 6+ different button patterns across the 3 pages.

**Unified button system:**
```
Primary:     bg-white text-zinc-900 hover:bg-zinc-100                            — Scan Now CTA
Secondary:   bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700  — Standard action
Danger:      bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15  — Destructive
Success:     bg-emerald-500/10 border border-emerald-500/30 text-emerald-400     — Positive action
Ghost:       text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50              — Low emphasis

All buttons:
  px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
  (remove font-mono, font-semibold from buttons — labels are not code)
```

### 9b. Badges / Chips

**Unified badge system:**
```
Status chip (lifecycle, service status):
  text-[10px] font-medium px-2 py-0.5 rounded-full border
  (rounded-full not rounded — pills are more modern)

Grade badge:
  text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border
  (mono justified — it's a code-like classification)

Metric chip (confidence, probability):
  text-xs font-mono font-semibold (no border, no background — the number is enough)
```

### 9c. Cards

**Unified card anatomy:**
```
Standard card:
  bg-zinc-900 border border-zinc-800 rounded-xl

Card header:
  px-5 pt-4 pb-3 flex items-center justify-between
  Title: text-sm font-medium text-white
  Action/badge: right-aligned

Card body:
  px-5 pb-4
  
Elevated card (within a card):
  bg-zinc-800/50 rounded-lg px-3 py-2.5

Remove glass-card (blur effect):
  .glass-card has backdrop-filter: blur(16px)
  At zinc-950 background, the blur is invisible — it's just adding GPU cost
  Replace with solid bg-zinc-900 + border-zinc-800
```

### 9d. Tables

**Current:** Multiple table patterns. Headers inconsistent. Hover states vary.

**Unified:**
```
th: text-[10px] font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 text-left
td: text-xs py-2.5 px-3 text-zinc-300
tr: border-b border-zinc-800 last:border-0 hover:bg-zinc-800/40

Numeric cells (WR, Exp, PF): font-mono
Text cells (regime, mode name): text-zinc-300
```

### 9e. Toggle (Booleans)

**Current toggle:**
```
value ON:  bg-emerald-500, thumb bg-white
value OFF: bg-zinc-600, thumb bg-zinc-300
```

This is good. One change: when the setting is a **dangerous/irreversible flag** (emergency_stop, maintenance_mode), the ON color should be `bg-red-500` not `bg-emerald-500`. Currently emergency_stop ON shows green — that's backwards.

### 9f. Input Fields

**Current:** `bg-terminal-bg border-terminal-border rounded px-2 py-1 font-mono text-xs`

**Improved:**
```
bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200
focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600
placeholder-zinc-600
```
Slightly more generous padding. `rounded-lg` instead of `rounded`.

---

## 10. Mobile + Responsive Improvements

### Identified Breakpoint Issues

**Signals page — collapsed signal card:**
The card row becomes too compressed below 640px:
```
[BTC] [BUY] [futures] [ACTIVE] [87%] [B] [chevron] ← 8 items in one row on mobile
```
Below 640px, hide `[futures]` and `[B]` (accessible in expanded view).

**Performance page — Track Record 3-column grid:**
`grid-cols-1 sm:grid-cols-3` — fine. But the hero numbers (`text-2xl` in proposed scale) need min-width or they wrap oddly on 360px screens. Add `min-w-[90px]` to each metric column.

**System page — Anomaly count tiles:**
`grid grid-cols-2 sm:grid-cols-4` — fine. But `text-3xl` count wraps awkwardly. Proposed: `text-2xl` fixes this.

**System page — FeatureFlagCard description overflow:**
Long descriptions wrap to 4+ lines on mobile. With the proposed hide-on-expand approach this is resolved.

**General — overflow-x-auto tables:**
All tables have `overflow-x-auto` and `min-w-[320px]`. This works but creates awkward horizontal scrolling on phone. Acceptable for admin panel.

**Sidebar on mobile:**
The sidebar is `sticky top-0 h-screen` at 220px. On mobile this would require a collapse mechanism. **Out of scope for this modernization** — the admin panel is operator-facing and primarily desktop use.

### Responsive Rules to Add

```css
/* Ensure no text below 10px on mobile */
@media (max-width: 640px) {
  .text-\[9px\] { font-size: 10px; }
}
```

---

## 11. Accessibility Improvements

### Contrast Audit

Failing ratios (WCAG AA requires 4.5:1 for text < 18px):
```
text-zinc-600 on bg-zinc-900:  ~2.5:1  ← FAILS — used for timestamps, captions
text-zinc-500 on bg-zinc-900:  ~3.5:1  ← BORDERLINE — used heavily for labels
text-zinc-400 on bg-zinc-900:  ~4.5:1  ← PASSES
```

**Fix:** Upgrade caption/timestamp text from `text-zinc-600` to `text-zinc-500`. Upgrade muted labels from `text-zinc-500` to `text-zinc-400`. Minor visual change, meaningful for accessibility.

Exception: metadata rows in signal cards (`detected_at`, table footers) can stay `text-zinc-600` since they are supplementary information, not primary content.

### Focus States

**Current:** No visible focus rings on most interactive elements. Tab navigation is broken.

**Fix:** Add to all interactive elements:
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950
```

This single class addition covers keyboard navigation across all buttons, inputs, and tabs.

### Click Targets

Anomaly action buttons are `p-1.5` = approximately 24×24px. Minimum is 44×44px per WCAG 2.5.5.

**Fix:** Change anomaly action buttons from `p-1.5` to `p-2.5` and add `min-w-[36px] min-h-[36px]`. This is a compromise (36px, not 44px) appropriate for a dense admin panel.

---

## 12. P0 UI Fixes (Ship This Week)

These are regressions or clarity issues. Ship immediately, low risk.

| # | Fix | File | Impact |
|---|-----|------|--------|
| P0-1 | Emergency Stop toggle color: when ON, use `bg-red-500` not `bg-emerald-500`. Currently shows green when dangerous active state. | system/page.tsx (Toggle component) | Prevents dangerous misreading |
| P0-2 | Scan button when `scanDone=true` uses `bg-emerald-500/15 border-emerald-500/30 text-emerald-400`. The word "Queued ✓" in green reads as "scan completed successfully". Change copy to "Queued — background" and change color to `text-blue-400 border-blue-500/30 bg-blue-500/10` (informational, not success). | signals/page.tsx | Reduces user confusion |
| P0-3 | Sidebar subtitle text is `uppercase tracking-[0.18em] text-[10px]`. At 10px with extreme tracking it's illegible. Change to `text-[10px] text-zinc-500 normal-case tracking-normal`. | sidebar.tsx | Legibility |
| P0-4 | SystemStatusBanner: when OK, `text-emerald-300` with green border draws eye even when system is fine. Change to neutral: `border-zinc-800 text-zinc-500 bg-transparent`. Green should mean "something improved", not "normal operation". | signals/page.tsx | Reduces false urgency |
| P0-5 | Focus rings missing on all buttons across all 3 pages. Add `focus-visible:ring-2 focus-visible:ring-zinc-400` to button base classes. | All pages | Accessibility / keyboard nav |

---

## 13. P1 Enhancements (This Sprint)

Meaningful improvements, moderate effort, zero logic risk.

| # | Enhancement | File | Effort | Impact |
|---|-------------|------|--------|--------|
| P1-1 | **Type scale normalization**: Replace all `text-[9px]`, `text-[11px]` with the 7-step scale. Remove `uppercase` from non-section labels. | All pages | M | High — readability |
| P1-2 | **Lifecycle badge consolidation**: Reduce 10 lifecycle colors to 4 semantic groups (active=blue, won=emerald, lost=red, closed=zinc). | signals/page.tsx | S | High — visual noise reduction |
| P1-3 | **Signal card layout**: BUY/SELL as larger text, Entry/TP/SL as primary row, remove ConfBar (redundant with number). | signals/page.tsx | M | High — scan speed |
| P1-4 | **Service grid compact mode**: When all services healthy, show as a single compact row. Expand only degraded services. | system/page.tsx | S | High — reduces noise |
| P1-5 | **Track Record hero numbers**: WR/Exp/PF at Display size, wins/losses at Caption. Clear visual priority. | performance/page.tsx | S | High — storytelling |
| P1-6 | **Mode chip decolorize**: All scan mode chips same style (`bg-zinc-800 text-zinc-400`), active mode inverts to white. Remove per-mode color. | signals/page.tsx | S | Medium — reduce rainbow |
| P1-7 | **Remove glass-card blur**: Replace `.glass-card` class with `bg-zinc-900 border border-zinc-800 rounded-xl`. Removes GPU cost and invisible effect. | globals.css + all pages | M | Medium — perf + consistency |
| P1-8 | **Tab label typography**: Remove `font-mono uppercase tracking-wider` from tab labels. Use `text-sm font-medium` with `border-b-2`. | All pages | S | Medium — less terminal feel |
| P1-9 | **Preset filter pills**: Change signal filter from bordered buttons to pill tabs with count bubbles. | signals/page.tsx | S | Medium — scan speed |
| P1-10 | **Operations card tier separation**: Visual gap between routine controls and Emergency Stop/Maintenance Mode. | system/page.tsx | S | High — safety |

---

## 14. P2 Polish (Next Sprint)

Nice-to-have. Higher risk or effort. No logic changes.

| # | Enhancement | Effort | Risk |
|---|-------------|--------|------|
| P2-1 | **Intelligence Panel sections**: Group into 4 collapsible sections (Quality / Intelligence / Technical / Trade Levels). Two open by default. | H | Low |
| P2-2 | **DimTable show top-3 + expand**: Default all Performance dimension tables to 3 rows with "Show all N rows" button. | M | Low |
| P2-3 | **Confidence distribution bar chart**: Replace text strip `90+: 3 · 85: 7` with proportional colored bar segments. | S | Low |
| P2-4 | **Anomaly count tiles — calm zero state**: When zero anomalies, replace 4 tiles with single calm confirmation line. | S | Low |
| P2-5 | **Feature flag description on hover only**: Move description to tooltip/expand, default to label + status + toggle only. | M | Low |
| P2-6 | **WR sparkbar in DimTable**: Add a 40px inline bar beside each WR value in dimension tables. | M | Low |
| P2-7 | **Sidebar sub-text**: Change from `Overview · Signals · Regime` (uppercase, tracked) to clean lowercase. | S | None |
| P2-8 | **Remove pulse dot from active nav item**: Static left border accent is sufficient. Remove `animate-pulse-slow` dot. | S | None |
| P2-9 | **Card header unification**: Audit every card header — standardize to `px-5 pt-4 pb-3 + CardTitle + optional right-side badge`. | H | Low |
| P2-10 | **Unified focus ring system**: Add `focus-visible:ring-2 focus-visible:ring-zinc-400` to all interactive elements via a base class in globals.css. | M | None |

---

## 15. Before / After Vision

### Signal Card — Before
```
[BTC] [BUY chip sky-400] [futures chip purple-400] [1h] [TELEGRAM_SENT chip blue-400]
[87] ConfBar [B emerald chip] [↑ aligned emerald] [⏱ 4h left amber]
[Entry $92,400  TP $97,800 +5.8%  SL $90,100 -2.5%]
```
8 visual elements in row 1, each with its own color. Entry/TP/SL in the same font weight as the metadata above it.

### Signal Card — After
```
BTC    BUY        futures       ACTIVE
       emerald    zinc chip     blue pill
─────────────────────────────────────────
Entry $92,400  →  TP $97,800 (+5.8%)  /  SL $90,100 (−2.5%)  · RR 2.3  · 87%  B
```
BUY/SELL is the biggest thing. Price levels are the second thing. Everything else is tertiary.

---

### Anomalies Panel — Before
```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ CRITICAL │ │ WARNING  │ │  INFO    │ │  MUTED   │
│    3     │ │    5     │ │    0     │ │    2     │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
[Large count tiles always visible, even when 0 critical]
```

### Anomalies Panel — After (when clean)
```
✓ No anomalies — system operating within normal parameters
```

### Anomalies Panel — After (when issues)
```
┌──────────────────────────────────────────────────────────────────┐
│ ● win_rate_degradation     7D WR 20% vs 30D WR 44% (−24pp)  3h  │
│   Review feature flags → Apply P0 recommendations                │
│                                              [Ack] [Mute] [···]  │
├──────────────────────────────────────────────────────────────────┤
│ ● expectancy_negative      −0.31R over 7D (n=38)            2h  │
```

---

### Performance Track Record — Before
```
┌─────────────────────────────────┐
│ 7 DAYS                          │
│ Win Rate      42.1%             │
│ Expectancy    +0.62R            │
│ Profit Factor 2.8               │
│ Wins          16                │
│ Losses        22                │
│ Total         38                │
└─────────────────────────────────┘
```
Six metrics, equal weight.

### Performance Track Record — After
```
┌─────────────────────────────────┐
│ 7 Days                          │
│                                 │
│  42.1%    +0.62R    2.8×       │
│  WR       Exp       PF          │
│                                 │
│  16 W · 22 L · 38 resolved     │
└─────────────────────────────────┘
```
Three hero numbers. Everything else footnote-weight.

---

## 16. GO / NO-GO

### GO ✓

**Rationale:**
- Every change is Tailwind class modification
- Zero logic changes, zero API changes, zero component moves
- P0 fixes (5 items) can ship in < 2 hours
- P1 enhancements are mechanical substitutions
- P2 is optional — skip without impact on P0/P1
- TypeScript will still pass (class changes don't affect types)
- Railway/Vercel deploys unchanged (CSS-only for most items)

**Risk mitigation:**
- The only meaningful risk is the glass-card blur removal (P1-7) which could look different on some screens. Test on one page first.
- Everything else is reversible in < 5 minutes.

### Prerequisite

Before implementation: run `npx tsc --noEmit` baseline. After each phase, verify zero new errors.

### Implementation Order

```
Week 1:
  P0-1 through P0-5  — 2 hours total
  P1-1 (type scale)  — 2 hours  ← biggest readability win
  P1-2 (lifecycle badges) — 1 hour
  P1-8 (tab labels)  — 30 min

Week 2:
  P1-3 (signal card layout) — 3 hours (most delicate)
  P1-4 (service grid compact) — 1 hour
  P1-5 (track record hero) — 1 hour
  P1-6 (mode chips) — 30 min
  P1-10 (ops card separation) — 30 min

Week 3:
  P2 items — pick by preference
```

**Estimated total: 15–20 hours of frontend work for P0 + P1.**

---

*UI.UX.MODERNIZATION.1 — Ready for implementation*
