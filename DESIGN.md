# DESIGN.md — rules for every UI change in AEGIS BOT SHIELD

These rules apply to both user interfaces in this repository:

| Surface | Code | Tech | Users |
|---|---|---|---|
| **Study site** | `study/aegis_study/templates/`, `study/aegis_study/static/study.css` | Server-rendered Jinja2 + plain CSS, no build step | Research participants (Bangla/English, phone and computer) |
| **Dashboard** | `packages/dashboard/src/` | React 18 + Vite 8 + Tailwind CSS v4 (`@tailwindcss/vite`) | Operators of an AEGIS server |

Read this file before touching either. When a rule here and the existing code disagree, the
rule wins and the code gets fixed. When a rule seems wrong, change this file first, in its own commit.

---

## 0. Audit (2026-10-06): what exists today

| Finding | Where | Consequence for these rules |
|---|---|---|
| **No `tailwind.config.*`.** Tailwind v4 is configured in CSS (`@import "tailwindcss"` + `@theme`) | `packages/dashboard/src/index.css` | Tokens go into `@theme` / `:root` in CSS, not into a JS config |
| **No `globals.css`.** The global stylesheet is `index.css` (dashboard) and `study.css` (study site) | — | These two files are the "globals". Do not add a third |
| **Tailwind is installed but unused:** 0 `className` uses; the 7 `--color-aegis-*` tokens in `@theme` are referenced nowhere | `packages/dashboard/src/**` | Dead tokens get deleted. New dashboard code uses Tailwind utilities on the tokens below, not inline `style={{}}` |
| **Styling is inline objects from a JS theme** (`Theme`, `cardStyle()`) | `packages/dashboard/src/theme.ts` | Migrate to CSS variables (§3), so the study site and the dashboard share one palette |
| **No shadcn/ui** (no `components.json`, no `@/components/ui`, no Radix packages) | — | §6 lists the primitives to add and their import paths, marked *not installed* |
| **Banned fonts in use.** Roboto in the dashboard stack; `system-ui` first in the study site; no font is actually loaded anywhere | `index.css`, `study.css` | §2 |
| Three colour identities: dashboard blue `#2a78d6`, study green `#0b6e4f`, task bar navy `#10243e` | `theme.ts`, `study.css` | Replaced by one dominant + one accent (§3) |
| **Forbidden pattern in use:** a row of 5 rounded `StatsCard`s | `pages/Overview.tsx` (also `pages/MLPerformance.tsx`) | §8, §6 |
| **Forbidden pattern in use:** the shop is a grid of rounded product cards | `templates/_product_card.html`, `.grid` in `study.css` | §8 |
| `ThreatBadge.tsx` is imported nowhere and uses its own off-palette colours (`#ff4d4f`, `#1890ff` …) | `components/ThreatBadge.tsx` | Delete it, or rebuild it on `VerdictBadge` |
| `layouts/DashboardLayout.tsx` is only a re-export shim | `layouts/` | Import from `components/DashboardLayout` |
| Emoji as navigation icons (📊 🛡️ 🧠) | `components/Sidebar.tsx` | Use `lucide-react` (already a dependency) |
| **Good, keep:** status never shown by colour alone (`VerdictBadge`, `LiveIndicator` pair colour with text and icon); a deliberate dark theme | `components/` | §9 |

---

## 1. Character

**"Field notebook of a security lab."** Calm, exact, a little editorial:
- big confident type;
- hairline rules instead of boxes;
- left-aligned, asymmetric layouts;
- numbers set in mono.

One cool dominant colour carries the identity; one bright accent marks the single thing to look at
or act on. Nothing decorative competes with the task, and participants should never wonder where to click.

---

## 2. Fonts

| Role | Font | Weights used | Scripts | Package (self-hosted) |
|---|---|---|---|---|
| **Display** | **Anek Bangla** (variable: weight 100–800, width axis) | **800** and **200** only | Bengali + Latin | `@fontsource-variable/anek-bangla` |
| **Body** | **Hind Siliguri** | 400 (text), 600 (emphasis) | Bengali + Latin | `@fontsource/hind-siliguri` |
| **Mono** | **JetBrains Mono** (variable) | 400, 700 | Latin (codes, numbers, scores, ids) | `@fontsource-variable/jetbrains-mono` |

```css
--font-display: "Anek Bangla Variable", sans-serif;
--font-body:    "Hind Siliguri", sans-serif;
--font-mono:    "JetBrains Mono Variable", monospace;
```

**NEVER use:** **Inter, Roboto, Open Sans, Arial, system-ui**. The same goes for the platform stacks that
resolve to them: `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Helvetica Neue`. The only
fallback after a named font is the bare generic keyword (`sans-serif`, `monospace`).

**Self-hosted only.**
- Never `fonts.googleapis.com` or any other font CDN: the study protocol promises that no
  third party receives participants' IP addresses.
- **Dashboard:** `import '@fontsource-variable/anek-bangla'` (etc.) in `src/index.tsx`.
- **Study site (done 2026-10-07):** the needed `.woff2` files are copied from those packages into
  `study/aegis_study/static/fonts/` (with `OFL.txt`) and declared with `@font-face` in `study.css`.
- Load only the `bengali` and `latin` subsets, with `font-display: swap`.

**Bangla text:**
- **Line height:** at least 1.7 for body, 1.15 for display.
- **No letter-spacing** on Bengali text: it breaks conjuncts.
- **No weight 200 for Bengali below 48 px:** thin Bengali strokes are hard to read. Weight 200 is
  for large Latin/numeral display only.
- Set `lang="bn"` / `lang="en"` on `<html>` (already done) so the right glyphs and hyphenation apply.

---

## 3. Colour

**One dominant colour and one accent.** Everything else is a neutral, a same-hue step of those two,
or a status colour with a fixed meaning.

```css
:root {
  /* Dominant: "harbour ink". Text, headings, the task bar, dark sections. */
  --color-dominant:      #0F2B3A;
  /* Accent: "signal cyan". The one thing to act on: primary button fill, focus ring,
     the active nav marker, the highlighted series. */
  --color-accent:        #22C3D6;
  /* Same hue as the accent, darkened: the only way the accent appears as text on light backgrounds */
  --color-accent-ink:    #0A7482;

  /* Neutrals (not colours of their own) */
  --color-paper:         #F6F4EE;   /* page background */
  --color-surface:       #FFFFFF;   /* inputs, tables */
  --color-muted:         #5A6770;   /* secondary text */
  --color-line:          rgba(15, 43, 58, 0.14);  /* hairlines and borders */

  /* Status: states only, never decoration, always with an icon and a word
     (values from packages/dashboard/src/theme.ts VERDICT_COLORS) */
  --color-status-allow:     #0CA30C;
  --color-status-monitor:   #FAB219;
  --color-status-challenge: #EC835A;
  --color-status-block:     #D03B3B;
}
```

| Pair | Contrast (measured) | Allowed for |
|---|---|---|
| dominant on paper | 13.4 : 1 | all text |
| paper on dominant | 13.4 : 1 | all text (task bar, dark sections) |
| accent on dominant | 6.9 : 1 | text and UI on dark |
| dominant on accent | 6.9 : 1 | primary button label |
| accent-ink on paper | 5.0 : 1 | links and accent-coloured text on light |
| white on accent-ink | 5.5 : 1 | button label on accent-ink |
| muted on paper | 5.3 : 1 | secondary text |
| **accent on paper** | **1.9 : 1** | **never text.** Only fills, 2 px+ rules, focus rings, markers |

**Hue check.** The accent (186°) sits far from every status hue: block 0°, challenge 17°, monitor 41°,
allow 120°. So "accent" can never be read as a verdict.

**Dark (dashboard only):**
- page `#0A1E29`;
- surface `--color-dominant`;
- text `--color-paper`;
- accent unchanged.

Defined in its own `:root[data-theme="dark"]` block, as its own steps, never as an automatic inversion.

**Banned:**
- purple or indigo gradients on white, and gradients on white backgrounds in general;
- a second accent;
- the accent used as text on light backgrounds;
- status colours used for decoration or for "series 5";
- hex values in components: only `var(--color-*)` or the Tailwind tokens generated from them.

**Tailwind v4.** Expose the same variables in `packages/dashboard/src/index.css`:
```css
@theme {
  --color-dominant: #0F2B3A;
  --color-accent: #22C3D6;
  --color-accent-ink: #0A7482;
  /* …neutrals and status as above… */
  --font-display: "Anek Bangla Variable", sans-serif;
  --font-body: "Hind Siliguri", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
}
```
This gives `bg-dominant`, `text-accent-ink`, `font-display` and so on. Delete the unused `--color-aegis-*` tokens.

---

## 4. Spacing

An **8 px rhythm**: every margin, padding, gap, and fixed height of a control or row is a multiple of 8.

```css
--space-1: 8px;  --space-2: 16px; --space-3: 24px; --space-4: 32px;
--space-6: 48px; --space-8: 64px; --space-12: 96px; --space-18: 144px;
```

- 4 px is allowed **only** for the gap between an icon and its label, and for hairline offsets.
- Tailwind's default spacing unit is 4 px, so in the dashboard use **even steps only**:
  `p-2` (8), `p-4` (16), `p-6` (24), `p-8` (32), `p-12` (48), `p-16` (64). Odd steps (`p-3`, `gap-5`) are not allowed.
- **Touch targets** (study site): at least 48 px high on phones.
  - The study measures pointing behaviour, so target sizes must not change between participants (§10).
- **Radii:** `0` for panels and sections, `2px` for inputs and buttons. Nothing pill-shaped except the status dot.
- **Shadows:** none by default; separation comes from 1 px `--color-line` rules and background steps.
  - One exception: a single shadow on a floating element (dialog, popover, dropdown):
    `0 16px 48px rgba(15,43,58,0.24)`.

---

## 5. Type scale

**Weight extremes and size jumps of 3×.** No 1.25× or 1.5× in-between levels.

| Level | Size | Weight | Font | Use |
|---|---|---|---|---|
| **Hero** | **144 px** (phones: `clamp(72px, 20vw, 144px)`) | 800 | display | One statement or one number per screen: "৬টি কাজ", "98.2%", the participant's code on the done page |
| **Heading** | **48 px** (phones: `clamp(32px, 9vw, 48px)`) | **800 + 200 together** | display | Section titles. Pair a heavy and a light word, e.g. **কাজ** ২/৬ or **Overview** ⁄ live |
| **Body** | **16 px** | 400 (600 for emphasis) | body | Running text, form labels, table cells |
| Meta (the one exception) | 13 px, uppercase, `letter-spacing: .08em` | 700 | mono | Latin-only labels: column headers, codes, timestamps, units. Never Bengali (no letter-spacing on Bengali) |

- **Steps:** 16 → 48 → 144 is ×3 each time. The 13 px meta level exists only for dense data UI.
  Do not add a 20, 24 or 32 px level: emphasis inside a level comes from weight (200 vs 800) or the accent, not size.
- **Line heights:** display 1.0–1.15; body 1.6 (Latin) / 1.7 (Bengali).
- **Measure:** body text at most 68 characters wide (`max-width: 68ch`). The consent text especially.
- **Numbers:** in tables and stats, mono with `font-variant-numeric: tabular-nums`.

---

## 6. Components: reuse before writing

### 6.1 shadcn/ui primitives (dashboard only): **not installed yet**

To add them:
1. Run `npx shadcn@latest init` in `packages/dashboard`. It supports Tailwind v4 and React 18.
2. Add the `@/*` → `src/*` path alias to `tsconfig.json` and `vite.config.ts`.
3. Map shadcn's `--primary` to `--color-accent`, `--foreground` to `--color-dominant`, and
   `--radius` to `2px`.

Then use these, and no hand-rolled equivalents:

| Need | Primitive | Import path (after install) |
|---|---|---|
| Buttons | Button | `@/components/ui/button` |
| Labels, small states | Badge | `@/components/ui/badge` |
| Data tables | Table | `@/components/ui/table` |
| Page sections | Tabs | `@/components/ui/tabs` |
| Hover explanations of signals | Tooltip | `@/components/ui/tooltip` |
| Confirmations | Dialog / AlertDialog | `@/components/ui/dialog`, `@/components/ui/alert-dialog` |
| Mobile navigation | Sheet | `@/components/ui/sheet` |
| Forms | Input, Label, Select, Switch | `@/components/ui/input`, `…/label`, `…/select`, `…/switch` |
| Loading | Skeleton | `@/components/ui/skeleton` |
| Rules | Separator | `@/components/ui/separator` |
| A single framed panel (never in rows of three, see §8) | Card | `@/components/ui/card` |

The **study site cannot use shadcn**: it is server-rendered with no React. Its primitives are the
Jinja partials and CSS classes in §6.3.

### 6.2 Existing dashboard components: `packages/dashboard/src/components/`

| Component | Import path (from `src/pages/*`) | Reuse rule |
|---|---|---|
| `DashboardLayout` | `../components/DashboardLayout` | The only page shell. Not `../layouts/DashboardLayout` (a shim) |
| `Header` | `../components/Header` | Top bar. Reuse it |
| `Sidebar` | `../components/Sidebar` | Navigation. Replace emoji with `lucide-react` icons |
| `StatsCard` | `../components/StatsCard` | Headline numbers. Render several as **one stat rail** (one bordered strip, cells split by hairlines), never as a row of rounded cards |
| `VerdictBadge` | `../components/VerdictBadge` | **The** way to show a verdict (colour + icon + word). Build any new status badge on its pattern |
| `LiveIndicator` | `../components/LiveIndicator` | Data-feed state. Reuse |
| `ApiStatus` | `../components/ApiStatus` | Loading/error/empty states for API data. Reuse on every data page |
| `RequestTable` | `../components/RequestTable` | Request lists. Extend with props rather than copying it |
| `TrafficChart` | `../components/TrafficChart` | Time series (recharts). New charts follow the dataviz rules in §9 |
| `ThreatBadge` | `../components/ThreatBadge` | **Do not use.** It is unused and off-palette: delete it or rebuild it on `VerdictBadge` |

Shared logic, not visual: `useApi`, `useLiveStats` in `../api`; `VERDICT_COLORS`, `VERDICT_ORDER` in `../theme`.
The `Theme` object, `lightTheme`/`darkTheme` and `cardStyle()` are being replaced by the CSS variables in §3:
- no new code uses them;
- touched code migrates.

### 6.3 Existing study-site pieces: `study/aegis_study/`

| Piece | Path | Reuse rule |
|---|---|---|
| Page skeleton (`<html lang>`, task bar, SDK and recorder scripts) | `templates/base.html` | Every page `{% extends "base.html" %}`. The SDK/recorder script block stays exactly where it is |
| Shop chrome (logo, search, cart, categories) | `templates/shop_base.html` | Every shop page extends it |
| Product item | `templates/_product_card.html` (`{% include %}`), inside `_product_list.html` (column heads) | The one product markup: a list row (thumb, name, price, rating, reviews). Price stays before rating in the markup |
| Icons | `templates/_icons.html` (`{% import %}` as `icon`) | Inline SVG macros: shield, check, arrow, alert, cart, user, tick box |
| Journey steps | `base.html` masthead (`step`, `steps` from `render()` in `app.py`) | Five steps: consent, questions, tasks, last questions, done |
| Shared CSS | `static/study.css` | `.btn`, `.check`, `.error`, `.warning`, `.notice`, `.muted`, `.task`, `.shopbar`, `.cats`, `.product`, `.row`, `.radio`, `.question`, `.starpick`. Extend these; do not add page-local `<style>` |
| All text | `i18n.py` (`TEXT["bn"]`, `TEXT["en"]`) | No literal UI strings in templates: every string exists in both languages |

**Hooks that must survive any redesign.** Bots, the raw-event recorder and the e2e/unit tests depend on them:
- every `data-study="…"` attribute;
- element ids `#username #password #code #name #phone #address #city #postcode #note #text`;
- form field `name`s;
- `data-task` on the task bar;
- the `.product`, `.price`, `.stars` classes;
- the `<b>` elements inside the task text.

Run `npm run test:e2e` and `pytest study/tests` after every study-site change.

---

## 7. Layout

- **Left-aligned, asymmetric.**
  - Use a 12-column grid with a wide content column (≈ 8 columns) and a narrow rail (≈ 4 columns)
    for context: the task, a definition, a number.
  - Content starts at the left edge of the grid; never centre a page's main column of text.
- **Max width** 1200 px. Phones: one column, 16 px side gutters, no horizontal scroll.
- **Rules, not boxes.** Separate sections with a 1 px `--color-line` rule and 48–96 px of space;
  reserve a filled background (`--color-dominant`) for the one band that matters on a page (the task bar).
- **Lists before cards.** A collection of comparable things (products, requests, models) is a list or a
  table with aligned columns. That is also better for the study's compare task: price and rating line up.
- **The task bar** (study site) is the page's single dark band: `--color-dominant` background, paper text,
  the accent for the task number and the targets the participant must type.

---

## 8. Forbidden

1. **Three (or more) rounded cards in a row.** Includes the current `StatsCard` row (Overview, ML Performance)
   and the product-card grid. Use a stat rail, a table or a list instead.
2. **Centred-everything heroes:** a centred headline, centred paragraph and centred button stacked in the
   middle of the screen. Heroes are left-aligned, with the 144 px level and an asymmetric grid.
3. **Faint 0.1-opacity drop shadows on everything.** No shadow on cards, buttons, inputs or sections
   (see §4 for the single floating-element exception).
4. Purple or indigo gradients on white, and any background gradient behind text.
5. The banned fonts in §2, and font CDNs.
6. Emoji as interface icons (use `lucide-react` in the dashboard, inline SVG on the study site).
7. Colour as the only carrier of meaning, for status, errors or the current task.
8. New sizes between the type levels, odd spacing values, hex colours inside components.

---

## 9. Accessibility and data display

- **Text contrast:** at least 4.5 : 1 for body text, 3 : 1 for large display text and UI boundaries
  (see the table in §3).
- **Focus:** a visible 2 px `--color-accent` outline with a 2 px offset on every focusable element;
  never `outline: none` without a replacement.
- **Motion:** honour `prefers-reduced-motion` (everything stops; the IRB screenshots are taken that way).
  - Study site, pages outside the shop (landing, consent, questions, done): short entrance animations
    (`.rise`, 0.8 s, staggered) on **text and decoration only**, and the animated drawing in the landing hero.
  - **Never animate a control** (button, link, input, tick box, choice): a moving target changes pointing
    data, and scripts that measure a target before moving to it miss it.
  - Task pages (the shop): only motion that never moves a target: the progress segments filling in the task
    bar and the short "task done" tick.
  - **No cross-page View Transitions:** clicks during the ~0.35 s transition are lost (seen with Puppeteer,
    and fast participants would be affected the same way).
- **Labels:** every input has a visible `<label>`, and error messages are announced
  (`role="alert"`, already used).
- **Charts** follow the dataviz method used for the dashboard so far:
  - status colours for verdicts;
  - the accent for the single highlighted series;
  - thin 2 px lines;
  - no dual axes;
  - a text or table alternative.

---

## 10. Research constraints (study site)

The study site is a **measurement instrument**: layout changes change the behaviour being measured.

1. **Freeze the study UI before the first real participant.** Target sizes, positions, page lengths and
   the amount of scrolling affect mouse speed, Fitts' law fits and scroll features.
2. Any visual change after data collection starts needs:
   - a new `CONSENT_VERSION`, or a separate UI version stored with each session;
   - a note in `docs/thesis/THESIS_NOTES.md`;
   - fresh screenshots (`node docs/thesis/irb/screenshots/capture.mjs`).
3. **No randomised or A/B layout,** no animations that move targets, no lazy loading that shifts content
   while someone is pointing.
4. Identical layout for humans and bots: never style based on detection results.
5. **No layout shift after the `load` event.** All fonts are preloaded in `base.html`, so text does not
   reflow under the pointer when a font arrives.
6. The layout version is `UI_VERSION` in `study/aegis_study/app.py`; it is stored in every session's params
   and exported as `sessions.csv:ui_version`. Change it with every visual change.

---

## 11. Checklist for every UI change

- [ ] Uses only the tokens in §3, the fonts in §2, spacing multiples of 8 (§4), the three type levels plus meta (§5)
- [ ] Reuses the components in §6 (and adds shadcn primitives instead of hand-rolling them)
- [ ] None of the patterns in §8
- [ ] Works at 390 px wide and at 1280 px; Bangla and English both checked
- [ ] Contrast and focus checked (§9)
- [ ] Study site: hooks in §6.3 intact; `pytest study/tests` and `npm run test:e2e` pass; §10 respected
- [ ] Dashboard: `npm run build -w @aegis/dashboard` and `npm run lint` pass
