# Brief: Designs 4, 5, 6 (for the real plot)

Status (2026-10-01): Designs 1–3 are finished and the client likes them — **do not change their data**.
Walk mode is fixed and published. Two design subagents stalled; build D4–D6 directly in the main session.

## Confirmed site facts (client answers)
- 32×32 ft carpet area; existing **tin shed is outside it, on the north** (10 ft deep verandah).
- **Neighbours on east, west and south**: those plot walls are party walls — no windows/vents, nothing built beyond them.
- Only the **north** is open. The attached bathroom may go **under the tin shed** (north of the plot line); **part of the shed can be cut**.

## Program (original brief)
1 bedroom · 1 hall for many people · 1 open kitchen · 1 bath attached to the bedroom · 1 store · entry from the north below the shed ·
at least one north window · wall-embedded almirah (nice to have).
Furniture = catalog types in `src/models.js`: `queenBed`×2, `twinBed`×1, `sofaLeather`, `sofaWood`, `chairWood`×2, `partyBox`,
`micStand`×2, `fan`×1, `plasticChair`×3, frames (`frame`/`frameWide`), `boxStack`/`rack` in the store. Suggested extras allowed
(`tvUnit`, `fridge`, `diningTable`, `coffeeTable`, `rug`, counters, bath fixtures, `jaali`, `plant`, `washer`, `shoeRack`).

## Design rules (from the client + critic round)
- Karaoke family: TV + PartyBox + mics together, seating facing them.
- Guests should reach the toilet without crossing the bedroom (second bath door from a lobby, as in D3).
- Vastu where possible: north entry, kitchen SE or NW, bedroom SW, sleep head-south.
- Light & air without side windows: north façade (shaded by the shed), **aangan / light well open to the sky** (windows onto it OK),
  skylights, ventilation shafts for bath/kitchen. Bedroom and kitchen must still get real light and cross-ventilation.
- Kitchen windows sill 3.5 ft; circulation ≥ 3 ft; bed sides ≥ 1.75 ft; work triangle 12–26 ft; store reachable without the bedroom.
- Honest `tradeoffs`; same text fields as D1–D3: `name, tagline, beds, vastu, highlights, tradeoffs, view3d`.

## Concepts (planned, all different)
- **D4 Aangan house** — rooms around a central courtyard open to the sky.
- **D5 North-lit linear** — hall along the north façade + skylit hall, bath extension under a cut part of the shed.
- **D6 Split around a light well** — public half / private half separated by a light well.

## Engine + UI work needed
1. `plot.neighbours: ['e','w','s']` (D4–D6 only): party-wall look on those exterior faces, "neighbour" labels in Plan,
   Fit-check rule "window/vent on a neighbour wall", `+ Window` refuses them (`main.js` onDown `if (pendingAdd)` ~L720),
   and a matching assert in `tools/check.mjs`.
2. Light well: room flag `open: true` → no ceiling in Walk, kota/pebble floor, labelled, excluded from party capacity (`compare.js capacity`).
3. Shed cut: `shed: { depth: 10, cut: [x0, x1] }` in `structure.js verandah()` (~L242) so rooms under the shed don't poke through the roof.
4. Six designs in the UI: grouped tabs "Open-site concepts 1–3" / "For your plot 4–6" (`renderTabs` ~L768), keys 1–6 (~L1140),
   compare view per group of three (`openCompare` ~L901, `.cmp-grid` CSS), D1–D3 tagged "assume open sides".
5. **Protect saved edits**: `load()` (~L52) rejects storage unless `raw.designs.length === DESIGNS.length` — adding designs would silently
   discard the client's edits to D1–D3. Merge saved entries by index/id; test it.
6. Phone: in `index.html` `@media (max-width: 860px)` set `.toolbar { left: 12px; right: 12px; transform: none; }`.

## How to build and verify
- Data model and coordinates: header comment of `src/designs.js` (feet; x east, z south; rooms on wall centre-lines; `zone` = open plan).
- Security policy: run the Semgrep MCP scan on every created/modified source file **before** running anything.
- `node tools/check.mjs` — every design must be clash-free, door swings + doorway approaches clear, all rooms reachable, openings on walls.
- `OUT_HTML=/tmp/d46/floorplan.html node build.mjs`, then
  `PAGE=/tmp/d46/floorplan.html OUT=/tmp/d46/shots FRAMES=6 node tools/shoot.mjs "d4=design=4&still" "d4p=design=4&view=plan"`
  (params: design, view=plan|orbit|walk, still, night; `;js` suffix runs code, e.g. `app.openCompare()`), and view PNGs.
- `PAGE=... OUT=... node tools/interact.mjs` — full real-mouse UI suite must pass.
- Publish: `node build.mjs` → `dist/floorplan.html`
  (https://gimme.hyd.deshaw.com/codemill/malika/rootit/house-planner/dist/floorplan.html).
