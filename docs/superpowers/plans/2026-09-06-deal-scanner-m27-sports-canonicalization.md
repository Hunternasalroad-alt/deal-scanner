# M2.7 Sports Card Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sports cards a canonical identity — (game, "<year> <set>", card number, player, variant) — parsed deterministically from listing titles, so duplicate physical cards merge, peers appear, and sports deals can score and rank.

**Architecture:** A pure parser module (`src/lib/sportsIdentity.ts`) classifies every title token against curated dictionaries (brand/set phrases, parallel/insert terms, teams, junk) and yields the identity fields. `match.ts`'s sports branch consumes it (the raw title travels on `Accepted.title`). The CSV importer canonicalizes sports rows through the same helpers. A re-identification module + CLI re-parses existing sports listings and re-points listings/comps to canonical cards. Peer/feed clone collapse already shipped (commit adbc5cd) and is out of this plan.

**Tech Stack:** TypeScript 6.0.3 (pinned), vitest + PGlite, Drizzle, Neon HTTP.

**Spec:** `docs/superpowers/specs/2026-08-15-card-deal-scanner-design.md` — §17 governs (items 3–4 pre-shipped); §16.5 superseded where stated.

## Global Constraints

- TypeScript pinned 6.0.3, ESLint 9.39.5 — never touch versions.
- Full suite (currently 113 tests) + `pnpm lint` + `pnpm exec tsc --noEmit` green at the END of every task. PGlite cold-start timeouts are a known environmental flake: on a timeout failure re-run `pnpm exec vitest run --testTimeout=30000` and report both runs. Delete any `tsconfig.tsbuildinfo` before committing.
- Bare `.returning()` only on the Db union; Neon HTTP has no transactions.
- Pokémon matching is untouched: `usableTokens`, `STOP_TOKENS`, and the `game === "pokemon"` branch of `matchListing` must be byte-identical after this plan.
- The corpus expectations in Task 1 are the binding contract. If an implementer believes an expectation contradicts the parsing rules, they REPORT it (status DONE_WITH_CONCERNS) — they never edit an expectation to make a test pass.
- DO NOT modify: `src/lib/sweeps.ts`, `src/lib/reference.ts`, `src/lib/scan.ts`, `src/lib/prune.ts`, `src/app/**`, `src/db/schema.ts`, `.github/workflows/*`.
- Commit at the end of each task with the given message; never push.

## File Structure

- `src/lib/sportsIdentity.ts` (new) — dictionaries + `parseSportsTitle` + `canonicalSet`/`canonicalPlayer` helpers. Pure.
- `src/lib/normalize.ts` — `Accepted` gains `title: string` (Task 2).
- `src/lib/match.ts` — sports branch rewritten on the parser (Task 2).
- `src/lib/importCompsDb.ts` — sports rows canonicalized before find/create (Task 2).
- `src/lib/reidentify.ts` (new) + `scripts/reidentify-sports.ts` (new) — backfill logic + CLI (Task 3).
- Tests: `tests/sportsIdentity.test.ts` (new), `tests/match.test.ts`, `tests/importComps.test.ts`, `tests/reidentify.test.ts` (new).

---

### Task 1: The parser — `src/lib/sportsIdentity.ts` + corpus tests

**Files:**
- Create: `src/lib/sportsIdentity.ts`
- Test: `tests/sportsIdentity.test.ts` (new; pure, no DB)

**Interfaces:**
- Produces (exact):
  - `type SportsIdentity = { year: number | null; set: string; cardNumber: string; player: string; variant: string }`
  - `parseSportsTitle(title: string): SportsIdentity | null` — null when no player or no card number survives. `variant` lists parallel/insert terms in canonical (case-insensitive sorted) order with the serial `/N` last, so word order in titles never forks an identity.
  - `canonicalSet(text: string): string` — maps free text like "prizm" / "Panini Prizm" / "PANINI PRIZM" to the canonical phrase (`"Panini Prizm"`); unknown text is title-cased as-is.
  - `canonicalPlayer(text: string): string` — the same name normalization the parser applies (title-case preserving apostrophes/hyphens, e.g. `"shaquille o'neal"` → `"Shaquille O'Neal"`).
  - `setLabel(year: number | null, set: string): string` — `"2019 Panini Prizm"`, or `"2019"` when set is empty, or the set alone when year is null.

- [ ] **Step 1: Write the failing corpus tests**

Create `tests/sportsIdentity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalPlayer, canonicalSet, parseSportsTitle, setLabel } from "@/lib/sportsIdentity";

type Exp = { year: number | null; set: string; cardNumber: string; player: string; variant: string };
const corpus: [string, Exp][] = [
  ["1993 Upper Deck Michael Jordan #23 PSA 9 MINT Bulls NBA HOF GOAT Clean Case",
    { year: 1993, set: "Upper Deck", cardNumber: "23", player: "Michael Jordan", variant: "" }],
  ["2024 Finest Jasson Dominguez #267 RC Purple Refractor -101/125 PSA 10 GEM MINT!",
    { year: 2024, set: "Topps Finest", cardNumber: "267", player: "Jasson Dominguez", variant: "Purple Refractor /125" }],
  ["2026 TOPPS LIVING #11 COOPER FLAGG PSA 10",
    { year: 2026, set: "Topps Living", cardNumber: "11", player: "Cooper Flagg", variant: "" }],
  ["1992 Topps Stadium Club Shaquille O'Neal PSA 10 RC Magic #247",
    { year: 1992, set: "Topps Stadium Club", cardNumber: "247", player: "Shaquille O'Neal", variant: "" }],
  ["2019-20 Panini Select Concourse Silver Prizm Shai Gilgeous-Alexander #81 PSA 9",
    { year: 2019, set: "Panini Select", cardNumber: "81", player: "Shai Gilgeous-Alexander", variant: "Concourse Prizm Silver" }],
  ["2022 Panini Prizm Amon-Ra St. Brown #98 Red Sparkle BGS 9.5",
    { year: 2022, set: "Panini Prizm", cardNumber: "98", player: "Amon-Ra St Brown", variant: "Red Sparkle" }],
  ["STEPHEN CURRY PSA 10 2024 PANINI PRIZM BLACK #7 COLOR BLAST WARRIORS SP GEM 6625",
    { year: 2024, set: "Panini Prizm", cardNumber: "7", player: "Stephen Curry", variant: "Black Color Blast SP" }],
  ["Zion Williamson PSA 10 2019-20 Panini Select #1 Concourse RC Rookie Card",
    { year: 2019, set: "Panini Select", cardNumber: "1", player: "Zion Williamson", variant: "Concourse" }],
  ["1989-90 Hoops 200 Michael Jordan PSA 9",
    { year: 1989, set: "NBA Hoops", cardNumber: "200", player: "Michael Jordan", variant: "" }],
  ["1996-97 Stadium Club Members Only 55 Allen Iverson RC ROOKIE PSA 9 Graded Card",
    { year: 1996, set: "Topps Stadium Club", cardNumber: "55", player: "Allen Iverson", variant: "Members Only" }],
  ["2021 Topps Gold Foil Casey Mize #321 PSA 9 MINT Rookie RC g6p",
    { year: 2021, set: "Topps", cardNumber: "321", player: "Casey Mize", variant: "Gold Foil" }],
  ["2003 Topps Chrome Udonis Haslem Refractor #164 PSA 10 Gem Mint Rookie Miami Heat",
    { year: 2003, set: "Topps Chrome", cardNumber: "164", player: "Udonis Haslem", variant: "Refractor" }],
  ["2019 Panini Contenders Optic N'Keal Harry #132 PSA 10 GEM MT Rookie Auto RC 14do",
    { year: 2019, set: "Panini Contenders Optic", cardNumber: "132", player: "N'Keal Harry", variant: "Auto" }],
  ["2024 Panini Prizm WNBA Caitlin Clark #22 PSA 10 RC Rookie Card Fever",
    { year: 2024, set: "Panini Prizm", cardNumber: "22", player: "Caitlin Clark", variant: "" }],
  ["2025 PANINI PRIZM WNBA SILVER PRIZM #148 SONIA CITRON SGC 9.5💥",
    { year: 2025, set: "Panini Prizm", cardNumber: "148", player: "Sonia Citron", variant: "Prizm Silver" }],
  ["2017 TOPPS CHROME #169 AARON JUDGE ROOKIE RC PSA 10 GEM",
    { year: 2017, set: "Topps Chrome", cardNumber: "169", player: "Aaron Judge", variant: "" }],
  ["1961 Fleer Baseball #126 Iron Man McGinnity PSA 8",
    { year: 1961, set: "Fleer", cardNumber: "126", player: "Iron Man Mcginnity", variant: "" }],
  ["1970 Topps Willie Mays #600 PSA 6",
    { year: 1970, set: "Topps", cardNumber: "600", player: "Willie Mays", variant: "" }],
  ["1991 Score - Bo Jackson #5 PSA 9 Kansas City Royals Graded Baseball Card",
    { year: 1991, set: "Score", cardNumber: "5", player: "Bo Jackson", variant: "" }],
  ["2018 Panini Prizm Deandre Ayton #279 PSA9",
    { year: 2018, set: "Panini Prizm", cardNumber: "279", player: "Deandre Ayton", variant: "" }],
  ["2019 PANINI PRIZM BLUE SHIMMER #122 SHAI GILGEOUS-ALEXANDER PSA 10",
    { year: 2019, set: "Panini Prizm", cardNumber: "122", player: "Shai Gilgeous-Alexander", variant: "Blue Shimmer" }],
  ["Topps Chrome 2003-04 LeBron James Rookie #111 Cavaliers BGS 9.5 ",
    { year: 2003, set: "Topps Chrome", cardNumber: "111", player: "Lebron James", variant: "" }],
  ["2009-10 Upper Deck Draft Edition Stephen Curry Rookie RC #34 PSA 10 GEM MINT",
    { year: 2009, set: "Upper Deck", cardNumber: "34", player: "Stephen Curry", variant: "Draft Edition" }],
  ["2024 BOWMAN DRAFT CHROME #BDC22 KONNOR GRIFFIN PSA 9",
    { year: 2024, set: "Bowman Draft", cardNumber: "BDC22", player: "Konnor Griffin", variant: "Chrome" }],
  ["John Gil 2025 Bowman Chrome AUTO PSA 10 GEM ORANGE REFRACTOR /25 #BCP-172 Braves",
    { year: 2025, set: "Bowman Chrome", cardNumber: "BCP-172", player: "John Gil", variant: "Auto Orange Refractor /25" }],
  ["2025 TOPPS CHROME RAYWAVE #99 AARON JUDGE PSA 9",
    { year: 2025, set: "Topps Chrome", cardNumber: "99", player: "Aaron Judge", variant: "Raywave" }],
  ["TOM BRADY 2000 BLACK DIAMOND #126 ROOKIE PATRIOTS BGS 8.5 RC NM-MT+",
    { year: 2000, set: "Black Diamond", cardNumber: "126", player: "Tom Brady", variant: "" }],
  ["PSA 5 1986-87 Fleer - Jeff Malone #67 (RC)",
    { year: 1986, set: "Fleer", cardNumber: "67", player: "Jeff Malone", variant: "" }],
  ["2023 Zenith Jahmyr Gibbs Lions RPA Sparkle #48/50  PSA 8",
    { year: 2023, set: "Panini Zenith", cardNumber: "48", player: "Jahmyr Gibbs", variant: "RPA Sparkle /50" }],
  ["Panini 2020-21 Contenders Draft Class LaMelo Ball Rookie #25 SGC 9.5",
    { year: 2020, set: "Panini Contenders", cardNumber: "25", player: "Lamelo Ball", variant: "Draft Class" }],
  ["2022 PANINI ORIGINS 21 ANTHONY EDWARDS ORANGE /75 PSA 9!!!",
    { year: 2022, set: "Panini Origins", cardNumber: "21", player: "Anthony Edwards", variant: "Orange /75" }],
  ["1981 Kellogg's 3-D Super Stars Pete Rose #63 PSA 8 1c0k",
    { year: 1981, set: "Kellogg's", cardNumber: "63", player: "Pete Rose", variant: "" }],
];

describe("parseSportsTitle corpus", () => {
  for (const [title, exp] of corpus) {
    it(title, () => expect(parseSportsTitle(title)).toEqual(exp));
  }

  it("returns null without a player", () => {
    expect(parseSportsTitle("2024 Panini Prizm #22 PSA 10 RC Rookie Card")).toBeNull();
  });
  it("returns null without a card number", () => {
    expect(parseSportsTitle("2020 Panini Mosaic Lamelo Ball Rookie Auto Mosaic PSA 10")).toBeNull();
  });
  it("a serial print-run is never the card number", () => {
    expect(parseSportsTitle("2022 Panini Prizm Keegan Murray Rookie Purple Prizm /99 PSA 10 Color Match")).toBeNull();
  });
  it("is idempotent on its own output", () => {
    const p = parseSportsTitle("2019-20 Panini Select Concourse Silver Prizm Shai Gilgeous-Alexander #81 PSA 9")!;
    const again = parseSportsTitle(`${p.year} ${p.set} ${p.variant} ${p.player} #${p.cardNumber}`)!;
    expect(again).toEqual(p);
  });
});

describe("helpers", () => {
  it("canonicalSet maps aliases and title-cases unknowns", () => {
    expect(canonicalSet("prizm")).toBe("Panini Prizm");
    expect(canonicalSet("PANINI PRIZM")).toBe("Panini Prizm");
    expect(canonicalSet("optic")).toBe("Donruss Optic");
    expect(canonicalSet("hoops")).toBe("NBA Hoops");
    expect(canonicalSet("my weird set")).toBe("My Weird Set");
  });
  it("canonicalPlayer preserves apostrophes and hyphens", () => {
    expect(canonicalPlayer("shaquille o'neal")).toBe("Shaquille O'Neal");
    expect(canonicalPlayer("SHAI GILGEOUS-ALEXANDER")).toBe("Shai Gilgeous-Alexander");
  });
  it("setLabel composes year and set", () => {
    expect(setLabel(2019, "Panini Prizm")).toBe("2019 Panini Prizm");
    expect(setLabel(2019, "")).toBe("2019");
    expect(setLabel(null, "Fleer")).toBe("Fleer");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/sportsIdentity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sportsIdentity.ts`**

```ts
// spec §17.1-2: deterministic sports card identity from a listing title.
// Every token is classified against curated dictionaries; what survives is
// the player name. Pure and $0 — no network, no catalog. Mainstream modern
// sets parse well; oddball/vintage titles stay honest singletons (§17.7).

export type SportsIdentity = { year: number | null; set: string; cardNumber: string; player: string; variant: string };

// --- Dictionaries -----------------------------------------------------------
// Brand/set phrases, lowercased. Longer phrases are matched before shorter
// ones. Value = canonical display form. Single-word aliases resolve to the
// full brand line ("prizm" is Panini's; "chrome" alone means Topps Chrome).
const SET_PHRASES: Record<string, string> = {
  "topps chrome sapphire": "Topps Chrome Sapphire", "topps chrome black": "Topps Chrome Black",
  "topps cosmic chrome": "Topps Cosmic Chrome", "topps stadium club": "Topps Stadium Club",
  "stadium club": "Topps Stadium Club", "topps chrome": "Topps Chrome", "topps finest": "Topps Finest",
  "topps living": "Topps Living", "topps heritage": "Topps Heritage", "topps archives": "Topps Archives",
  "topps gallery": "Topps Gallery", "topps fire": "Topps Fire", "topps update": "Topps Update",
  "update series": "Topps Update", "topps series 1": "Topps", "topps series 2": "Topps", "series 1": "Topps",
  "series 2": "Topps", "topps big league": "Topps Big League", "big league": "Topps Big League",
  "topps museum collection": "Topps Museum Collection", "museum collection": "Topps Museum Collection",
  "topps tribute": "Topps Tribute", "topps definitive": "Topps Definitive", "topps dynasty": "Topps Dynasty",
  "topps tier one": "Topps Tier One", "topps five star": "Topps Five Star", "topps triple threads": "Topps Triple Threads",
  "topps inception": "Topps Inception", "topps now": "Topps Now", "topps opening day": "Topps Opening Day",
  "topps gypsy queen": "Topps Gypsy Queen", "gypsy queen": "Topps Gypsy Queen", "allen & ginter": "Allen & Ginter",
  "allen and ginter": "Allen & Ginter", "topps pristine": "Topps Pristine", "topps gold label": "Topps Gold Label",
  "topps holiday": "Topps Holiday", "topps": "Topps", "finest": "Topps Finest", "chrome": "Topps Chrome",
  "heritage": "Topps Heritage", "living": "Topps Living",
  "bowman chrome": "Bowman Chrome", "bowman draft": "Bowman Draft", "bowman sterling": "Bowman Sterling",
  "bowman's best": "Bowman's Best", "bowmans best": "Bowman's Best", "bowman u": "Bowman University",
  "bowman university": "Bowman University", "bowman platinum": "Bowman Platinum", "bowman": "Bowman",
  "panini prizm": "Panini Prizm", "panini select": "Panini Select", "panini mosaic": "Panini Mosaic",
  "panini donruss optic": "Donruss Optic", "donruss optic": "Donruss Optic", "panini donruss": "Donruss",
  "donruss": "Donruss", "panini contenders optic": "Panini Contenders Optic", "contenders optic": "Panini Contenders Optic",
  "panini contenders": "Panini Contenders", "contenders": "Panini Contenders", "national treasures": "National Treasures",
  "panini national treasures": "National Treasures", "panini immaculate": "Panini Immaculate", "immaculate": "Panini Immaculate",
  "panini flawless": "Panini Flawless", "flawless": "Panini Flawless", "panini spectra": "Panini Spectra", "spectra": "Panini Spectra",
  "panini obsidian": "Panini Obsidian", "obsidian": "Panini Obsidian", "panini origins": "Panini Origins", "origins": "Panini Origins",
  "panini chronicles": "Panini Chronicles", "chronicles": "Panini Chronicles", "panini absolute": "Panini Absolute", "absolute": "Panini Absolute",
  "panini certified": "Panini Certified", "certified": "Panini Certified", "panini phoenix": "Panini Phoenix",
  "panini revolution": "Panini Revolution", "revolution": "Panini Revolution", "panini illusions": "Panini Illusions", "illusions": "Panini Illusions",
  "panini court kings": "Panini Court Kings", "court kings": "Panini Court Kings", "panini crown royale": "Panini Crown Royale",
  "crown royale": "Panini Crown Royale", "panini one and one": "Panini One and One", "one and one": "Panini One and One",
  "panini noir": "Panini Noir", "noir": "Panini Noir", "panini zenith": "Panini Zenith", "zenith": "Panini Zenith",
  "panini elite": "Panini Elite", "panini playoff": "Panini Playoff", "panini instant": "Panini Instant", "instant": "Panini Instant",
  "panini photogenic": "Panini Photogenic", "photogenic": "Panini Photogenic", "panini flux": "Panini Flux", "flux": "Panini Flux",
  "panini prestige": "Panini Prestige", "prestige": "Panini Prestige", "rookies & stars": "Panini Rookies & Stars",
  "rookies and stars": "Panini Rookies & Stars", "panini hoops": "NBA Hoops", "nba hoops": "NBA Hoops", "hoops": "NBA Hoops",
  "panini select draft picks": "Panini Select Draft Picks", "select draft picks": "Panini Select Draft Picks",
  "prizm draft picks": "Panini Prizm Draft Picks", "panini": "Panini", "prizm": "Panini Prizm", "select": "Panini Select",
  "mosaic": "Panini Mosaic", "optic": "Donruss Optic",
  "upper deck": "Upper Deck", "ud": "Upper Deck", "ud encore": "Upper Deck Encore", "sp authentic": "SP Authentic",
  "black diamond": "Black Diamond", "fleer ultra": "Fleer Ultra", "fleer": "Fleer", "skybox": "SkyBox", "score": "Score",
  "leaf": "Leaf", "pacific": "Pacific", "kellogg's": "Kellogg's", "kelloggs": "Kellogg's", "goudey": "Goudey",
  "o-pee-chee": "O-Pee-Chee", "opc": "O-Pee-Chee",
};

// Parallel / insert / autograph vocabulary. Lowercased; multi-word first.
// Value = canonical display form. These become the `variant`.
const VARIANT_PHRASES: Record<string, string> = {
  "cracked ice": "Cracked Ice", "color blast": "Color Blast", "stained glass": "Stained Glass", "case hit": "Case Hit",
  "image variation": "Image Variation", "photo variation": "Photo Variation", "short print": "SP", "premier level": "Premier Level",
  "club level": "Club Level", "field level": "Field Level", "tie-dye": "Tie-Dye", "tie dye": "Tie-Dye", "fast break": "Fast Break",
  "neon green": "Neon Green", "neon pink": "Neon Pink", "neon orange": "Neon Orange", "gold foil": "Gold Foil",
  "rated rookie": "", "draft edition": "Draft Edition", "draft class": "Draft Class", "members only": "Members Only",
  "refractor": "Refractor", "x-fractor": "X-Fractor", "xfractor": "X-Fractor", "raywave": "Raywave", "prizm": "Prizm",
  "silver": "Silver", "gold": "Gold", "blue": "Blue", "red": "Red", "green": "Green", "orange": "Orange", "purple": "Purple",
  "pink": "Pink", "black": "Black", "white": "White", "bronze": "Bronze", "teal": "Teal", "aqua": "Aqua", "sepia": "Sepia",
  "wave": "Wave", "shimmer": "Shimmer", "mojo": "Mojo", "disco": "Disco", "hyper": "Hyper", "ice": "Ice", "holo": "Holo",
  "holofoil": "Holo", "foil": "Foil", "negative": "Negative", "camo": "Camo", "snakeskin": "Snakeskin", "scope": "Scope",
  "pulsar": "Pulsar", "choice": "Choice", "nebula": "Nebula", "velocity": "Velocity", "reactive": "Reactive", "lazer": "Lazer",
  "laser": "Lazer", "marble": "Marble", "genesis": "Genesis", "concourse": "Concourse", "courtside": "Courtside",
  "interstellar": "Interstellar", "atomic": "Atomic", "speckle": "Speckle", "sparkle": "Sparkle", "flash": "Flash",
  "splat": "Splat", "chrome": "Chrome", "sapphire": "Sapphire", "kaboom": "Kaboom", "downtown": "Downtown",
  "auto": "Auto", "autograph": "Auto", "autographs": "Auto", "autographed": "Auto", "signed": "Auto", "rpa": "RPA",
  "patch": "Patch", "jersey": "Jersey", "relic": "Relic", "relics": "Relic", "memorabilia": "Relic", "mem": "Relic",
  "sp": "SP", "ssp": "SSP", "variation": "Variation", "1st": "1st", "die-cut": "Die-Cut", "die cut": "Die-Cut",
};

const TEAM_PHRASES = [
  // MLB
  "arizona diamondbacks","diamondbacks","atlanta braves","braves","baltimore orioles","orioles","boston red sox","red sox",
  "chicago cubs","cubs","chicago white sox","white sox","cincinnati reds","reds","cleveland guardians","guardians","indians",
  "colorado rockies","rockies","detroit tigers","tigers","houston astros","astros","kansas city royals","royals",
  "los angeles angels","angels","los angeles dodgers","dodgers","miami marlins","marlins","milwaukee brewers","brewers",
  "minnesota twins","twins","new york mets","mets","new york yankees","yankees","oakland athletics","athletics","a's",
  "philadelphia phillies","phillies","pittsburgh pirates","pirates","san diego padres","padres","san francisco giants",
  "seattle mariners","mariners","st. louis cardinals","st louis cardinals","cardinals","tampa bay rays","rays",
  "texas rangers","rangers","toronto blue jays","blue jays","washington nationals","nationals",
  // NBA
  "atlanta hawks","hawks","boston celtics","celtics","brooklyn nets","nets","charlotte hornets","hornets","chicago bulls","bulls",
  "cleveland cavaliers","cavaliers","cavs","dallas mavericks","mavericks","mavs","denver nuggets","nuggets","detroit pistons","pistons",
  "golden state warriors","warriors","houston rockets","rockets","indiana pacers","pacers","los angeles clippers","clippers",
  "los angeles lakers","lakers","memphis grizzlies","grizzlies","miami heat","heat","milwaukee bucks","bucks","minnesota timberwolves",
  "timberwolves","wolves","new orleans pelicans","pelicans","new york knicks","knicks","oklahoma city thunder","thunder","orlando magic",
  "magic","philadelphia 76ers","76ers","sixers","phoenix suns","suns","portland trail blazers","trail blazers","blazers",
  "sacramento kings","kings","san antonio spurs","spurs","toronto raptors","raptors","utah jazz","jazz","washington wizards","wizards",
  // NFL
  "arizona cardinals","atlanta falcons","falcons","baltimore ravens","ravens","buffalo bills","bills","carolina panthers","panthers",
  "chicago bears","bears","cincinnati bengals","bengals","cleveland browns","browns","dallas cowboys","cowboys","denver broncos","broncos",
  "detroit lions","lions","green bay packers","packers","houston texans","texans","indianapolis colts","colts","jacksonville jaguars",
  "jaguars","kansas city chiefs","chiefs","las vegas raiders","raiders","los angeles chargers","chargers","los angeles rams","rams",
  "miami dolphins","dolphins","minnesota vikings","vikings","new england patriots","patriots","new orleans saints","saints",
  "new york giants","giants","new york jets","jets","philadelphia eagles","eagles","pittsburgh steelers","steelers",
  "san francisco 49ers","49ers","niners","seattle seahawks","seahawks","tampa bay buccaneers","buccaneers","bucs",
  "tennessee titans","titans","washington commanders","commanders",
  // WNBA
  "indiana fever","fever","new york liberty","liberty","las vegas aces","aces","seattle storm","storm","minnesota lynx","lynx",
  "connecticut sun","sun","phoenix mercury","mercury","chicago sky","sky","dallas wings","wings","atlanta dream","dream",
  "washington mystics","mystics","los angeles sparks","sparks","golden state valkyries","valkyries",
  // cities that appear alone
  "los angeles","new york","kansas city","san francisco","golden state","oklahoma city","san antonio","new orleans","green bay",
  "tampa bay","las vegas","new england","st. louis","st louis","miami","chicago","boston","dallas","denver","detroit","houston",
  "atlanta","baltimore","cleveland","milwaukee","minnesota","philadelphia","phoenix","pittsburgh","portland","sacramento","seattle",
  "toronto","utah","washington","brooklyn","charlotte","indiana","memphis","orlando","cincinnati","arizona","colorado","texas",
  "florida","carolina","buffalo","jacksonville","tennessee","nyg","nyk","nyy","lal","gsw",
];

// Tokens that carry no identity. Lowercased.
const JUNK = new Set([
  "rc","rookie","rookies","hof","goat","mint","gem","mt","nm","nm-mt","nm-mt+","pop","low","invest","hot","fire","rare","clean",
  "case","graded","card","cards","slab","slabbed","nba","nfl","mlb","wnba","football","basketball","baseball","qb","rb","wr","te",
  "pg","sg","sf","pf","read","look","wow","only","made","set","bio","psa","bgs","sgc","cgc","beckett","authentic","auth",
  "gem-mt","gem-mint","pristine","prospect","prospects","online","exclusive","on","demand","w","with","coating","the","of","and",
  "new","in","hand","ships","fast","free","shipping","lot","x","pick","your","player","legend","legends","star","stars","super",
  "great","greats","future","insert","base","parallel","numbered","serial","print","run","edition","limited","le","cert","certified",
  "sealed","raw","grade","grades","graded","nice","beautiful","perfect","centering","centered","sharp","corners","see","pics","pic",
  "photo","photos","as","is","no","reserve","bid","bin","obo","hobby","retail","pack","fresh","pulled","freshly","investment",
]);

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
const PARTICLES = new Set(["st.", "st", "de", "la", "van", "von", "del", "da", "di", "le", "mc"]);

// --- Helpers ----------------------------------------------------------------
const titleCaseWord = (w: string) =>
  w.toLowerCase().replace(/(^|['-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());

export const canonicalPlayer = (text: string) => text.trim().split(/\s+/).filter(Boolean).map(titleCaseWord).join(" ");

export function canonicalSet(text: string): string {
  const key = text.trim().toLowerCase().replace(/\s+/g, " ");
  return SET_PHRASES[key] ?? canonicalPlayer(key);
}

export const setLabel = (year: number | null, set: string) =>
  year === null ? set : set === "" ? String(year) : `${year} ${set}`;

// Longest-first phrase matcher over a token array. Returns [startIndex, length, value].
function matchPhrase(tokens: string[], i: number, dict: Record<string, string> | Set<string>, maxLen = 4): [number, string] | null {
  for (let len = Math.min(maxLen, tokens.length - i); len >= 1; len--) {
    const phrase = tokens.slice(i, i + len).join(" ");
    if (dict instanceof Set) { if (dict.has(phrase)) return [len, phrase]; }
    else if (phrase in dict) return [len, dict[phrase]];
  }
  return null;
}

const TEAMS = new Set(TEAM_PHRASES);
const GRADE_RX = /\b(psa|bgs|sgc|cgc|beckett|bvg)\s*[-:]?\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4|3|2|1|authentic|auth)?\b/gi;
const GRADE_WORDS_RX = /\b(gem\s*mint|gem\s*mt|nm-mt\+?|pop\s*\d+|low\s*pop)\b/gi;

// --- Parser -----------------------------------------------------------------
export function parseSportsTitle(rawTitle: string): SportsIdentity | null {
  let title = ` ${rawTitle} `.replace(GRADE_RX, " ").replace(GRADE_WORDS_RX, " ");

  // Year: first 19xx/20xx, optionally a season range ("2019-20").
  const yearM = /\b(19[0-9]\d|20[0-2]\d)(?:-\d{2})?\b/.exec(title);
  const year = yearM ? Number(yearM[1]) : null;
  if (yearM) title = title.replace(yearM[0], " ");

  // Card number: "#"-prefixed wins. Keep letters/digits/hyphen; drop a trailing serial ("#48/50" → 48, serial /50).
  let cardNumber: string | null = null;
  const hashM = /#\s?([A-Za-z0-9][A-Za-z0-9-]{0,9})/.exec(title);
  if (hashM) { cardNumber = hashM[1].toUpperCase().replace(/-$/, ""); title = title.replace(hashM[0], " "); }

  // Serial print run: N/M → variant suffix "/M". Never a card number (spec §16.5c heritage).
  let serial: string | null = null;
  // Accepts "101/125", "-101/125", "#48/50" (after the hash consumed "48"), and a bare "/25".
  const serialM = /(?:\b(\d{1,4})\s*)?\/\s*(\d{1,4})\b/.exec(title);
  if (serialM) { serial = `/${serialM[2]}`; title = title.replace(serialM[0], " "); }

  // Tokenize: keep letters, digits, apostrophes, hyphens, periods, ampersands.
  const rawTokens = title.replace(/[^A-Za-z0-9'\-.&\s]/g, " ").split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map((t) => t.toLowerCase().replace(/^[-.]+|[-.]+$/g, "")).filter(Boolean);

  let set = "";
  const variantParts: string[] = [];
  const residue: { tok: string; pos: number }[] = [];

  for (let i = 0; i < tokens.length; ) {
    const setHit = set === "" ? matchPhrase(tokens, i, SET_PHRASES) : null;
    if (setHit) { set = setHit[1]; i += setHit[0]; continue; }
    const varHit = matchPhrase(tokens, i, VARIANT_PHRASES);
    if (varHit) { if (varHit[1] !== "") variantParts.push(varHit[1]); i += varHit[0]; continue; }
    const teamHit = matchPhrase(tokens, i, TEAMS);
    if (teamHit) { i += teamHit[0]; continue; }
    const t = tokens[i];
    if (JUNK.has(t)) { i++; continue; }
    if (/\d/.test(t)) {
      // Bare-number rule: a standalone 1-3 digit integer becomes the card number
      // when nothing else claimed it. Anything else containing a digit is junk
      // (seller SKUs like g6p/0e2x, 4-digit non-years, "3-d").
      if (cardNumber === null && /^\d{1,3}$/.test(t)) cardNumber = t;
      i++; continue;
    }
    if (t === "&" || t.length === 1) { i++; continue; }
    residue.push({ tok: t, pos: i });
    i++;
  }

  if (cardNumber === null || residue.length === 0) return null;

  // Player: the longest contiguous run of residue tokens; within it, the last
  // two tokens, extended to three when a suffix (Jr) or particle (St., de)
  // sits in the name. Brand → subset words → player is the dominant title
  // order, so the player is the run's tail.
  const runs: string[][] = [];
  for (const r of residue) {
    const last = runs[runs.length - 1];
    const prevPos = last ? residue[residue.indexOf(residue.find((x) => x.tok === last[last.length - 1] && x.pos === (residue.filter((y) => last.includes(y.tok)).pop()?.pos ?? -1))!)]?.pos : -2;
    if (last && r.pos === prevPos + 1) last.push(r.tok); else runs.push([r.tok]);
  }
  const run = runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0]);
  let nameTokens = run.length <= 3 ? run : run.slice(-2);
  if (run.length > 3) {
    const [a, b] = nameTokens;
    if (SUFFIXES.has(b) || PARTICLES.has(a)) nameTokens = run.slice(-3);
  }

  // Canonical order: parallel/insert terms sorted case-insensitively, serial last —
  // "Silver Prizm Concourse" and "Concourse Silver Prizm" must be one identity.
  const sortedParts = [...new Set(variantParts)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const variant = [...sortedParts, ...(serial ? [serial] : [])].join(" ").trim();
  return { year, set, cardNumber, player: canonicalPlayer(nameTokens.join(" ")), variant };
}
```

NOTE for the implementer: the contiguous-run builder above is written for clarity of intent, not elegance — replace its `prevPos` computation with a plain index walk (track the previous residue entry's `pos` in a local variable) while preserving the semantics: consecutive `pos` values extend the current run. Everything else is exact.

- [ ] **Step 4: Run the corpus; iterate ONLY on code**

Run: `pnpm exec vitest run tests/sportsIdentity.test.ts`
Expected: all corpus cases pass. Fix the parser (dictionaries, token rules, run logic) until they do. If a corpus expectation genuinely contradicts §17's rules, do not edit it — report it.

- [ ] **Step 5: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green (this task adds no consumers; nothing else changes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sportsIdentity.ts tests/sportsIdentity.test.ts
git commit -m "feat: deterministic sports card identity parser + corpus (spec §17.1-2)"
```

---

### Task 2: Integrate the parser — Accepted.title, match.ts sports branch, importer canonical join

**Files:**
- Modify: `src/lib/normalize.ts` (`Accepted` gains `title`), `src/lib/match.ts` (sports branch), `src/lib/importCompsDb.ts` (sports rows canonicalized)
- Test: `tests/match.test.ts`, `tests/importComps.test.ts`

**Interfaces:**
- Consumes (Task 1, exact): `parseSportsTitle`, `canonicalSet`, `canonicalPlayer`, `setLabel`.
- Produces: `Accepted.title: string` (the raw eBay title); `matchListing(db, game, n)` signature unchanged; sports identity now `{ game, setName: setLabel(year, set), cardNumber, name: player, variant, year }`.

- [ ] **Step 1: `Accepted.title`**

In `src/lib/normalize.ts`: add `title: string;` to the `Accepted` type (first field after `kind`), and `title,` to the accepted return object (the local `title` const already exists). Update the `acc()` fixture in `tests/match.test.ts` to `const acc = (over: Partial<Accepted["titleFacts"]>, title = ""): Accepted => ({ kind: "accepted", title, grader: "PSA", ... })`. Grep the tests directory for other literal `Accepted` object constructions and add `title: ""` to each.

- [ ] **Step 2: Rewrite the sports tests in `tests/match.test.ts` (failing first)**

Replace the six existing `sports:` tests (creates-on-first-sight, LOW-without-year+number, two-letter tokens, fraction-derived, strips-#/serial, empty-name) with these title-driven ones:

```ts
  it("sports: creates a canonical card on first sight (MEDIUM), re-finds it from a differently-worded title (HIGH)", async () => {
    const { db } = await makeTestDb();
    const a = await matchListing(db, "basketball", acc({}, "2019-20 Panini Select Concourse Silver Prizm Shai Gilgeous-Alexander #81 PSA 9"));
    expect(a.confidence).toBe("medium"); expect(a.createdCard).toBe(true);
    const b = await matchListing(db, "basketball", acc({}, "Shai Gilgeous-Alexander 2019 Select #81 Silver Prizm Concourse Thunder PSA 10 RC"));
    expect(b.confidence).toBe("high"); expect(b.cardId).toBe(a.cardId); expect(b.createdCard).toBe(false);
    const [card] = await db.select().from(cards).where(eq(cards.id, a.cardId!));
    expect(card).toMatchObject({ game: "basketball", setName: "2019 Panini Select", cardNumber: "81", name: "Shai Gilgeous-Alexander", variant: "Concourse Prizm Silver", year: 2019 });
  });

  it("sports: base and parallel are different cards", async () => {
    const { db } = await makeTestDb();
    const base = await matchListing(db, "basketball", acc({}, "2019 Panini Prizm Ja Morant #249 PSA 10"));
    const silver = await matchListing(db, "basketball", acc({}, "2019 Panini Prizm Ja Morant #249 Silver Prizm PSA 10"));
    expect(base.cardId).not.toBe(silver.cardId);
    expect((await db.select().from(cards)).length).toBe(2);
  });

  it("sports: two-letter player-name tokens survive (CJ Stroud)", async () => {
    const { db } = await makeTestDb();
    const r = await matchListing(db, "football", acc({}, "2023 Panini Prizm CJ Stroud #150 PSA 10 Texans RC"));
    expect(r.createdCard).toBe(true);
    const [card] = await db.select().from(cards);
    expect(card.name).toBe("Cj Stroud");
  });

  it("sports: LOW and no card when the title has no card number or no player", async () => {
    const { db } = await makeTestDb();
    expect(await matchListing(db, "basketball", acc({}, "2020 Panini Mosaic Lamelo Ball Rookie Auto Mosaic PSA 10")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await matchListing(db, "baseball", acc({}, "2024 Panini Prizm #22 PSA 10 RC Rookie Card")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
    expect(await db.select().from(cards)).toEqual([]);
  });

  it("sports: a serial print-run is never a card number", async () => {
    const { db } = await makeTestDb();
    expect(await matchListing(db, "basketball", acc({}, "2022 Panini Prizm Keegan Murray Rookie Purple Prizm /99 PSA 10")))
      .toEqual({ cardId: null, confidence: "low", createdCard: false });
  });
```

Run `pnpm exec vitest run tests/match.test.ts` — expected FAIL (sports branch still token-based).

- [ ] **Step 3: Rewrite the sports branch in `src/lib/match.ts`**

Replace everything from the `// sports` comment to the end of `matchListing` with:

```ts
  // sports (spec §17.1-2): identity comes from the deterministic title parser,
  // never from the raw token soup. No player or no number → low, no card.
  const parsed = parseSportsTitle(n.title);
  if (!parsed) return { cardId: null, confidence: "low", createdCard: false };
  const identity = {
    game, setName: setLabel(parsed.year, parsed.set), cardNumber: parsed.cardNumber,
    name: parsed.player, variant: parsed.variant,
  };
  const whereIdentity = and(
    eq(cards.game, game), eq(cards.setName, identity.setName), eq(cards.cardNumber, identity.cardNumber),
    eq(cards.name, identity.name), eq(cards.variant, identity.variant),
  );
  const existing = await db.select().from(cards).where(whereIdentity);
  if (existing.length === 1) return { cardId: existing[0].id, confidence: "high", createdCard: false };
  const [created] = await db.insert(cards).values({ ...identity, year: parsed.year, createdFrom: "firehose" }).onConflictDoNothing().returning();
  if (created) return { cardId: created.id, confidence: "medium", createdCard: true };
  const refound = await db.select().from(cards).where(whereIdentity);
  return refound.length === 1
    ? { cardId: refound[0].id, confidence: "high", createdCard: false }
    : { cardId: null, confidence: "low", createdCard: false };
}
```

Import `parseSportsTitle, setLabel` from `@/lib/sportsIdentity`. Delete `sportsNameTokens` and the old `titleCase` helper if nothing else uses them (`usableTokens`, `STOP_TOKENS`, `nameWords` and the Pokémon branch stay byte-identical — verify with `git diff` that no Pokémon line changed).

- [ ] **Step 4: Importer canonical join — `src/lib/importCompsDb.ts`**

In `findSportsCard`/`resolveSportsCard`, canonicalize the CSV row before matching/creating: `setName = setLabel(row.year, canonicalSet(row.setName))` when `row.setName` is non-empty (else `setLabel(row.year, "")`), `name = canonicalPlayer(row.name)`, `variant` = the row's variant title-cased via `canonicalPlayer`. Use these canonical values both for the find (case-insensitive compare stays) and for the insert. Add a test in `tests/importComps.test.ts`: a baseball CSV row with `set_name` "prizm", `year` 2019, `name` "ja morant", `card_number` "249" must resolve to the SAME card that `matchListing(db, "basketball" …)` — no: keep the games consistent — use `game: basketball` in the CSV row with `2019 Panini Prizm Ja Morant #249 PSA 10` matched first via `matchListing`, then assert the import attaches its comp to that card id (no new card created).

- [ ] **Step 5: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: green; Pokémon tests untouched and passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/normalize.ts src/lib/match.ts src/lib/importCompsDb.ts tests/match.test.ts tests/importComps.test.ts
git commit -m "feat: sports matching + manual comps on canonical identity (spec §17.1-2,5)"
```

---

### Task 3: Re-identification backfill — module, CLI, tests

**Files:**
- Create: `src/lib/reidentify.ts`, `scripts/reidentify-sports.ts`
- Test: `tests/reidentify.test.ts` (new)
- Modify: `package.json` (script `"reidentify:sports": "tsx --env-file=.env.local scripts/reidentify-sports.ts"`)

**Interfaces:**
- Consumes (Task 1/2): `parseSportsTitle`, `setLabel`; `matchListing` is NOT used (the backfill resolves identities directly, in batches).
- Produces: `reidentifySports(db: Db, opts?: { dryRun?: boolean; batchSize?: number }): Promise<{ listingsSeen: number; listingsRepointed: number; compsRepointed: number; cardsCreated: number; orphanCardsDeleted: number; unparsed: number }>`.

- [ ] **Step 1: Write the failing test**

`tests/reidentify.test.ts` (PGlite harness): seed a basketball card the OLD way (`setName: "2019"`, `name: "Panini Prizm Ja Morant Grizzlies Rookie"`, `cardNumber: "249"`, `variant: ""`) with two accepted active listings titled `"2019 Panini Prizm Ja Morant #249 PSA 10 Grizzlies RC"` and `"Ja Morant 2019-20 Prizm #249 Rookie PSA 9"` pointing at it, one comp (source auction_close) whose ebayItemId matches the first listing, and a `referencePrices` row for the old card. Run `reidentifySports(db)`. Assert: both listings now point at ONE new card with `setName "2019 Panini Prizm"`, `name "Ja Morant"`, `cardNumber "249"`, `variant ""`; the comp points at that same card; the old card and its referencePrices row are gone; the result counts are `{ listingsSeen: 2, listingsRepointed: 2, compsRepointed: 1, cardsCreated: 1, orphanCardsDeleted: 1, unparsed: 0 }`. Add a second test: `dryRun: true` changes nothing and returns the same counts except `orphanCardsDeleted: 0` and `cardsCreated` reflecting would-create (implement dry-run as "compute, don't write" — creations are counted, not performed).

- [ ] **Step 2: Implement `src/lib/reidentify.ts`**

```ts
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { cards, comps, listings, referencePrices } from "@/db/schema";
import type { Db } from "@/db/client";
import { parseSportsTitle, setLabel } from "@/lib/sportsIdentity";

const SPORTS = ["baseball", "basketball", "football"] as const;
type Game = (typeof SPORTS)[number];

// spec §17.6: re-parse every accepted sports listing's title into its canonical
// card, re-point listings and comps, then drop orphaned sports cards (and their
// reference rows). Idempotent by construction: the same titles parse to the
// same identities. Works in batches — Neon HTTP has no transactions, so every
// statement is individually safe to repeat.
export async function reidentifySports(db: Db, opts?: { dryRun?: boolean; batchSize?: number }) {
  const dryRun = opts?.dryRun ?? false;
  const batchSize = opts?.batchSize ?? 500;
  const out = { listingsSeen: 0, listingsRepointed: 0, compsRepointed: 0, cardsCreated: 0, orphanCardsDeleted: 0, unparsed: 0 };

  const rows = await db
    .select({ id: listings.ebayItemId, title: listings.title, game: listings.game, cardId: listings.cardId })
    .from(listings)
    .where(and(isNull(listings.dropReason), inArray(listings.game, [...SPORTS])));
  out.listingsSeen = rows.length;

  // Identity key → { card fields, listing ids }
  type Ident = { game: Game; setName: string; cardNumber: string; name: string; variant: string; year: number | null; ids: string[] };
  const byKey = new Map<string, Ident>();
  for (const r of rows) {
    const p = parseSportsTitle(r.title);
    if (!p || !r.game) { out.unparsed++; continue; }
    const game = r.game as Game;
    const setName = setLabel(p.year, p.set);
    const key = `${game}|${setName}|${p.cardNumber}|${p.player}|${p.variant}`;
    const cur = byKey.get(key);
    if (cur) cur.ids.push(r.id);
    else byKey.set(key, { game, setName, cardNumber: p.cardNumber, name: p.player, variant: p.variant, year: p.year, ids: [r.id] });
  }

  const idents = [...byKey.values()];
  for (let i = 0; i < idents.length; i += batchSize) {
    const batch = idents.slice(i, i + batchSize);
    // Find existing canonical cards for the batch in one query per game+setName set is overkill; do a single
    // query keyed on cardNumber (few values per batch) and filter in TS.
    const numbers = [...new Set(batch.map((b) => b.cardNumber))];
    const existing = await db.select().from(cards).where(and(inArray(cards.game, [...SPORTS]), inArray(cards.cardNumber, numbers)));
    const findId = (b: Ident) => existing.find((c) => c.game === b.game && c.setName === b.setName && c.cardNumber === b.cardNumber && c.name === b.name && c.variant === b.variant)?.id;

    const toCreate = batch.filter((b) => findId(b) === undefined);
    out.cardsCreated += toCreate.length;
    let created: { id: number; game: string; setName: string; cardNumber: string; name: string; variant: string }[] = [];
    if (!dryRun && toCreate.length > 0) {
      created = await db.insert(cards)
        .values(toCreate.map((b) => ({ game: b.game, setName: b.setName, cardNumber: b.cardNumber, name: b.name, variant: b.variant, year: b.year, createdFrom: "firehose" as const })))
        .onConflictDoNothing()
        .returning();
      if (created.length < toCreate.length) {
        // race/duplicate within batch: re-select
        const again = await db.select().from(cards).where(and(inArray(cards.game, [...SPORTS]), inArray(cards.cardNumber, numbers)));
        existing.splice(0, existing.length, ...again);
      } else existing.push(...created.map((c) => ({ ...c })) as typeof existing);
    }

    for (const b of batch) {
      const target = findId(b) ?? created.find((c) => c.game === b.game && c.setName === b.setName && c.cardNumber === b.cardNumber && c.name === b.name && c.variant === b.variant)?.id;
      if (target === undefined) continue; // dry-run would-create
      out.listingsRepointed += b.ids.length;
      out.compsRepointed += b.ids.length; // upper bound; corrected below on write
      if (dryRun) continue;
      await db.update(listings).set({ cardId: target, matchConfidence: "high" }).where(inArray(listings.ebayItemId, b.ids));
      await db.update(comps).set({ cardId: target }).where(inArray(comps.ebayItemId, b.ids));
    }
  }

  if (!dryRun) {
    // exact comp count: comps whose ebayItemId is a repointed listing
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(comps)
      .where(inArray(comps.ebayItemId, rows.map((r) => r.id)));
    out.compsRepointed = Number(n);

    // Orphans: sports cards no listing, comp, or manual import references. Delete their reference rows first.
    const referenced = await db.select({ id: listings.cardId }).from(listings).where(and(inArray(listings.game, [...SPORTS]), ne(listings.cardId, -1)));
    const referencedComp = await db.select({ id: comps.cardId }).from(comps);
    const keep = new Set([...referenced, ...referencedComp].map((r) => r.id).filter((x): x is number => x !== null));
    const sportsCards = await db.select({ id: cards.id, createdFrom: cards.createdFrom }).from(cards).where(inArray(cards.game, [...SPORTS]));
    const orphans = sportsCards.filter((c) => !keep.has(c.id) && c.createdFrom === "firehose").map((c) => c.id);
    for (let i = 0; i < orphans.length; i += batchSize) {
      const chunk = orphans.slice(i, i + batchSize);
      await db.delete(referencePrices).where(inArray(referencePrices.cardId, chunk));
      await db.delete(cards).where(inArray(cards.id, chunk));
    }
    out.orphanCardsDeleted = orphans.length;
  } else {
    out.compsRepointed = 0;
  }
  return out;
}
```

The implementer owns tidying this into clean, typed code (the `existing.splice/push` juggling and the `ne(listings.cardId, -1)` placeholder for "not null" are intent sketches — use `isNotNull(listings.cardId)` and a straightforward re-select); the SEMANTICS are binding: batch parse → find-or-create canonical cards → re-point listings (confidence high) and comps → delete firehose-created orphan sports cards and their reference rows; dry-run computes counts without writing (creations counted, comps 0, orphans 0). Manual-created cards (`createdFrom: "manual"`) are never deleted.

- [ ] **Step 3: CLI `scripts/reidentify-sports.ts`**

Mirror `scripts/import-comps.ts`'s bootstrap. Usage: `pnpm reidentify:sports [--dry-run]`. Prints the result object as JSON and exits 0. Add the package.json script.

- [ ] **Step 4: Full suite, lint, typecheck**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reidentify.ts scripts/reidentify-sports.ts tests/reidentify.test.ts package.json
git commit -m "feat: sports re-identification backfill + CLI (spec §17.6)"
```

---

## Post-plan (session lead)

1. Push (auto-deploys). 2. `pnpm reidentify:sports --dry-run` against prod → sanity-check counts → run for real. 3. Verify: sports cards count drops, cards-with-2+-listings rises, feed sports rows score. 4. Ledger + memory.
