# Sealed Box EV: What's Actually Worth Opening (August 2026)

*Analysis date: August 15, 2026. Every price below is dated and will move — re-verify before you buy anything on the strength of a number in this report.*

*This is gambling-style expected-value math applied to a hobby product. It is not financial advice. On the numbers in this report, the average sealed box loses money at today's prices. Nothing here is a recommendation to spend money you can't afford to lose.*

## The verdict

No sealed box under $5,000 is a reliably profitable rip at today's prices. That's the headline, and it holds up no matter how you slice it.

The best products here give you roughly a 1-in-4 to 1-in-6 shot at a box's contents reselling for more than you paid. A typical modern box — Surging Sparks, Phantasmal Flames, most current-year One Piece — gives you 3–15%. The $1,500–5,000 "premium" tier (Final Fantasy Collector, Evolving Skies, National Treasures Football) is the worst per dollar spent, despite carrying the biggest chase cards in the survey, because the sealed price already has that chase priced in.

No product in this survey shows a reliable, triangulated average return at or above 1.0x at market price. One model (tcgtalk) claimed Pokémon Pitch Black averaged 1.04x — the closest anything came to a real edge, and worth being skeptical of if you see it repeated elsewhere. A stronger, later triangulation — genuine eBay sold comps cross-checked against theexpectedvalue.com's set calculator — puts the same box's price-to-expected-value multiple at 4.43x instead: the box costs about 4.4 times its own median modeled return, not less than its return. Treat the 1.04x claim as a contradicted outlier, not a finding. Nothing else here comes close to 1.0x under any credible model.

The mechanism, in one line: sealed price = pull value + a lottery premium, and the premium is what you're actually paying for. Box prices track what's inside them, which is why almost nothing here is +EV.

The repeatable edges: buying at MSRP before the secondary market catches up, buying Japanese-native instead of US-imported, and buying cheap "breadth" boxes with lots of guaranteed hits instead of one lottery ticket. All three are acquisition-cost tricks, not luck tricks — that's why they work more than once.

Knock ~13% off any gross number for fees before it's real money.

## How to read the numbers

Four things repeat through every row below.

**P(single hit ≥ box)** — the chance one card, alone, resells for more than the whole box cost. The lottery-ticket number; usually the reason people rip in the first place.

**P(box pays for itself)** — the "win rate," and what the master table is sorted by: the chance everything pulled from the box, sold together, grosses more than the box cost. Sourced Monte Carlo simulations are used where they exist (tcgtalk's 100k-sim models, theexpectedvalue.com's bands); otherwise it's this report's own estimate, flagged **EST**.

**EV ratio** — expected gross resale value ÷ box price. 1.0 is breakeven; above is profitable before fees; below loses money before fees. Multiply by ~0.87 for the net-of-fees version. Some rows also show a **P/E multiple** (price ÷ median expected return) from theexpectedvalue.com's calculator — a different, complementary way of asking the same question: how many dollars of box price you're paying per dollar of typical expected return.

**The formula behind most of this:** P(≥1 hit) = 1 − (1−p)^n. Take the chance a single pack or box does *not* have the card (1−p), raise it to the number of packs or boxes opened (n), subtract from 1 — "at least one success in n tries," assuming shuffled, independent pulls.

**Confidence grades** (HIGH/MED/LOW) reflect sourcing strength. **EST** = this report's own estimate, no sourced model existed. **CONFLICT** = credible sources disagree; both numbers are shown rather than averaged away. A few rows below carry a confidence note flagged as inferred where the underlying source didn't supply an explicit grade — that's disclosed inline rather than silently assigned.

One multiplier applies everywhere and isn't in the table: **net ≈ gross × 0.87**, covering eBay (~13.25–13.6%) and TCGplayer (~10–13%) fees. Every EV ratio below is gross unless marked net.

## Ranked master table

Sorted by P(box pays for itself) — the "win rate" column, and the closest thing to a single answer to "what should I buy." CONFLICT and EST flags are carried over deliberately; they're part of the answer, not noise to clean up before presenting. Two rows below (Ascended Heroes, Pitch Black) required real correction after a later, stronger data pass — the table reflects the corrected data only; the retracted claims are noted inline so you recognize them if you see them elsewhere.

| # | Product | Box price (Aug 2026, sourced) | Key chase (value) | Chase odds | P(single ≥ box) | P(box pays for itself) | EV ratio gross | Conf |
|---|---------|------------------------------|-------------------|-----------|----------------:|----------------------:|---------------:|------|
| 1 | Yu-Gi-Oh: Quarter Century Bonanza (24 pk) | CONFLICT: $108–120 eBay bulk vs $190–250 OOS-retailer asks (waxstat 8/15) | BEWD QCSR PSA10 $200; DMoC QCSR $36 raw/$390 PSA10 | EVERY pack = 1 Platinum/QC Secret (200-card pool); ~3 QCSR/box (EST, sister-set extrapolation) | ~3–6% | **~25–40% IF ~$115 real; ~8–12% at $200+** | 0.6–1.1 (price-dependent) | LOW-MED |
| 2 | Pokémon JP: MEGA Dream ex (10-pk high-class) | $95–120 US import; ~$75–85 JP-native | Mega Gengar ex SAR $309–460 raw/$571 PSA10; Mega Dragonite SAR PSA10 $900 | any-SAR 1:27 packs (n=1,000+ boxes); god pack 1:200 boxes (3 sources) | ~10–14% US; ~15–20% JP | **~15–22% US / ~25–35% JP-native** | 0.7–1.1 US; 1.0–1.6 JP-native (cardchill model $130–190 — single source, likely optimistic) | HIGH rates / MED EV |
| 3 | Pokémon JP: Terastal Festival ex (10-pk HCP) | $200 (8/15) | Umbreon ex SAR $269–675 raw (TCG ~$416)/$706 PSA10 | GUARANTEED 1 SAR/box from 9-card Eeveelution pool → Umbreon ≈1/9 (EST uniform); god pack "1 in several thousand boxes" | ~11–15% | **~13–17%** | 0.65–0.85 EST | MED-HIGH |
| 4 | One Piece OP-09 (24 pk) | $672.57 TCGplayer 8/16 (113 sold/3mo) | Gol D. Roger Manga $4,498 raw / **$18,800 PSA10** | manga 1:48 boxes (avg $2,059); SpArt 1:6 ($446 avg); Secret 0.67/box; SR 7/box | ~6–7% | **~10–14%** | **0.77 sourced** (EV $518, tcgtrading.cards) → ~0.67 net | HIGH |
| 5 | Pokémon EN: Phantasmal Flames box (36 pk) | $374–380 (3-way confirmed, 8/15) | Mega Charizard X ex SIR raw $604–800 (pokemonpricetracker 8/14 vs pittpoke); PSA10 $1,900–2,337 (same-day sales); Gold $305 | SIR-specific 1:445 packs → 7.8%/box (consistent w/ tcgtalk's 1:400 → 8.6%) | ~9–11% | **11.1% (sourced 100k-sim)** | 0.53× sourced (TEV median $85.04; 95% high $726; P/E 4.74×) | MED |
| 6 | Lorcana: Whispers in the Well (24 pk) | $192.65 TCGplayer 8/16 | Ariel Iconic Holo $1,250 raw/$3,083 PSA10; Enchanteds $90–2,000 | any-Enchanted ≈1:96 packs → 22%/box (community consensus) | ~9–11% | **~11–14%** | 0.6–0.8 EST | MED |
| 7 | MTG: Avatar TLA Collector (12 pk) | $492–504 (3 marketplaces, daily 8/14) | Raised-foil Aang $3,575 raw/$5,204 PSA10; Toph borderless $1,045+; serialized Avatar State (no comps) | serialized ≈1:144 packs → 8.3%/box; raised-foil rate unknown | ~3–6% EST | **~10–18%** (95% band excl-chase tops $542 > price) | 0.77 excl-chases (EV $377 sourced); ~0.85–0.95 incl (EST) | MED-HIGH |
| 8 | Riftbound (LoL): Vendetta (24 pk) | $139–158 (8/16) | Akali Signature $2,850; base rares Akali $431/Shen $321/Kennen $225 | NO rate data (2 wks old) | unknown | **possibly high, UNSTABLE** — launch-hype singles will deflate | unknown | LOW |
| 9 | Gundam GD05 JP box (24 pk) | $93–114 JP ($214–220 EN) | LR++ $1,249–2,800 confirmed (Wing Zero ~$4k ask, anecdotal); grail split 5 ways | 160+ pk sample: SP 1:4–6 boxes; LR++ 0-in-7-boxes ("~1/case or rarer") | ~3–6% EST | **~10–20% (JP price; singles data thin)** | 0.5–0.9 EST | MED |
| 10 | YGO: Battles of Legend Glorious Gallery (24 pk) | $74.95 in stock (waxstat 8/15) | Dragon Master Magia Starlight $1,187 (14–16× box); Dominus $535 | 1 Secret + 4 Ultras GUARANTEED/pack; Starlight denominator UNPUBLISHED (sensitivity 1:24 boxes→4.1%, 1:48→2.1%) | ~2–4% | **~10–25% (aggregate breadth, wide EST)** | 0.6–0.95 EST | MED-LOW |
| 11 | Pokémon EN: Surging Sparks box (36 pk) | $294–303 (3 sources 8/14–15) | Pikachu ex SIR $293 raw (≈100% of box)/$900–920 PSA10 (12 dated comps); Latias $175/$500 | any-SIR 1:71 packs (n=500) → 40%/box; Pikachu-specific ≈1:781 packs → 4.5%/box | ~5–6% | **~8–12% EST** | **0.61 sourced** (break-even $201.57; 93.7% of packs lose) | MED-HIGH |
| 12 | Pokémon EN: Ascended Heroes ETB (9 pk) | $160–190 sold comps / $168.95 TCG market (8/14–15). CONFLICT: a widely-cited "$596.88 box, 15.4% win" figure describes a phantom 36-pack SKU — no such box exists (triple-confirmed: TCGplayer catalog, official product list, TEV calculator options) | Mega Gengar ex SIR #284 raw $1,098 (6–7× the ETB), PSA10 $2,100–2,834 (same-day sales); Pikachu ex SIR $1,074 | any-SIR 1:72 packs → ~12%/ETB; Gengar-specific 1:1,585 packs → 0.57%/ETB (+ Pikachu ≈0.57%) | ~1.5–3% | **~6–10%** | ~0.4–0.55 (TEV median $53.89 gross/$47.49 net; 95% high $378; P/E 3.37×) | MED |
| 13 | YGO: Chaos Origins (24×9) | $84.95 in stock (waxstat 8/15) | Magician of Dark Chaos Starlight $577–591 (7× box) | Starlight denominator UNPUBLISHED (same sensitivity) | ~2.5–4% | **~6–10%** | 0.5–0.75 EST | MED |
| 14 | Pokémon EN: Chaos Rising box | $175–233 sold comps (8/13–15) | Mega Greninja SIR $212 (≈ box price at low end) | Greninja-specific ≈6.5%/box | ~6.5% (at low-end box price) | **~6–9%** | not independently modeled — TEV median $55.06; P/E 3.75× | MED (not explicitly graded in source; inferred from sibling Mega-era sets) |
| 15 | Pokémon EN: Pitch Black box (36 pk) | $175–226 sold comps, TCG market $183.70 (8/15) — down 38% from pre-release $297 | Mega Darkrai ex SIR raw $228.59 (≥ box at market); MHR variant $171 | 6 SIR + 1 gold in set; any-SIR 1:89 packs → ~33%/box; Darkrai-specific ≈1:534 → 6.5%/box; MHR 1:1,260 → 2.9%/box | ~6–8% | **~5–10% (tcgtalk's widely-cited "1.04× average return" claim is CONTRADICTED by stronger triangulated sold-comp data — treat as a disputed outlier, not a finding)** | ~0.5–0.7 (TEV median $46.67 gross/$40.20 net; 95% band $7–246; P/E 4.43×) | MED (young set) |
| 16 | Pokémon EN: Prismatic Evolutions ETB (9 pk) | $155–168 sourced (TCG/PriceCharting 8/15); MSRP $49.99, restocks sell out fast | Umbreon ex SIR **$1,499 raw/$6,532 PSA10** (9–10× ETB); all 7 other Eeveelution SIRs $203–510 | any-SIR 1:45 packs (n=1,200+) → 18.3%/ETB; any-Eeveelution 1:180; Umbreon ≈1:1,440 packs → 0.62%/ETB | ~4–6% | **6.2% at $155 (sourced); break-even $64.47 → strongly +EV at $49.99 MSRP** | ~0.42 sourced at market; ~1.3 at MSRP | HIGH |
| 17 | Pokémon EN: Mega Evolution base set box | $295–327 sold comps (8/13–15) — up from $279 at launch | Mega Lucario ex MHR raw $299, PSA10 $650–998; Gardevoir ex MHR $253, PSA10 $520–700 | any-MHR 1:1,260 packs → 2.9%/box; any-SIR 1:101 packs → 30%/box | ~2.9% (only MHRs clear) | **~5–8%** | 0.45–0.6 (TEV median $88.62; P/E 4.18×) | MED-HIGH |
| 18 | Pokémon JP: Black Bolt / White Flare (20 pk × 7) | $168–179 JP-direct; $225–255 US (8/15) | Zekrom ex $247 raw/$490 PSA10; Reshiram BWR PSA10 $900; (EN-set versions: Zekrom BWR $606, Victini $604) | god pack rate EST 1:600–2,000 packs; BWR ≈1:496 packs (EN proxy) / EN model 1:1,789 self-flagged | ~3–5% EST | **~5–8%** | 0.5–0.7 EST | LOW-MED |
| 19 | One Piece OP-16 (current, 24 pk) | $208.12 (8/16) | Manga avg $1,148 | manga 1:48 boxes | ~4–5% | **~5–8%** | **0.60 sourced** (EV $124.62) | HIGH |
| 20 | MTG: Final Fantasy Collector (12 pk) | $1,503 eBay/$1,650 TCG/$1,850 ManaPool (daily 8/15) | Serialized Chocobo (77 copies, $40k–250k comps, 34 unfound); colorful Chocobos $1,800–6,500 | serialized <0.1%/pack; colorful ~0.03%/pack (EST) | **<1%** | **~5–8%** | **0.59–0.73 sourced** (EV $1,095 gross/$948 net, excl. serialized+colorful; P/E 1.59–1.95×) | HIGH |
| 21 | Pokémon JP: Glory of Team Rocket (30 pk) | $182 JP–$230 US (8/15) | TR Mewtwo ex SAR $286–370 raw/~$675 PSA10 | any-SAR 1-in-6–8 BOXES (n=1,000+ pk); Mewtwo ≈1:25–35 boxes (derived EST) | ~3–4% | **~4–6%** | 0.45–0.65 EST | MED |
| 22 | Pokémon EN: Perfect Order box | $160–220 sold comps | Zygarde ex MHR raw $134 (below box price — no card clears); PSA10 declining $1,500→$590 as population grows | not separately published for this set | ≈0% (no card in the set clears box price) | **~4–7%** | not independently modeled — TEV median $64.50; P/E 2.84× (lowest of six Mega-era sets) | MED (not explicitly graded in source; inferred from sibling Mega-era sets) |
| 23 | Sports: 2025 National Treasures FB (1 pk, 8 hits) | $2,249.95 (8/15) | Hunter/Jeanty/McMillan RPAs ($1,500–5,000 EST, no sold comps) | 8 hits guaranteed; needs $281/hit; median hit EST $50–150 | ~2–4% EST | **~4–7%** | 0.35–0.55 EST | LOW-MED |
| 24 | One Piece OP-13 (24 pk) | $480.35 (8/16) | Luffy Red Manga $8,932–17,764 raw / **$33,160 PSA10** | any-manga 1:78 boxes | ~1.3% | **~3–5%** | **0.52 sourced** | HIGH |
| 25 | Pokémon JP: Storm Emeralda (30 pk, 2 wks old) | $200 (8/15) | Mega Rayquaza ex MUR $1,830 raw; PSA10 asks $2,460–3,080 | MUR ≈1:50–100 boxes (SHOP EST, no sample) | ~1–2% | **~3–5%** | 0.5–0.7 EST | MED-LOW |
| 26 | Pokémon EN: Destined Rivals box (36 pk) | $433–506 (2 sources 8/15, incl. TCGplayer Market $433.32) | TR Mewtwo ex SIR raw $505–519, PSA10 $1,112 (sold comps $999–1,259, 8/7–8/15) | any-SIR 1:86–94 packs (n=8,000+; pullrates.com/TCGplayer/thetoploader triangulated) → ~24–34%/box; Mewtwo-specific ≈1:1,038 packs (≈1-in-29 boxes) → ~3.5%/box | ~3.5% | **2.7% at market (sourced 100k-sim; 36.6% at retail ~$199)** — "avoid entirely" at market | ~0.4 sourced-implied | LOW-MED |
| 27 | Sports: 2025-26 Topps Chrome BKB (20 pk) | $1,088 secondary (MSRP $380; 8/15) | Cooper Flagg RCs/autos | 1 auto guaranteed | ~2–3% EST | **~3–6%** | 0.35–0.6 EST (2.9× MSRP premium priced in) | MED |
| 28 | Pokémon EN: Evolving Skies box (36 pk) | **$2,437–2,650** (3 sources 8/15–16; 52wk range $2,184–2,715) | Moonbreon raw $2,244–2,259 (≈92% of box; PSA10 data unreliable); Rayquaza alt $1,248 (does NOT clear) | any-secret ≈0.93%/pack (n=108 — small); Moonbreon EST 1:36–51 boxes | ~2–3% | **~3–5%** | 0.3–0.5 EST | MED |
| 29 | Sports: 2025 Donruss Optic FB (20 pk) | $620–660 street ($875 MSRP) | Sanders auto /199 PSA10 $395 | avg box pulls trade **$130–410** (pullmarket.io, SOURCED) | ~1–3% | **~3–5%** | **0.20–0.55 sourced range** | MED-HIGH |

Twenty-plus additional products are too new, too thin on data, or too structurally different (no booster box, myths worth killing) to rank on this table. Their key figures aren't dropped — they're folded into the category roundups below, one-liner style, product by product.

## Top 5 picks

These are the five highest P(box pays for itself) in the survey. "Best" here means "least bad" — read each card's "what would make it wrong" before buying.

### 1. Yu-Gi-Oh: Quarter Century Bonanza (24-pack box)

**Price:** Disputed — eBay bulk lots at $108–120 vs. out-of-stock retailer asks of $190–250 (waxstat, 8/15). Your return depends entirely on which market is real.

**Structure:** Every one of 24 packs guarantees a Platinum Secret or Quarter Century Secret Rare from a 200-card pool — named chases include the BEWD QCSR (PSA10 $200) and DMoC QCSR ($36 raw/$390 PSA10). Roughly 3 QCSRs land per box, an estimate carried over from a sister set, not measured on this set directly.

**The math:** 24 guaranteed hits make this a breadth play — that's why it tops the ranking even though P(single ≥ box) is only ~3–6%. At the ~$115 price, P(box pays for itself) is ~25–40% (EV ratio 0.6–1.1); at $200+, it's 8–12%.

**What would make it wrong:** If $190–250 is the real liquid market and $115 reflects bulk or damaged stock, this drops from best-in-survey to below-average. The 3-QCSR estimate is also unverified for this specific set.

### 2. Pokémon JP: MEGA Dream ex (10-pack high-class box)

**Price:** $95–120 as a US import; $75–85 Japanese-native (plus ~$20–40 proxy shipping).

**Structure:** 10 packs. Any-SAR rate is 1-in-27 packs (n=1,000+ boxes); god pack ~1-in-200 boxes, corroborated by 3 sources. Chases: Mega Gengar ex SAR $309–460 raw/$571 PSA10, Mega Dragonite SAR PSA10 $900.

**The math:** Not every SAR clears box price, which is why P(single ≥ box) is ~10–14% US / ~15–20% JP rather than higher. P(box pays for itself): ~15–22% US, ~25–35% JP-native — same pulls, a materially different bet depending on where you buy. EV ratio: 0.7–1.1 US, 1.0–1.6 JP-native (the top end leans on a single, likely-optimistic cardchill model).

**What would make it wrong:** The JP-native edge only holds buying from reputable sellers — import fees and counterfeit risk eat into it otherwise. If the cardchill model is wrong, this moves from best-in-survey to merely solid.

### 3. Pokémon JP: Terastal Festival ex (10-pack high-class box)

**Price:** $200 (8/15).

**Structure:** 10 packs, 1 guaranteed SAR from a 9-card Eeveelution pool. Umbreon ex chase: $269–675 raw (TCG ~$416), $706 PSA10. Assuming uniform distribution (an assumption, not confirmed), Umbreon lands roughly 1-in-9 boxes; god pack ~1-in-several-thousand.

**The math:** The guaranteed SAR keeps P(box pays for itself) in a tight 13–17% band without needing a jackpot. P(single ≥ box) is 11–15% — close to the box-level number, meaning most of the value case rests on that one guaranteed slot. EV ratio: 0.65–0.85, estimated.

**What would make it wrong:** The uniform-distribution assumption is the weak point — if the print run weights toward cheaper Eeveelutions, real odds are worse. This entire row is an estimate stack, not a sourced simulation.

### 4. One Piece OP-09 (24-pack box)

**Price:** $672.57 (TCGplayer, 8/16; 113 sold in the past 3 months — a real, liquid market).

**Structure:** 24 packs. Manga-rarity rate is 1-in-48 boxes (average manga value $2,059); Special Art rate 1-in-6 boxes ($446 average); plus 0.67 Secret and 7 SR cards per box on average. Chase: Gol D. Roger Manga at $4,498 raw / $18,800 PSA10 — the single biggest card in this report.

**The math:** P(single ≥ box) is only ~6–7% — most boxes don't see the manga card, and the SR/Secret floor doesn't clear box price alone. P(box pays for itself) is ~10–14%, and this is one of the better-sourced rows in the survey: 0.77x EV gross (EV $518 per box, tcgtrading.cards), ~0.67x net of fees.

**What would make it wrong:** The manga card's value depends on a thin, high-dollar market — a five-figure card can take months to sell at comp price, and the "average $2,059" hides real spread down to ordinary SRs on a typical box. Treat this as the report's clearest "spend for a real shot at a monster, expect a loss most of the time" pick.

### 5. Pokémon EN: Phantasmal Flames box (36-pack)

**Price:** $374–380, confirmed three ways as of 8/15 — one of the tighter, more trustworthy price bands in this report.

**Structure:** 36 packs. Mega Charizard X ex SIR-specific rate is 1-in-445 packs (7.8%/box), consistent with an earlier tcgtalk estimate of 1-in-400 (8.6%/box). Chase: MCX SIR raw $604–800 (sources range from pokemonpricetracker's $604 to pittpoke's $701), PSA10 $1,900–2,337 with same-day sales confirming liquidity; Gold cards $305.

**The math:** P(single ≥ box) is ~9–11%. P(box pays for itself) is 11.1%, from a sourced 100,000-simulation model — one of the more solid win-rate figures here. EV ratio is 0.53x sourced; theexpectedvalue.com's calculator separately puts the median return at $85.04 with a 95th-percentile high of $726, and prices the box at 4.74x its own median expected return (P/E) — a concrete number for how large the lottery premium is on this specific product.

**What would make it wrong:** The PSA10 comps are recent and thin (same-day sales, not a deep history) — if grading volume ramps up and populations grow, top-end comps can soften fast, the same pattern seen elsewhere in this report (see Perfect Order's Zygarde PSA10, which fell from $1,500 to $590 in four months as its population grew).

## Category roundups

### EN Pokémon

The largest category in this survey, and the one most reshaped by a later, stronger data pass that triangulated real eBay sold comps against theexpectedvalue.com's per-set calculators. Phantasmal Flames ($374–380, 11.1% win rate, 0.53x EV) is the current-set pick — see Top 5. Prismatic Evolutions ETB is the MSRP story of the whole report: 6.2% win rate and 0.42x EV at $155–168 market, but strongly +EV (~1.3x) at its $49.99 MSRP, break-even $64.47 — buy it at MSRP during a restock, not off the shelf at market price. Surging Sparks ($294–303): 0.61x EV, break-even $201.57, and 93.7% of individual packs lose money on their own — the 8–12% box-level win rate exists only because a few packs carry the whole box.

Two products needed real correction. Ascended Heroes has no 36-pack booster box at all — a widely-cited "$596.88 box, 15.4% win rate" figure describes a phantom SKU that doesn't exist in any catalog; ignore it if you see it quoted elsewhere. The real product is a 9-pack Elite Trainer Box, $160–190 sold / $168.95 TCG market, chasing a Mega Gengar ex SIR at $1,098 raw (PSA10 $2,100–2,834) and a Pikachu ex SIR at $1,074 — win rate ~6–10%, EV ratio ~0.4–0.55. Pitch Black is a bigger reversal: post-release sold comps have it at $175–226 (TCG market $183.70), down 38% from its $297 pre-release price, and a widely-repeated claim that this box averages 1.04x return (tcgtalk) is contradicted by stronger triangulated data putting it at 0.5–0.7x EV and a 4.43x price-to-expected-value multiple — treat the 1.04x claim as a disputed outlier, not a finding. Its win rate is now ~5–10%, not top-5 territory.

Destined Rivals is this category's clearest "don't buy at market" case: a newly-found pull rate (any-SIR 1-in-86–94 packs, n=8,000+) still only produces a 2.7% win rate at its $433–506 market price ("avoid entirely," per the sourced model) versus 36.6% at a ~$199 retail reference. Evolving Skies ($2,437–2,650) is the premium-tier cautionary tale: 3–5% win rate, 0.3–0.5x EV, and its Moonbreon chase — ~92% of box price — still doesn't clear.

Three more Mega-era products now have enough data to rank. Mega Evolution base set box ($295–327, up from $279 at launch) chases a Mega Lucario ex MHR at $299 raw (PSA10 $650–998) for a 5–8% win rate. Chaos Rising ($175–233) chases a Mega Greninja SIR at $212, right around its own low-end box price, for 6–9%. Perfect Order ($160–220) is the weakest of the six Mega-era sets by every measure — no card in the set clears box price, and it prices at 2.84x its own median modeled return, the lowest (best, relatively) multiple of the six but still a loser on average, for 4–7%.

Off the ranked table: Crown Zenith has no booster box (ETB-only, $330); the "GG Umbreon" chase is a myth — no Umbreon in the Galarian Gallery subset (Giratina VSTAR GG $342/$642 PSA10; GG-gold 1:125 packs; pack EV $11.43 vs $23.21 = 0.49×). 151 has no box either — bundle $181 (any-SIR 4.1%; Charizard SIR $370/$1,497 PSA10), Ultra Premium Collection $940 (any-SIR ~10.7%). Celebrations has no liquid box product at all — the TCGplayer catalog lists none, and "boxes" seen on eBay are reseller-reassembled loose packs at roughly $40.73/pack; the best pullable card, Mew 025/025, tops out at $61 raw/$213 PSA10, nowhere near box-scale value. Black Bolt/White Flare's English release has a milder version of the same problem: no standard booster box exists (confirmed against a 61-SKU catalog) — real units are a 6-pack Booster Bundle ($88–97), a 60-pack Bundle Display ($1,421–1,660), and ETBs ($156–169, having doubled in a year). Zekrom ex BWR raw $605/PSA10 $1,422; Reshiram ex BWR raw $495/PSA10 $1,300; any-BWR rate 1:496 packs (n=8,000+, though a conflicting 1:1,789 comes from a smaller 750-pack sample with zero hits). A $97 Booster Bundle buys roughly a 1.2% shot at a 5–6x card — a cheap lottery ticket, not a ranked play. VSTAR Universe ($205–300) chases have settled at or below box price; its good-EV era is over.

### JP Pokémon

This is where the best win-rate numbers in the survey live, and it's about price, not luck — Japanese-native pricing runs 30–75% under the US-import price on the same box. MEGA Dream ex is the headline pick (Top 5, above). Terastal Festival ex ($200, guaranteed-SAR structure) sits at 13–17%. Glory of Team Rocket ($182 JP–$230 US) and Storm Emeralda ($200, two weeks old) both sit at 3–6%, dragged down by chases that need a specific pull rather than a guaranteed slot — Storm Emeralda's mega-rare rate is a shop estimate with no real sample behind it. Black Bolt/White Flare (JP boxes, $168–179 JP-direct / $225–255 US) sits at 5–8%, held back by a god-pack rate estimated at 1-in-600 to 1-in-2,000 packs.

Off the ranked table, the standard JP Mega sets are cheap and small: Nihil Zero $85 (Zygarde MUR $174), Ninja Spinner $100 (Greninja MUR $490/SAR $317), Abyss Eye $105 (Darkrai MUR $480–1,175, two sources conflict by 2.4x) — none clear box price with their top chase, but they're cheap enough as a breadth play. Heat Wave Arena ($157–211) and Battle Partners ($80–110) are decay examples: Garchomp SAR fell $271→$71–110, Clefairy SAR fell $452→$126 (PSA10 $242–272) — price a box off this month's numbers, not last month's screenshot.

### One Piece

Three ranked sets, one clear pattern: One Piece box EV is sourced and consistently mediocre. OP-09 ($672.57, 113 sold in 3 months) is the best of the three at 10–14% win rate and 0.77x EV gross (0.67x net), carrying the biggest chase card in this report — Gol D. Roger Manga at $4,498 raw/$18,800 PSA10 — but the manga rate is only 1-in-48 boxes. OP-16, the current set, is $208.12 with 0.60x sourced EV and 5–8% win rate. OP-13 is the weakest (3–5%, 0.52x EV) despite an even bigger chase, Luffy Red Manga at $8,932–17,764 raw/$33,160 PSA10 — its manga rate is thinner, 1-in-78 boxes.

The category's real lesson is reprint risk, not pull rates: OP-01 wave-1 runs $5,358 (over this report's budget anyway); the wave-2 reprint trades at $1,516 — 28% of wave-1's price, a 72% crater from one reprint announcement. Weigh that against OP-17, launching this month (see Live Windows).

### MTG

Two ranked boxes, both collector-tier, both above this report's median EV ratio. Final Fantasy Collector ($1,503–1,850) has the best-sourced EV ratio of any premium box here — 0.59–0.73x gross, $1,095 gross/$948 net expected return — driven by a no-reprint status that let it climb steadily since its 2025 launch; its serialized Chocobo (77 copies, $40k–250k comps, 34 unfound) is excluded from that math, pure lottery on top. Avatar: The Last Airbender Collector ($492–504) is the stronger relative pick: 10–18% win rate, ~0.77–0.95x EV, chasing a raised-foil Aang at $3,575 raw/$5,204 PSA10 — though only the serialized-chase rate (1-in-144 packs) is published; the raised-foil rate isn't.

Off the ranked table: Marvel Spider-Man Collector ($420–720) is this report's cautionary tale — Wizards of the Coast has publicly acknowledged the set crashed. Marvel SH collector ($480–769, Mind Stone $1,700; headliner ~1%/pack → 11.4%/box; its 1-of-1 serialized card has no comps) and Edge of Eternities (EOE) collector ($740–900, Sothera $1,800–2,000) both have chases well above box price but aren't ranked here. Lorwyn Eclipsed's serialized Bitterbloom (~$4,000 comp) has an unresolved box price.

### Yu-Gi-Oh

Three ranked boxes, and the category's defining problem is nobody has published the real odds. Quarter Century Bonanza is the headline pick (Top 5, above), its price disputed by nearly 2x between sources. Battles of Legend: Glorious Gallery ($74.95) guarantees 1 Secret + 4 Ultra Rares per pack — real breadth — but the odds on its chase, Dragon Master Magia Starlight ($1,187, 14–16x box price), are unpublished; this report shows a sensitivity range (1-in-24 boxes → 4.1%, 1-in-48 → 2.1%) instead of one number, and its 10–25% win-rate band reflects that uncertainty. Chaos Origins ($84.95) has the same unpublished-denominator problem chasing Magician of Dark Chaos Starlight ($577–591).

Off the ranked table, Rarity Collection V ($114) is staple-dense — real playable value, not modeled here. The honest read: cheap boxes with real guaranteed pulls, wide error bars on anything Starlight-tier.

### Sports

The worst category in this survey, on every axis. The only sourced (not estimated) figure — Donruss Optic Football's average box pulls at $130–410 against a $620–660 street price ($875 MSRP) — is bad, landing its EV ratio at 0.20–0.55. National Treasures Football ($2,249.95, 8 guaranteed hits) needs each hit to average $281 to break even; named rookie patch autos (Hunter, Jeanty, McMillan) are estimated at $1,500–5,000 with no sold comps, and the realistic median hit is estimated at $50–150 — still only 4–7%. Topps Chrome Basketball ($1,088 secondary vs. $380 MSRP) has a 2.9x MSRP markup priced in before pull odds even enter, landing at 3–6%.

Off the ranked table: National Treasures Basketball ($3,300–4,500) needs $400–500/hit across 8 hits. Prizm Football ($975) has a median hit of $10–30. Prizm WNBA ($750) is comparatively more interesting — a smaller player pool gives a better median around names like Bueckers and Clark. Topps Dynasty ($1,500) is single-card binary, not modelable. F1 Topps Chrome ($250) has no guaranteed auto — the Hamilton auto sits at 1-in-297,504 packs. Topps Chrome MLB ($420) and Bowman Chrome ($300, weak rookie class) round out the unranked field. One structural note, not a pull-odds edge: Panini's NFL license ends 3/31/26 and Topps already holds NBA (as of 10/2025) — a hold-sealed-for-scarcity thesis, not a reason to rip boxes now.

### Emerging / other

Lorcana's Whispers in the Well ($192.65) is the best performer outside Pokémon and One Piece: any-Enchanted rate near 1-in-96 packs (22%/box) drives an 11–14% win rate, chasing an Ariel Iconic Holo at $1,250 raw/$3,083 PSA10. Riftbound (League of Legends) Vendetta ($139–158) has a real chase — Akali Signature $2,850, base rares $225–431 — but it's two weeks old with no pull-rate data yet; flagged "possibly high, unstable," since launch-hype singles prices reliably deflate as supply catches up. Gundam GD05 ($93–114 JP, $214–220 EN) sits at 10–20% at JP pricing, based on a real 160+ pack sample (SP-tier at 1-in-4–6 boxes), though its top chase (LR++, $1,249–2,800) runs closer to 1-in-a-case or rarer, split five ways.

Off the ranked table: Dragon Ball Super FB10 (~$60, Super AA chase $1,600–2,199) has no published rates — unmodelable. Union Arena's Inuyasha box ($127) has a single $10k ask and zero actual sales — not a real market. Star Wars Unlimited Carbonite ($176) has showcase pulls at 1–2 per case; its realistic floor sits below box price most of the time.

## Strategic findings

**1. Markets price boxes efficiently.** Sourced EV ratios cluster 0.4x–0.8x gross (0.35x–0.7x net). The cleanest single exhibit: all six EN "Mega-era" Pokémon sets (Phantasmal Flames, Pitch Black, Ascended Heroes ETB, Mega Evolution base, Perfect Order, Chaos Rising) price at 2.84x–4.74x their own median modeled return, per theexpectedvalue.com's calculators — you're paying $2.84 to $4.74 for every $1 of typical expected return. One model (tcgtalk) claimed Pitch Black averaged 1.04x — a real edge, if true — but stronger triangulated data contradicts it (4.43x, not 1.04x). Nothing in this survey reliably clears 1.0x. The lottery premium — box cost minus average contents value — is the product you're buying.

**2. The MSRP/launch-window edge is the only consistently repeatable one.** Final Fantasy Collector launched near $455 MSRP (+EV then), now trades $1,503–1,850 against a current EV of $1,095 — the edge was real, but in 2025. Prismatic Evolutions ETB breaks even at $64.47 against a $49.99 MSRP, vs. a 6.2% win rate at $155 market. Destined Rivals wins 36.6% at ~$199 retail vs. 2.7% at market. Same pattern three times: buy near MSRP or a restock window, not after the secondary market has repriced around what's inside.

**3. Japanese-native pricing beats US import by 30–75% on the same box.** MEGA Dream ex: ~$80 JP-native vs. $95–120 US. VSTAR-era boxes: $155–212 JP vs. $300 US. Budget ~$20–40 in proxy shipping — usually still worth it, and it can flip a box from negative EV to breakeven.

**4. Breadth beats jackpots for P(profit).** Guaranteed-hit density (Quarter Century Bonanza, Glorious Gallery, MEGA Dream ex's SAR floor, National Treasures' 8 hits) tops the ranking. Jackpot boxes (Storm Emeralda, OP-13, Evolving Skies, Final Fantasy Collector at today's price) sit at 3–8%, however large the jackpot.

**5. Chase-card price decay is brutal and fast.** Lillie's Clefairy: $452→$126. Cynthia's Garchomp: $271→$85. Pitch Black itself: $297 pre-release→$175–226 in about four weeks, a 38% drop. Pricing a box off a chase card's peak hype price double-counts — by the time you open it, that number has usually already fallen.

**6. Reprint risk can hit with no warning.** OP-01 wave-2 reprinted at 28% of wave-1's price — a 72% crater. Final Fantasy Collector's climb, by contrast, is explained by its no-reprint status. Check for reprint announcements before buying for the chase-card thesis specifically.

**7. Sports is the worst category here.** The only sourced figure — Optic's average pulls at $130–410 against a $620–875 cost — is bad. The 8-hit high-end (National Treasures) is structurally better than low-hit-count sports products but still only 0.35–0.55x EV. The Panini-to-Topps NFL/NBA license transition (Panini NFL ends 3/31/26; Topps holds NBA since 10/2025) supports holding sealed for scarcity, not ripping now.

**8. Grading and fees move the margins, not the center.** PSA 10 = 1.5–4.4x raw (Prismatic's Umbreon: $1,499 raw → $6,532 PSA10) — but $20–25 and months per card, with gem-rate risk, and see the risk section below on how many "PSA 10" listings for new cards aren't actually graded at all. Fees: ~13.25–13.6% eBay, ~10–13% TCGplayer. Use 0.87x net-of-fees on any gross number here.

## $5,000 deployment scenarios

Illustrative math, not financial advice. Every scenario below is negative-EV in dollar terms even at its best — that's the honest read of a market where almost nothing clears 1.0x.

**A — Maximize P(portfolio pays for itself):** 45 boxes of MEGA Dream ex, Japanese-native at ~$85 landed ($3,825), plus $1,175 held for MSRP preorders on the 30th Anniversary Celebration and OP-17. Expected SARs ≈ 45 × 0.33 ≈ 15. P(≥1 god pack) = 1 − (199/200)^45 = 20.2%. Portfolio EV ratio ≈ 0.9–1.2 — the best blended number in this report, still not a guaranteed win.

**B — Maximize jackpot-per-dollar:** 7 boxes of One Piece OP-09 ($4,708). P(≥1 Gol D. Roger Manga) = 1 − (47/48)^7 = 13.7%, at an average manga value of $2,059 (top comp $18,800 PSA10). EV ratio 0.77 → expect ~$3,600 back on $4,708 spent, an expected loss around $1,100, for a real shot at a five-figure card.

**C — Single premium box:** Final Fantasy Collector ($1,850), National Treasures Football ($2,250), or Evolving Skies ($2,450). Expected loss $600–1,500; P(profit) tops out ~8%. Dominated by both A and B — included to show why spreading $5,000 across cheaper boxes beats concentrating it in one expensive one.

## Live windows right now

Three genuine MSRP-adjacent windows are open this week:

- **The Hobbit (MTG) Collector Boosters** — released 8/14, MSRP ~$456. An estimated 500-copy Gold Smaug serialized chase has no sold comps yet — no honest way to model EV right now; a launch-window bet, not a modeled pick.
- **One Piece OP-17** — releases 8/22 Japan / 8/28 English. MSRP ~$95–108; presale asks already $333. MSRP entry fits the same pattern as Final Fantasy and Prismatic Evolutions above. The $333 presale does not.
- **Pokémon 30th Anniversary Celebration** — worldwide 9/16, including two Ultra Premium Collections at $179.99 each with Classic Collection reprint packs. Not yet priced secondary.

None have enough post-release data to model — that's what makes them windows. By the time real numbers exist, any MSRP opportunity will likely be gone.

## Risks

**Variance.** Averages hide bad medians. Prismatic Evolutions' median is −$119. Evolving Skies' no-chase floor is $10.67. Ascended Heroes ETB's 95th-percentile outcome is $378 against a $53.89 median — most boxes land far below the headline number.

**Price drift.** Every price here is dated to a specific August 2026 day. Hot sets move weekly — Pitch Black alone moved from $297 pre-release to $175–226 in about a month.

**Liquidity.** Four-figure cards take weeks to months to sell at comp price, and that price can soften if you need to sell fast into a thin market.

**Grading turnaround and gem risk.** Months and $20–25 per card, and not every raw card gems. The PSA10 multiplier only pays off if it actually grades.

**PSA10 listing fraud.** For very new chase cards, most eBay "PSA 10" listings are actually raw cards marketed as "PSA 10 potential" or "PSA 10 candidate" — not real graded comps. Genuine graded comps for Mega Darkrai, for example, cluster $1,875–3,250 from a narrow Jul 27–Aug 6 window, with none confirmed since; populations are thin enough that a handful of new gems can move the whole market. Perfect Order's Zygarde PSA10 shows the flip side of the same thinness: it fell from $1,500 to $590 in four months as its population grew.

**Reprint waves.** See finding #6 — an announcement can cut box value by more than half overnight.

**Hype decay.** New-set chase prices peak in the first days and settle downward. Modeling off week-one prices overstates real EV.

**Fees and shipping.** ~13% off any gross figure for marketplace/payment fees, plus real shipping, plus ~$20–40 for JP-import shipping specifically.

**Counterfeit risk on JP imports.** The Japanese-pricing edge only holds buying from reputable sellers.

**Data caveats.** Pull rates are community-sampled, not official, ranging from large samples (1,000+ boxes for some JP sets) to near-anecdotal (Riftbound, Union Arena). EST and CONFLICT flags in the master table are load-bearing, not decoration.

## Methodology

Five research lanes — English Pokémon, Japanese Pokémon, sports, One Piece plus emerging games, MTG plus Yu-Gi-Oh — plus a direct verification pass on JavaScript-rendered pages automated crawlers can't read, and a later, higher-rigor triangulation pass on six EN "Mega-era" Pokémon sets. Primary sourcing: theexpectedvalue.com daily snapshots (8/14–8/15), tcgtrading.cards live data, waxstat (8/15), TCGplayer/PriceCharting (8/15–8/16).

The sourced Monte Carlo models carrying the most weight: tcgtalk's 100,000-simulation win-rate models (Surging Sparks n=500, Prismatic Evolutions n=1,200+, Phantasmal Flames, Destined Rivals) — tcgtalk's Ascended Heroes and Pitch Black figures are superseded above by a stronger triangulation and should not be treated as findings; pullrates.com (n=1,500+ Crown Zenith, n=1,200+ Prismatic Evolutions); cardchill (n=1,000+ boxes, MEGA Dream ex); tcgtalk's Gundam sample (160+ packs); tcgtrading.cards' One Piece models, simulated but calibrated to community-confirmed guarantees; theexpectedvalue.com's per-set calculators, cross-checked against 130point.com eBay sold-comp triangulation, for the six EN Mega-era sets (Phantasmal Flames, Pitch Black, Ascended Heroes, Mega Evolution base, Perfect Order, Chaos Rising).

Core formula: P(≥1 hit) = 1 − (1−p)^n, applied wherever a rate and a pack/box count are both known. No sourced model → estimated and flagged EST. Sources disagree → both shown, flagged CONFLICT. All prices dated at collection; re-verify before buying.

## Sources

- theexpectedvalue.com — /collector-ev/fin, /collector-ev/tla, /pokemon/ev/scarlet-violet/pre, /pokemon/ev/mega-evolutions/me05, /pokemon/ev/sword-shield/swsh07-box, plus per-set calculators for the six EN Mega-era sets (Phantasmal Flames, Pitch Black, Ascended Heroes, Mega Evolution base, Perfect Order, Chaos Rising)
- 130point.com (eBay sold-comp triangulation, 8/14–15); pokemonpricetracker.com (Phantasmal Flames MCX pricing, 8/14); thetoploader (Destined Rivals pull-rate triangulation)
- tcgtrading.cards/one-piece-tcg/sets/{op09,op13,op16}/box-ev
- tcgtalk.com/guides/ — surging-sparks-pack-opening-value-guide, prismatic-evolutions-…, ascended-heroes-…, phantasmal-flames-…, pitch-black-…, destined-rivals-…, black-bolt-…, freedom-ascension-pull-rates (Gundam), one-piece-tcg-box-pull-rates
- pittpokeresearch.com/pokemon-set/{Evolving-Skies, Surging-Sparks, Destined-Rivals, Pitch-Black, Phantasmal-Flames, Ascended-Heroes, Chaos-Rising, Perfect-Order, Mega-Evolution, Black-Bolt}
- pullrates.com/set/{crown-zenith, prismatic-evolutions}; pullmarket.io (151, Optic Football avg pulls $130–410)
- cardchill.com (MEGA Dream ex EV article); thetrainercourt.com (JP hit-rate/god-pack table, updated 8/7/26); rippr.app (Terastal god-pack economics)
- waxstat.com (Quarter Century Bonanza, Chaos Origins, Glorious Gallery, Topps Chrome Basketball, Prizm Football, 2026 Topps Chrome MLB); tcgindex.io (Yu-Gi-Oh); playpeak.eu (Yu-Gi-Oh boxes, 7/1/26)
- PriceCharting (OP09-118 Roger, OP13-118 Luffy, Lorcana Ariel #241, Riftbound Vendetta, Gundam GD05, Star Wars Unlimited, Surging Sparks Pikachu 238, Prismatic Umbreon 161, 151 Charizard 199)
- checklistinsider.com (sports configs/prices); sportscardspro.com (rookie comps); StockX/Steel City (National Treasures Basketball)
- MTGRocks (Final Fantasy price-spike, 7/13/26); mtgstocks (Final Fantasy sealed data); Wizards of the Coast collecting articles (Final Fantasy/Avatar TLA/Hobbit official odds & configurations); Draftsim/CGC (serialized comps)
- fujicardshop.com, collectorstore.com, eBay sold-listing volumes (JP boxes); blog.onemall.jp (Clefairy/Charizard VSTAR PSA10 series); snkrdunk.com and pokebeach.com (Storm Emeralda); Bulbapedia (configurations, set mapping, Celebrations mechanic)
- Licensing: Sportico (WNBA), Fanatics/SI (Topps NBA), Athlon/Yahoo/Cardboard Connection (Panini NFL license end, 3/31/26)

## Appendix: the brief this report executes

This report was produced against the following analyst brief:

> "You are a collectibles-market analyst. Identify the sealed trading-card boxes — any game or sport — purchasable today for ≤$5,000/box that give the highest probability that one box's pulls resell for more than the box costs. Scope: English & Japanese Pokémon, One Piece, MTG, Yu-Gi-Oh!, Lorcana and other active TCGs, and sports cards. Price from current sold listings (Aug 2026), never MSRP or asking prices; date every price. For every candidate: sealed price + configuration; chase cards that alone exceed box price (raw and PSA 10); pull rates with sources and sample sizes (label estimates); explicit math — P(≥1 card ≥ box price) = 1−(1−p)^n and whole-box EV ratio, gross and net of ~13% fees; assumptions + confidence grade. Output: ranked table by P(box pays for itself), top picks, boxes to avoid, honest risk section. If nothing is +EV at market price, say so and identify what gets closest and the conditions (e.g., MSRP restocks) under which the math flips."
