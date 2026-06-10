# TRADING.CENTER.REVIEW.1
# Trading Operations — Operator Command Center Audit

**Date:** 2026-06-10  
**Auditors:** Principal Product Architect · Institutional Trading Platform Designer · Trading Desk Operator · UX Architect · Staff Frontend Engineer  
**Subject:** `/admin/trading` — 5-tab Trading Operations center  
**Scope:** Operational clarity, signal quality visibility, founder decision speed. Not signal generation features.

---

## Audit Methodology

Reviewed `app/admin/trading/page.tsx` (808 lines) in full.  
Standard: **operator must understand system state in under 10 seconds**.  
Test: Can I answer these 5 questions without clicking anything?

1. Is the scanner healthy?
2. Are signals performing?
3. Is market favorable?
4. Are providers healthy?
5. Are active positions healthy?

**Current score on the 5-question test: 2/5.** Scanner (1) and Regime (3) are visible. Performance (2), providers (4), and position health (5) require reading small text and doing mental math.

---

## Section 1 — Overview Tab Review

### Current State

```
Hero row (3:2):  [Scanner Card] [Regime Card]
Strip:           Providers: CMC · Binance · CoinGecko  Cache: 4/4 fresh  CMC 1%
Tiles (2×2):     Signals Today | Active Signals | Win Rate 7D | Expectancy 7D
Recent Signals:  6 rows — Symbol · Type · Stage · Confidence · RR · Time
```

### What Works
- 3:2 scanner/regime hero split is the right layout and priority order.
- Regime card border color coding (green/red/amber) gives instant regime context.
- Lifecycle chips on the scanner card (Active · Sent · TP · SL) are fast to scan.
- Pause/Resume button placement in the scanner card is correct.

### Critical Gaps

**Gap 1 — No signal quality scorecard.**  
Win Rate and Expectancy alone are insufficient for trading decisions. Missing: Profit Factor, Avg RR Achieved, Grade A % of total. A 45% win rate at 1.5 RR is very different from 45% win rate at 2.8 RR. The operator cannot assess system quality from the current 2-tile view.

**Gap 2 — Provider strip is unreadable.**  
Tiny text pills ("Providers: Binance · CMC · CoinGecko · Claude") at the bottom of the screen in 10px font. This is the most important infrastructure health signal in the system. An unhealthy provider blocks signals. It belongs above the fold, not below the metric tiles.

**Gap 3 — Active Signals is a raw count with no urgency context.**  
"Active Signals: 12" tells you nothing. Are any approaching SL? How many are in profit? The number alone creates false confidence. A trader with 12 active signals and 10 near stop-loss needs different action than one with 12 active signals all in profit.

**Gap 4 — Recent Signals lacks quality at a glance.**  
Each row shows Symbol · Type · Stage · Confidence · RR · Time. Missing: Risk Grade (A/B/C — the highest-predictor of outcome), Regime alignment (is this signal against the current BTC regime?). The operator cannot identify the 2 best signals in the list without clicking into each.

**Gap 5 — No system health summary.**  
There is no single "all systems operational" or "2 warnings" status indicator. The operator must mentally aggregate: scanner running + regime known + providers healthy + no emergency stop. This should be one status line.

**Gap 6 — Vanity metric: Signals Today.**  
"Signals Today: 8" tells the operator nothing actionable. 8 signals in a BEAR regime with 32% win rate is bad. 8 signals in a BULL regime with 67% win rate is excellent. The raw count without quality context is noise.

### Recommended Design: Overview v2

```
┌──────────────────────────────────────────────────────────────────────────┐
│ SYSTEM STATUS  ●●●● All Operational  |  Regime: BEAR TREND  |  2h 14m   │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐  ┌───────────────────────────────┐
│  ● Auto-scan Active          [Pause] │  │  BEAR TREND            -2.3%  │
│                                      │  │  BTC 4h bearish · RSI 38.4    │
│  Last Scan: 4m ago                   │  │  Tighten stops — strong       │
│  Next Scan: 8m 32s (standard)        │  │  downtrend increases risk      │
│  ● ACTIVE 3  ● Sent 1  ✓ TP 2  ✗ 1  │  │                               │
└──────────────────────────────────────┘  └───────────────────────────────┘

┌─────────────────  SIGNAL QUALITY SCORECARD  (7d · 47 resolved)  ────────┐
│  Win Rate       Expectancy    Profit Factor   Avg RR Hit    Grade A %   │
│  48.9%          +0.52R        1.8             2.14:1        61%         │
│  ●green         ●green        ●amber          ●green        ●green      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────  PROVIDERS  ─────────────────────────────────────────────────────┐
│  ● Binance 142ms   ● CMC 890ms  1% quota   ○ CoinGecko STBY          │
│  ● Claude 1.2s     ● Telegram ✓ 47m ago    ● Redis 4ms  ● Supabase   │
└───────────────────────────────────────────────────────────────────────┘

Recent Signals  (sorted by confidence desc)
┌──────────────────────────────────────────────────────────────────────┐
│  ETHUSDT   BUY  [A] [ACTIVE]  [futures]  92%  ████████░░  2.8:1      │
│  SOLUSDT   BUY  [B] [SENT]   [spot]      87%  ███████░░░  2.3:1      │
│  BTCUSDT   SELL [A] [ACTIVE]  [h_conf]   91%  ████████░░  3.1:1      │
└──────────────────────────────────────────────────────────────────────┘
```

### Signal Quality Scorecard — Data Sources

| Metric | Source | Notes |
|--------|--------|-------|
| Win Rate | `/api/signals/counts` → `win_rate_7d` | Already fetched |
| Expectancy | `/api/signals/counts` → `expectancy_7d` | Already fetched |
| Profit Factor | `/api/analytics` → `profit_factor` | Need to add to counts endpoint or fetch separately |
| Avg RR Hit | `signal_outcomes` avg `rr_achieved` where TP_HIT | Add to counts endpoint |
| Grade A % | `/api/signals/tactical` distribution | Compute client-side from recent signals |

### Widgets Removed from Overview
- **"Signals Today" raw count** → replace with Signal Quality Scorecard
- **Inline provider pills** (tiny text strip) → replace with Provider Health row (6 providers, status + latency)

### Widgets Added to Overview
- **System Status Banner** (1 line at top — green/amber/red, lists any issues)
- **Signal Quality Scorecard** (Win Rate + Expectancy + Profit Factor + Avg RR + Grade A%)
- **Provider Health row** (6 providers: Binance, CMC, Claude, Telegram, Redis, Supabase — status + latency)
- **Confidence bar** on recent signal rows
- **Risk Grade badge** on recent signal rows

---

## Section 2 — Scanner Tab Review

### Current State

```
[Emergency Stop banner — shown when active]
Operational Switches:
  Emergency Stop  [Activate]
  Maintenance Mode  [Activate]
  Scanner (Celery)  [Disable]
  Claude AI  [Disable]
  Telegram  [Enable]
Scheduler Status card: Last scan, Next scan countdown
Manual Scan: Mode selector + Scan Now button
Gate Rejections: 24h bar chart
```

### What Works
- Emergency Stop banner when active is excellent — red, prominent, can't miss it.
- 5 toggle controls are correct and complete.
- Gate rejection bar chart is genuinely useful operational data.
- Countdown timer in scheduler status is good.

### Critical Gaps

**Gap 1 — Controls not separated by criticality.**  
Emergency Stop and Scanner are the same visual weight as Claude AI. Emergency Stop can halt all trading activity. Claude AI just switches to heuristic. These should not look the same. An operator under pressure will hesitate or make the wrong call.

```
CURRENT:  [Emergency Stop] [Maintenance] [Scanner] [Claude AI] [Telegram]
           ← CATASTROPHIC         OPERATIONAL                    COMMS →
```
All five sit in the same visual section with the same card style. This is wrong.

**Gap 2 — Missing operational metrics in Scanner tab.**  
The operator cannot see scan duration (is the scanner slowing down?), worker health (is Celery alive?), or queue depth (are tasks stacking up?). These are the three signals that predict a scanner failure before it happens.

**Gap 3 — No last change audit.**  
Emergency Stop was turned on 2 hours ago. Who did it? When? No record visible. For a founder operating solo this matters — was it intentional or a bug? A simple "Last changed: Emergency Stop OFF → ON — 2h ago" prevents confusion.

**Gap 4 — Manual scan is visually buried.**  
Scan Now is at the bottom of the page below all 5 toggles and the scheduler card. In operational urgency this should be 1 click, not a scroll.

**Gap 5 — "Operational Switches" label is generic.**  
The section header does not communicate the risk hierarchy. "CRITICAL CONTROLS" and "NORMAL CONTROLS" would immediately guide the operator's eye.

### Recommended Design: Scanner Operations Center v2

```
┌──── CRITICAL CONTROLS ────────────────────────────────────────────────┐
│  ⛔ EMERGENCY STOP      Halts ALL output. Overrides everything.  [OFF]│
│  🔧 MAINTENANCE MODE    Blocks scans + Telegram. API reads OK.  [OFF] │
└───────────────────────────────────────────────────────────────────────┘

┌──── SCHEDULER STATUS ─────────────────────────────────────────────────┐
│  ● Active   Last: 4m ago   Next: 8m 32s (standard)   Duration: 47s   │
│  Worker: ● ALIVE (heartbeat 4m ago)   Queue: CLEAR                    │
└───────────────────────────────────────────────────────────────────────┘

┌──── NORMAL CONTROLS ──────────────────────────────────────────────────┐
│  ⚡ Scanner (Celery)   15-min auto-scan cycle           [ENABLED]     │
│  🤖 Claude AI          Heuristic fallback when OFF      [ENABLED]     │
│  📨 Telegram Alerts    Master send switch               [ENABLED]     │
└───────────────────────────────────────────────────────────────────────┘

┌──── MANUAL SCAN ──────────────────────────────────────────────────────┐
│  [spot] [futures] [high_conf] [trending]          [▶ Scan Now]        │
└───────────────────────────────────────────────────────────────────────┘

┌──── LAST CHANGE AUDIT ────────────────────────────────────────────────┐
│  Telegram OFF → ON      2m ago                                        │
│  Scanner PAUSED         1h 12m ago                                    │
│  Regime Settings Applied 3h 44m ago → aggressive                     │
└───────────────────────────────────────────────────────────────────────┘

Gate Rejections  [24h chart — keep as-is, good]
```

**Worker Status data source:** `celery:worker:last_heartbeat` Redis key age — already read in `/health/ready`. Expose it in the scheduler status response.

**Queue Health data source:** Add queue depth to `/api/admin/scheduler/status` response from Celery inspect.

**Last Change Audit data source:** `settings_group_audit` table — already written on every `patch_group()` call. Add a `/api/admin/audit?limit=5` endpoint.

---

## Section 3 — Signals Tab Review

### Current State

```
Filters: [All] [BUY] [SELL] | [All Modes] [spot] [futures] [high_conf] [trending]

Rows (flat, no expand):
  ETHUSDT  BUY  [ACTIVE]  [futures]  92%  2.8:1  4m ago
  SOLUSDT  BUY  [SENT]    [spot]     87%  2.3:1  12m ago
  ...
```

### What Works
- Filter bar is clean and functional.
- Mode color coding (sky/purple/emerald/amber) is good.
- Stage chips with color are scannable.

### Critical Gaps

**Gap 1 — No expandable row.**  
The old `/admin/signals` page had an expandable Intelligence section showing TrendScore, Sector, Breakout, OI, Funding, Positioning. **This was not migrated to the new SignalsTab in TradingOperations.** The operator has zero intelligence visibility in the consolidated page. This is a regression from the old design.

**Gap 2 — Confidence is a raw number, not visual.**  
"92%" and "88%" look the same in a list of 15 rows. A confidence bar makes quality hierarchy scannable in 2 seconds.

**Gap 3 — Risk Grade is absent.**  
Grade is the highest WR predictor in the system (Grade A BEAR_TREND = 49%, Grade C futures = 75%). It is not shown anywhere in the Signals tab. The operator cannot identify the best signals without knowing grade.

**Gap 4 — No regime alignment indicator.**  
A BUY signal in BEAR_TREND is high-risk. A SELL signal in BEAR_TREND is optimal. The tab shows 15 rows of signals with no indication of which ones are regime-aligned. The operator must remember the current regime (shown on Overview) and mentally cross-reference every row.

**Gap 5 — No sorting.**  
Signals are ordered by creation time (newest first). Operator cannot re-sort by confidence, grade, or RR to find the best setup instantly.

**Gap 6 — No entry/target/stop in the row.**  
For active signals, the operator needs entry and TP prices to decide whether to act. Currently hidden — must expand each row.

### Recommended Design: Signal Review Center v2

**List row (compact, always visible):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ETHUSDT  BUY  [A] [ACTIVE]  ████████░░ 92%  [futures]  [★ BEAR aligned] │
│          $3,421 → $3,847 · SL $3,180        2.8:1      4m ago           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Expanded row (click to expand, no new page):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ INTELLIGENCE                                                             │
│  TrendScore  [ELITE 87]   Sector [ACCELERATING]   Breakout [HIGH MOM]  │
│  OI          [NEW LONGS]  Funding [RISING ↗]       Positioning [SH HVY]│
│                                                                          │
│ AI ANALYSIS                                                              │
│  "Strong institutional accumulation with breakout confirmation…"         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Sort controls (add above filter bar):**
```
Sort by: [Confidence ↓] [Grade] [RR] [Time]
```

**Grade badge design:**
```
A = emerald chip    B = blue chip    C = amber chip    D/F = red chip
```

**Regime alignment indicator:**
```
✓ = signal direction matches regime (SELL in BEAR, BUY in BULL) — green dot
✗ = contra-regime — amber dot + "(contra)" label
— = SIDEWAYS/HIGH_VOLATILITY — neutral
```

This indicator alone makes the entire signal list decision-ready in under 5 seconds.

---

## Section 4 — Tactical Tab Review

### Current State

```
Presets: [All] [Active] [✓ Won] [✗ Lost]

Signal cards with left accent bar, showing:
  Symbol · Type · Stage chip · Mode chip · Time
  Conf · RR · Entry · TP
```

### Duplication Analysis

**TacticalTab vs SignalsTab — overlap matrix:**

| Feature | Signals Tab | Tactical Tab |
|---------|-------------|--------------|
| Signal list | ✅ | ✅ — DUPLICATE |
| Filter by type (BUY/SELL) | ✅ | ❌ missing |
| Filter by mode | ✅ | ❌ missing |
| Filter by lifecycle stage | partial | ✅ (3 presets) |
| Entry/TP prices | ❌ | ✅ |
| Left accent bar | ❌ | ✅ |
| Intelligence expand | ❌ | ❌ both missing |

**Verdict:** Both tabs show the same signal list with minor UI differences. There is no clear conceptual separation. An operator does not understand why both tabs exist.

**Root cause:** Signals tab = discovery + filtering. Tactical tab = position management. This distinction is not communicated in the current design. The tabs need to be differentiated by **purpose**, not just by which presets are shown.

### Recommended Design: Signal Lifecycle Center v2

**Purpose:** Tactical tab is for **position management of sent/active signals only**. Signals tab is for **discovery and intelligence review of all signals**.

**Lifecycle Funnel (new — top of tab):**
```
Generated     Approved     Sent     Active     Resolved
   47     →      38    →    31   →    12    →   Won 18 · Lost 12 · Exp 3
            81%          82%       39%          WR 60%  (last 7d)
```

This funnel shows pipeline health. If the Sent→Active conversion drops, signals are expiring before they can be acted on. If Approved→Sent conversion drops, Telegram is blocked.

**Stage presets (expanded from 4 to 7):**
```
[Generated] [Approved] [Sent] [Active] [Won] [Lost] [Expired/Stale]
```

**Active signals section (primary focus of Tactical tab):**
```
ACTIVE POSITIONS  (12 open)

┌──────────────────────────────────────────────────────────────────────┐
│ ETHUSDT  BUY  [ACTIVE]                                    1h 23m ago │
│ Entry $3,421   TP $3,847 (+12.4%)   SL $3,180 (-7.1%)   RR 2.8:1   │
│ Current: $3,498  +$77 (+2.3%)  ━━━━━━░░░░ 42% to TP                 │
└──────────────────────────────────────────────────────────────────────┘
```

The "% to TP" progress bar is the single most valuable addition. It tells the operator at a glance which positions are closest to resolution.

**Content removed from Tactical tab:**
- VALIDATED, AI_APPROVED, TELEGRAM_SENT signals (these belong in Signals tab pipeline view)
- Mode filter (not relevant to position management)
- Full intelligence panel (too detailed for position management)

**Content unique to Tactical tab vs Signals tab:**
- Lifecycle funnel visualization
- % to TP progress bar
- % drawdown from entry
- Time in trade
- Expanded Won/Lost section showing actual RR achieved vs planned

---

## Section 5 — Regime Tab Review

### Current State

```
Regime hero card:
  BEAR TREND  (large, colored)
  Description: "BTC 4h EMA bearish…"
  Implication: "Tighten stop-losses…"
  RSI 4h | BTC 24h | ATR %

Apply Regime Settings button → applies preset silently
```

### What Works
- Regime description and implication text are excellent — genuinely useful.
- Border color coding is consistent with Overview.
- The 3 BTC metrics (RSI, 24h, ATR) provide the right context.

### Critical Gaps

**Gap 1 — No regime history.**  
The operator sees the current snapshot with no context. Was this BEAR_TREND regime established 6 hours ago or 6 days ago? Regime persistence matters enormously for signal quality. A 6-day bear trend is very different from a 6-hour one.

**Gap 2 — No regime gate effectiveness.**  
The system is blocking signals based on regime. The operator cannot see how many were blocked today. The tab shows zero operational impact data. If the regime gate is blocking 40 BUY signals/day, the operator needs to know — especially if the regime just flipped to BULL.

**Gap 3 — No regime impact on win rate.**  
RISKGRADE.TRUTH.1 data shows BEAR_TREND WR=49%, NULL WR=15%. This is the most important context for trusting the signal quality scorecard. The operator should see "Signals in this regime: WR 49%, Exp +0.52R" next to the regime card.

**Gap 4 — Apply Regime Settings has no confirmation and no preview.**  
Clicking "Apply Regime Settings" immediately changes scanner settings. The operator has no preview of what will change (confidence thresholds, min RR, max coins). This is a one-click production settings change with no guard. For a live system generating Telegram alerts, this is a safety issue.

**Gap 5 — No last applied timestamp.**  
"Regime Settings last applied: 3h ago → aggressive" is nowhere shown. The operator doesn't know if regime settings are in sync with the current regime.

### Recommended Design: Regime Intelligence Center v2

```
┌──── CURRENT REGIME ───────────────────────────────────────────────────┐
│  BEAR TREND                              RSI 38.4  24h -2.3%  ATR 4%  │
│  Active since: ~18h ago                                                │
│  BTC 4h bearish with sustained selling pressure                        │
│  → Tighten stops; strong downtrend increases invalidation risk         │
│                                                                        │
│  Signals in this regime (7d):  WR 49.0%  Exp +0.52R  n=87            │
└───────────────────────────────────────────────────────────────────────┘

┌──── REGIME GATE ──────────────────────────────────────────────────────┐
│  Blocked today:  14 BUY signals (contra-regime)                       │
│  Allowed today:  31 SELL signals (regime-aligned)                     │
│  NULL rejected:   3 (no regime data — hard gate ALPHA.TRUTH.1)        │
└───────────────────────────────────────────────────────────────────────┘

┌──── REGIME HISTORY  (last 7 days) ────────────────────────────────────┐
│  Jun 10  BEAR_TREND     ██████████████████████████░░░░░░░  18h        │
│  Jun 09  SIDEWAYS       ████████░░░░░░░░░░░░░░░░░░░░░░░░   8h        │
│  Jun 09  BEAR_TREND     ████████████████░░░░░░░░░░░░░░░░  16h        │
│  Jun 08  HIGH_VOLATILITY████████░░░░░░░░░░░░░░░░░░░░░░░░   8h        │
│  Jun 08  BEAR_TREND     ████████████████░░░░░░░░░░░░░░░░  16h        │
└───────────────────────────────────────────────────────────────────────┘

┌──── APPLY REGIME SETTINGS ────────────────────────────────────────────┐
│  Current applied profile:  aggressive  (applied 4h ago)               │
│  Recommended for BEAR_TREND:  conservative                            │
│                                                                        │
│  ⚠ Profile mismatch — running aggressive in a BEAR TREND market       │
│                                                                        │
│  [Preview Changes]  →  [Apply conservative]                           │
└───────────────────────────────────────────────────────────────────────┘
```

**Preview Changes modal (before Apply):**
```
┌──── PREVIEW: aggressive → conservative ───────────────────────────────┐
│  min_confidence:     82  →  87    (+5)                                │
│  min_rr_ratio:      2.0  →  2.5   (+0.5)                             │
│  max_signals/scan:   30  →  20    (-10)                               │
│  stop_multiplier:   1.0  →  1.2   (+0.2 — wider stops)               │
│                                                                        │
│  [Cancel]                              [Confirm Apply]                │
└───────────────────────────────────────────────────────────────────────┘
```

**Data sources for new Regime features:**
- "Active since" — compare current regime with previous regime in Redis `btc-regime` change history (or approximate from regime history endpoint)
- "Signals in this regime WR" — `by_market_regime` breakdown already in `/api/analytics` response
- "Blocked today" — `REGIME_REJECTION` counter in gate_rejections from `scan_metrics_log`
- "Regime History" — new lightweight endpoint: query `signals` table `GROUP BY DATE(created_at), market_regime` or cache regime changes in Redis
- "Current applied profile" — read `scanner.preset` from settings

---

## Section 6 — New Information Architecture

### Tab Purpose Redefinition

| Tab | Old Purpose (blurry) | New Purpose (sharp) |
|-----|---------------------|---------------------|
| Overview | Status summary | **System Health Dashboard** — answer all 5 questions in 10s |
| Scanner | Controls + scan history | **Operations Control** — run/stop/audit the scanner |
| Signals | Signal list with filters | **Signal Discovery** — find, rank, and review signals with full intelligence |
| Tactical | Filtered signal list | **Position Management** — manage active positions, track to resolution |
| Regime | Current regime display | **Regime Intelligence** — understand market context, validate gate effectiveness |

### Navigation Mental Model

```
OVERVIEW    →  "Is everything OK?"  (health + performance)
SCANNER     →  "Is the scanner working?"  (ops control)
SIGNALS     →  "What signals do I have?"  (discovery + quality)
TACTICAL    →  "What are my open positions doing?"  (management)
REGIME      →  "What is the market doing?"  (context + settings)
```

Each tab answers exactly one question. Current overlap between Signals and Tactical violates this.

---

## Section 7 — New KPI Layout

### Primary KPIs (always visible — Overview Scorecard)

| KPI | Threshold: Healthy | Warning | Critical |
|-----|-------------------|---------|----------|
| Win Rate 7D | ≥ 48% | 38–47% | < 38% |
| Expectancy 7D | ≥ +0.35R | +0.05 to +0.35R | < +0.05R |
| Profit Factor | ≥ 1.5 | 1.0–1.5 | < 1.0 |
| Avg RR Achieved | ≥ 2.0 | 1.5–2.0 | < 1.5 |
| Grade A % | ≥ 55% | 40–55% | < 40% |

Color coding: green / amber / red. Never show raw numbers without color context.

### Secondary KPIs (visible in tab context)

| Tab | Secondary KPIs |
|-----|---------------|
| Scanner | Accept Rate, Last Duration, Worker Heartbeat Age |
| Signals | Regime alignment % of current list, Intelligence coverage |
| Tactical | Open P&L direction, Avg % to TP of active positions |
| Regime | Gate rejection rate, WR in current regime, Profile sync status |

### Removed KPIs (vanity / low signal)

| Removed | Reason |
|---------|--------|
| Signals Today (raw count) | Means nothing without quality context |
| Cache: 4/4 fresh (Overview strip) | Operational detail, belongs in Intelligence tab |
| CMC 1% used (Overview strip) | Operational detail, belongs in Intelligence tab |

---

## Section 8 — Widgets Removed

| Widget | Location | Reason |
|--------|----------|--------|
| Signals Today raw count | Overview tiles | Replaced by Signal Quality Scorecard |
| Provider pills strip | Overview bottom | Replaced by Provider Health row (full, with latency) |
| Cache freshness strip | Overview bottom | Move to Intelligence tab where it belongs |
| CMC quota % strip | Overview bottom | Move to Intelligence tab |
| "Operational Switches" section header | Scanner | Replace with "CRITICAL CONTROLS" / "NORMAL CONTROLS" sections |
| Tactical: VALIDATED / AI_APPROVED / TELEGRAM_SENT preset | Tactical | These stages belong in Signals tab pipeline, not position management |

---

## Section 9 — Widgets Added

| Widget | Location | Priority |
|--------|----------|----------|
| System Status Banner (1-line health summary) | Overview top | P0 |
| Signal Quality Scorecard (5 KPIs) | Overview | P0 |
| Provider Health row (6 providers, latency) | Overview | P0 |
| Confidence bar on signal rows | Signals + Overview recent | P0 |
| Risk Grade badge on signal rows | Signals + Overview recent + Tactical | P0 |
| Regime alignment indicator on signal rows | Signals | P1 |
| Sort controls (confidence/grade/RR/time) | Signals | P1 |
| Intelligence expand panel (MIGRATED from old /admin/signals) | Signals | P0 |
| Lifecycle Funnel (Generated→Approved→Sent→Active→Won/Lost/Exp) | Tactical | P1 |
| % to TP progress bar on active positions | Tactical | P1 |
| Regime Gate effectiveness (blocked today / allowed today) | Regime | P1 |
| Signals in regime WR (n=X, WR Y%, Exp +ZR) | Regime | P1 |
| Regime History timeline (last 7 days) | Regime | P2 |
| Regime profile mismatch warning | Regime | P1 |
| Preview Changes modal before Apply Regime Settings | Regime | P0 |
| Last Change Audit (last 5 ops changes) | Scanner | P1 |
| Worker heartbeat age + queue health | Scanner | P1 |
| Scan duration in Scheduler Status | Scanner | P0 (data exists in monitoring.py) |

---

## Section 10 — Operator Workflow Improvements

### Workflow 1: Morning Check (< 10 seconds)

**Current:** Overview → read 4 tiles → check provider strip → read scanner card → infer system state  
**After:** Overview → read System Status Banner (1 line) → read Scorecard → done

**Time: 30s → 8s**

### Workflow 2: Signal Quality Assessment (< 30 seconds)

**Current:** Go to Signals → scan 15 rows of flat text → mentally note confidence numbers → no grade → click each for intelligence  
**After:** Go to Signals → sorted by confidence → grade visible → confidence bar → regime alignment dot → expand best signal for intelligence

**Time: 60s → 20s**

### Workflow 3: Position Check (< 20 seconds)

**Current:** Go to Tactical → filter to Active → see flat cards with entry/TP → mentally calculate distance to TP  
**After:** Go to Tactical → see Lifecycle Funnel (pipeline health) → see Active cards with % to TP bar → immediate urgency signal

**Time: 45s → 15s**

### Workflow 4: Regime Response

**Current:** Go to Regime → read current regime → go to Settings → manually choose profile → apply  
**After:** Go to Regime → see profile mismatch warning → Preview Changes → Confirm Apply

**Time: 90s + cognitive load → 20s + guardrail**

---

## Section 11 — Founder Dashboard Improvements

The founder (Praveen) uses this as a solo operator. Specific improvements:

**1. Context persistence across tabs.**  
Current regime should be visible in a mini indicator in every tab header — not just Overview and Regime. An operator on the Signals tab needs to know the regime to evaluate signals.

Proposed: Add a persistent 1-line status bar below the tab nav showing: `● BEAR TREND · WR 48.9% · Scanner Active · 12 Active Positions`.

**2. Reduce cognitive load on settings.**  
The "Apply Regime Settings" workflow (current: 1-click blind change) is a founder-specific risk. Add the Preview modal. One production incident from a misapplied conservative preset when you meant aggressive costs more time to diagnose than the 2-click save.

**3. Grade A% in Overview.**  
If Grade A% drops from 60% to 35%, signal generation quality has degraded. This is the leading indicator of win rate problems. Currently invisible. Add to the Scorecard.

**4. Intelligence expand on Signals tab.**  
This was the highest-value feature of the old `/admin/signals` page and was not carried forward to the consolidated tab. Re-adding the Intelligence expand panel is the single highest-ROI code change in this review.

**5. Regime alignment dot on each signal.**  
A founder making 10 decisions per day about which signals to act on manually does not have time to cross-reference regime with each signal mentally. The 1-character dot (✓ / ✗ / —) saves mental overhead on every signal row review.

---

## Section 12 — Final Score

### Scoring Rubric (each /2 points)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Operational clarity | 0.8/2 | Scanner + Regime visible. Provider health buried. Performance not actionable. |
| Signal quality visibility | 0.5/2 | Grade absent. No confidence bar. No regime alignment. Intelligence expand missing (regression). |
| Founder decision speed | 1.0/2 | Overview gives scanner/regime quickly. Quality assessment requires too many clicks. |
| Information hierarchy | 0.7/2 | All elements same visual weight. Critical controls not differentiated. |
| Duplication / clutter | 0.5/2 | Signals and Tactical are near-identical. Scorecard absent. CMC/cache strip clutters Overview. |

**Total: 3.5 / 10**

### After implementing recommended fixes

| Dimension | Projected Score | Key Driver |
|-----------|-----------------|-----------|
| Operational clarity | 1.8/2 | System status banner + provider health row |
| Signal quality visibility | 1.7/2 | Grade badge + confidence bar + intelligence expand |
| Founder decision speed | 1.6/2 | 5-question test passable in 10s |
| Information hierarchy | 1.5/2 | Critical/Normal control separation; scorecard above tiles |
| Duplication / clutter | 1.4/2 | Tactical differentiated; Overview clean |

**Projected Total: 8.0 / 10**

---

## Section 13 — GO / NO-GO

### Architecture: ✅ GO (no changes needed)
The 5-tab consolidation is structurally correct. Tab assignment and routing are solid. No architectural changes recommended.

### P0 Implementation Items (block on these first):

| # | Item | File | Effort |
|---|------|------|--------|
| P0.1 | Re-add intelligence expand panel to SignalsTab | `trading/page.tsx` | Medium |
| P0.2 | Add Grade badge to signal rows (Signals + Tactical + Overview) | `trading/page.tsx` | Small |
| P0.3 | Add confidence bar to signal rows | `trading/page.tsx` | Small |
| P0.4 | Replace Overview tiles with Signal Quality Scorecard | `trading/page.tsx` | Medium |
| P0.5 | Separate Scanner toggles into CRITICAL / NORMAL sections | `trading/page.tsx` | Small |
| P0.6 | Add Preview modal to Apply Regime Settings | `trading/page.tsx` | Small |
| P0.7 | Add scan duration to Scheduler Status card | `trading/page.tsx` | Small |

### P1 Implementation Items (high value, low risk):

| # | Item | File | Effort |
|---|------|------|--------|
| P1.1 | Add regime alignment dot to signal rows | `trading/page.tsx` | Small |
| P1.2 | Add sort controls to Signals tab | `trading/page.tsx` | Small |
| P1.3 | Add Lifecycle Funnel to Tactical tab | `trading/page.tsx` | Medium |
| P1.4 | Add % to TP progress bar to Tactical active cards | `trading/page.tsx` | Small |
| P1.5 | Add Regime Gate effectiveness block to Regime tab | `trading/page.tsx` | Small |
| P1.6 | Add Provider Health row to Overview | `trading/page.tsx` + data | Medium |
| P1.7 | Differentiate Tactical purpose (position mgmt only) | `trading/page.tsx` | Small |

### P2 Items (quality-of-life, non-blocking):

| # | Item | Effort |
|---|------|--------|
| P2.1 | System Status Banner (persistent 1-line below tab nav) | Small |
| P2.2 | Regime History 7-day timeline | Medium |
| P2.3 | Last Change Audit in Scanner tab | Medium (needs audit endpoint) |

### Final Verdict

**GO — with P0 items as implementation prerequisite.**

The current Trading Operations center is a functional admin page. The target is an operator command center. The gap is not architectural — it's execution depth. P0 items can be implemented in a single focused session. The data is already available from existing endpoints. No new backend work is required for P0.1–P0.7 except surfacing scan duration (already in `monitoring.py`).

The highest single ROI change: **re-add the intelligence expand panel** (P0.1). It was the differentiating feature of the consolidated signals experience and its absence is a regression.

---

*TRADING.CENTER.REVIEW.1 — 2026-06-10*  
*Next: Implement P0 items. Validate with 7-day operator usage. Produce TRADING.CENTER.REVIEW.2.*
