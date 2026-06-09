# Machine-graph palette

Design spec for the colors used in the rendered state graph (`MachineGraph.svelte`). Goal: every visual role has a named token, each token has a deliberate value per theme, and the resulting graph has clear contrast tiers between page → node surface → edge label → stroke.

## Contrast tiers (target)

From back to front, each tier needs visible separation:

| Tier | Role |
|---|---|
| 1. Page | The MachineGraph card body bg (outermost surface in the panel) |
| 2. Node surface | Default state fill (idle, regular, halt — shared) |
| 3. Edge label bg | Floats over edges so text remains readable; clearly different from node surface |
| 4. Stroke | Borders / edges / arrowheads; sits on top of all surfaces |
| 5. Accent | Entry-point indicator, active-state highlight |

A swap between any two adjacent tiers should be visually obvious without squinting.

## Elements & token mapping

| Element | Token | Notes |
|---|---|---|
| Card body bg | `--editor-bg` | Owned by MachineGraph wrapper — not a graph token |
| Default node fill | `--graph-node-fill` | idle / regular / halt-inner all share this |
| Default node stroke | `--graph-node-stroke` | Border of untagged states |
| Default node text | `--graph-text` | `nodeLabel` color |
| Entry-point (`tag_main`) stroke | `--graph-node-main-stroke` | Distinct accent — currently only the "main" affordance |
| Entry-point (`tag_main`) fill | `--graph-node-main-fill` | **New:** subtle tint so entry is also visible at fill level |
| Halt outer-circle stroke | `--graph-node-halt-stroke` | The "ring" |
| Halt outer-circle fill | `--graph-node-halt-outer-fill` | Usually `none` so the ring reads as a ring |
| Halt inner-circle fill | `--graph-node-halt-inner-fill` | The solid disc inside the ring |
| Edge stroke (default `-->`) | `--graph-edge` | Regular transition |
| Edge stroke (thick `==>`) | `--graph-edge-thick` | Wrapped-into transitions (stack-push) |
| Edge stroke (dotted `-. enter / onHalt .->`) | `--graph-edge-dotted` | Synthetic entries + wrapper redirects |
| Arrowhead (`marker`) | `--graph-edge` | Matches edge stroke |
| Edge label text | `--graph-edge-label-text` | `edgeLabel` / `labelBkg` p color |
| Edge label bg | `--graph-edge-label-bg` | Floats over edge so text is legible |
| Subgraph (cluster) bg | `--graph-cluster-fill` | Used for wrapper subgraphs in v7 |
| Subgraph (cluster) stroke | `--graph-cluster-stroke` | |
| Subgraph (cluster) label | `--graph-text` | Reuses node text token |
| Highlight: from node | `--graph-highlight-soft-fill` + `--graph-highlight` stroke | Predecessor of just-fired |
| Highlight: to node | `--graph-highlight-soft-fill` + `--graph-highlight` stroke | Successor of just-fired |
| Highlight: strong (m.state) | `--graph-highlight-strong-fill` + thicker `--graph-highlight` stroke + glow | "You are here" |
| Highlight: edge (just-fired) | `--graph-highlight` | Thicker stroke than default |
| Snippet trace: current row bg | `--graph-highlight-soft-fill` | `ExecutionTraceTable.svelte` reuses the same accent so the live-graph "you are here" feel carries over to the trace table sitting beside it — tune both surfaces together when revisiting this token. |

## Proposed values

### Light theme

| Token | Value | Rationale |
|---|---|---|
| `--graph-node-fill` | `#ffffff` | White, sits clearly on the slightly-tinted card body |
| `--graph-node-stroke` | `var(--cell-border)` = `#d0d0d4` | Solid neutral, visible on white |
| `--graph-text` | `var(--fg)` = `#1a1b1e` | High-contrast body text |
| `--graph-node-main-fill` | `color-mix(in srgb, var(--accent) 8%, var(--graph-node-fill))` | Faint blue tint — "this one's special" without overpowering |
| `--graph-node-main-stroke` | `var(--accent)` = `#2563eb` | Saturated brand blue |
| `--graph-node-halt-stroke` | `var(--fg)` = `#1a1b1e` | Strong black ring — terminal state reads as "stop" |
| `--graph-node-halt-outer-fill` | `none` | Ring is hollow |
| `--graph-node-halt-inner-fill` | `var(--graph-node-fill)` = `#ffffff` | Solid disc matches other nodes |
| `--graph-edge` | `color-mix(in srgb, var(--accent) 30%, var(--muted))` = ≈`#6d7689` | Brand-leaning mid-tone; visible on white without being shouty |
| `--graph-edge-thick` | `var(--accent)` = `#2563eb` | Saturated — calls out the "this fires a push" semantic |
| `--graph-edge-dotted` | `var(--muted)` = `#5a5d63` | Dimmer than regular so dotted reads as "structural / synthetic" |
| `--graph-edge-label-text` | `var(--fg)` = `#1a1b1e` | High-contrast |
| `--graph-edge-label-bg` | `var(--editor-bg)` = `#ffffff` | Same as card body — labels look like they sit on the page |
| `--graph-cluster-fill` | `color-mix(in srgb, var(--accent) 4%, transparent)` | Whisper-tint to set the subgraph apart |
| `--graph-cluster-stroke` | `var(--cell-border)` = `#d0d0d4` | Dashed in mermaid output; subdued |
| `--graph-highlight` | `var(--head)` = `#d97706` | Brand amber — visual identity with tape head marker |
| `--graph-highlight-soft-fill` | `color-mix(in srgb, var(--head) 12%, var(--graph-node-fill))` | Tinted version of node bg |
| `--graph-highlight-strong-fill` | `color-mix(in srgb, var(--head) 24%, var(--graph-node-fill))` | Stronger tint for "you are here" |

### Dark theme

| Token | Value | Rationale |
|---|---|---|
| `--graph-node-fill` | `var(--cell-bg)` = `#2a2c30` | One step lighter than page bg `#1a1b1e`, distinct from edge-label bg |
| `--graph-node-stroke` | `var(--cell-border)` = `#3a3d42` | Subtle border on filled surface |
| `--graph-text` | `var(--fg)` = `#e6e6e6` | High-contrast body text |
| `--graph-node-main-fill` | `color-mix(in srgb, var(--accent) 14%, var(--graph-node-fill))` | Subtle blue tint over `#2a2c30` |
| `--graph-node-main-stroke` | `var(--accent)` = `#6ea8fe` | Brand blue, brighter in dark theme already |
| `--graph-node-halt-stroke` | `var(--fg)` = `#e6e6e6` | Bright ring — terminal state stands out |
| `--graph-node-halt-outer-fill` | `none` | Hollow ring |
| `--graph-node-halt-inner-fill` | `var(--graph-node-fill)` = `#2a2c30` | Solid disc inside ring |
| `--graph-edge` | `var(--muted)` = `#8a8d93` | Mid-tone gray, no brand color in dark |
| `--graph-edge-thick` | `var(--accent)` = `#6ea8fe` | Brand blue calls out "push" |
| `--graph-edge-dotted` | `color-mix(in srgb, var(--muted) 60%, transparent)` ≈ `rgba(138,141,147,0.6)` | Dimmer than regular |
| `--graph-edge-label-text` | `var(--fg)` = `#e6e6e6` | |
| `--graph-edge-label-bg` | `var(--bg)` = `#1a1b1e` | Matches page bg — labels look like they float on page, not on nodes |
| `--graph-cluster-fill` | `color-mix(in srgb, var(--accent) 6%, transparent)` | |
| `--graph-cluster-stroke` | `var(--cell-border)` = `#3a3d42` | |
| `--graph-highlight` | `var(--head)` = `#ff9f43` | Brand amber, brighter in dark |
| `--graph-highlight-soft-fill` | `color-mix(in srgb, var(--head) 18%, var(--graph-node-fill))` | |
| `--graph-highlight-strong-fill` | `color-mix(in srgb, var(--head) 32%, var(--graph-node-fill))` | |

## Open questions / decisions to confirm

1. **`main` tag — fill tint vs. stroke-only?** Current spec restores a subtle fill tint plus a saturated stroke. Stroke-only was cleaner but lost weight. OK to add the tint back?
2. **Halt ring — `--fg` or `--muted` for the ring?** `--fg` reads as strong / final. `--muted` is calmer and matches edge color.
3. **Dotted edges — separate token or just stroke-dasharray on `--graph-edge`?** A separate dimmer token reads as "structural/synthetic"; a single token with dasharray keeps it simpler.
4. **Cluster fill in v7 callable-subtree subgraphs** — should subgraphs have any tint, or always transparent (just a dashed border)?
5. **Edge label bg = page bg vs. card bg.** Page bg makes labels read as floating on the page surface; card bg matches the panel they're in. Need to pick one consistently across both themes.
6. **Brand color in dark edges.** Currently no brand color (gray edges). User asked for "brand colors in light theme" — implies dark stays neutral. Confirm.

## Mechanics

- Tokens live in `src/app.css` under `:root` (dark base) and `:root[data-theme='light']` / `@media (prefers-color-scheme: light)` (light overrides).
- All values must derive from existing site tokens (`--accent`, `--head`, `--fg`, `--muted`, `--bg`, `--editor-bg`, `--cell-bg`, `--cell-border`) via `var()` or `color-mix()` — no hex literals except where derivation isn't possible (`#ffffff` for light-theme node fill).
- MachineGraph's `<style>` block consumes these tokens via `!important` overrides on mermaid's per-id rules and inline attrs.
- Tag/halt special-casing requires class selectors on `.tag_main`, `.outer-circle`, `.inner-circle` (mermaid v11 emits these).
