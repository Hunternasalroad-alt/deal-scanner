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

// §17.7 accepted limitation, made explicit: VARIANT_PHRASES (color words like
// "white"/"green") and TEAM_PHRASES/JUNK (team nicknames and words like
// "magic"/"case") silently amputate real player names that happen to contain
// them — "Devin White" -> "Devin", "Magic Johnson" -> "Johnson", "Case Keenum"
// -> "Keenum". This is a curated allow-list of the collisions we know about,
// not a general fix: an unlisted color- or team-named player still fragments.
// Two-token lowercase names, normalized the same way the tokenizer normalizes
// every other token (lowercased; a leading/trailing "-"/"." stripped) — which
// is why "A.J. Green" needs its own "a.j green" entry alongside the
// literal-but-untokenizable "a.j. green".
const PROTECTED_PLAYERS = new Set([
  "draymond green", "danny green", "jalen green", "jeff green", "aj green", "a.j. green", "a.j green",
  "devin white", "reggie white", "randy white",
  "magic johnson", "case keenum", "jazz chisholm",
  "dallas goedert", "dallas keuchel",
  "allan houston", "orlando cepeda", "boston scott",
  "vida blue", "red grange", "red schoendienst",
]);

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

// Longest-first phrase matcher over a token array. Returns [length, value].
function matchPhrase(tokens: string[], i: number, dict: Record<string, string> | Set<string>, maxLen = 4): [number, string] | null {
  for (let len = Math.min(maxLen, tokens.length - i); len >= 1; len--) {
    const phrase = tokens.slice(i, i + len).join(" ");
    if (dict instanceof Set) { if (dict.has(phrase)) return [len, phrase]; }
    else if (Object.hasOwn(dict, phrase)) return [len, dict[phrase]];
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

  // §17.7: mark both positions of any adjacent pair that is a known
  // player-name/dictionary collision (see PROTECTED_PLAYERS) before
  // classification runs, so those tokens can be routed straight to residue
  // regardless of which dictionary would otherwise have claimed them.
  const protectedPositions = new Set<number>();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (PROTECTED_PLAYERS.has(`${tokens[i]} ${tokens[i + 1]}`)) { protectedPositions.add(i); protectedPositions.add(i + 1); }
  }

  let set = "";
  const variantParts: string[] = [];
  const residue: { tok: string; pos: number }[] = [];

  for (let i = 0; i < tokens.length; ) {
    if (protectedPositions.has(i)) { residue.push({ tok: tokens[i], pos: i }); i++; continue; }
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
  let prevPos = -2;
  for (const r of residue) {
    if (r.pos === prevPos + 1) runs[runs.length - 1].push(r.tok);
    else runs.push([r.tok]);
    prevPos = r.pos;
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
