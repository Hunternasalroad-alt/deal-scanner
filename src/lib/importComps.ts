// Manual comp CSV importer — pure parsing/validation, no I/O. Users record
// graded-card sales they personally observed on a public sold-price page
// (e.g. fanaticscollect.com) into a CSV and import them as `comps` rows with
// source: "manual". src/lib/importCompsDb.ts does the DB-touching half (card
// matching/creation, comp insertion); this file only turns CSV text into
// validated, typed rows so both the CLI and its tests can exercise parsing
// without a database.

const GAMES = ["pokemon", "baseball", "basketball", "football"] as const;
type Game = (typeof GAMES)[number];
const isGame = (v: string): v is Game => (GAMES as readonly string[]).includes(v);

const GRADERS = ["PSA", "BGS", "SGC"] as const;
type Grader = (typeof GRADERS)[number];
const isGrader = (v: string): v is Grader => (GRADERS as readonly string[]).includes(v);

const GRADE_RX = /^\d{1,2}(\.5)?$/;

export type ManualCompRow = {
  game: Game;
  setName: string;
  cardNumber: string;
  name: string;
  variant: string;
  year: number | null;
  grader: Grader;
  grade: string;
  soldPriceCents: number;
  soldAt: Date;
  venue: string;
  note: string;
};

// Minimal RFC-4180 parser: comma-separated, double-quote quoting, "" escapes
// a literal quote inside a quoted field, \r\n and \n both end a row, and a
// fully-empty line (no characters at all between newlines) is skipped rather
// than producing a spurious [""] row. No external dependency — this is the
// only place in the repo that reads a user-supplied CSV file.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else if (c === "\n") endRow();
    else field += c;
  }
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

const REQUIRED_HEADERS = ["game", "set_name", "card_number", "name", "grader", "grade", "sold_price", "sold_date"];

// $ and thousands commas are cosmetic — strip them, then require a plain
// decimal with at most 2 places so "12.345" (bogus sub-cent precision) is
// rejected rather than silently truncated. Cents are built from the matched
// integer/fraction substrings directly (never `* 100` on a float), so e.g.
// 1234.56 can't drift to 123455.99999998 on the way to an integer.
function parsePriceCents(raw: string): number | null {
  const stripped = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(stripped);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

// sold_date is a plain YYYY-MM-DD (the source pages report a sale date, not a
// timestamp), anchored to noon UTC so no reader's timezone can roll it onto
// an adjacent calendar day. Calendar-invalid dates (2024-02-30) are rejected
// rather than letting `Date` silently roll them into March.
function parseSoldDate(raw: string, now: Date): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  if (date.getTime() > now.getTime()) return null;
  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
  if (date.getTime() < fiveYearsAgo.getTime()) return null;
  return date;
}

export function parseManualCompCsv(
  text: string,
  now: Date,
): { rows: ManualCompRow[]; errors: { line: number; message: string }[] } {
  const table = parseCsv(text);
  const errors: { line: number; message: string }[] = [];
  const rows: ManualCompRow[] = [];

  if (table.length === 0) {
    errors.push({ line: 1, message: "CSV is empty — expected a header row" });
    return { rows, errors };
  }

  const headerIndex = new Map<string, number>();
  table[0].forEach((h, idx) => headerIndex.set(h.trim().toLowerCase(), idx));
  const missing = REQUIRED_HEADERS.filter((h) => !headerIndex.has(h));
  if (missing.length > 0) {
    errors.push({ line: 1, message: `missing required column(s): ${missing.join(", ")}` });
    return { rows, errors };
  }

  // Line numbers count rows in the parsed table (header = line 1), not raw
  // file lines — parseCsv already dropped fully-blank lines, and there is no
  // way to recover their original position from its output.
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    const cell = (name: string): string => {
      const idx = headerIndex.get(name);
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };

    const gameRaw = cell("game").toLowerCase();
    if (!isGame(gameRaw)) {
      errors.push({ line, message: `game must be one of ${GAMES.join("/")} (got "${cell("game")}")` });
      continue;
    }

    const graderRaw = cell("grader").toUpperCase();
    if (!isGrader(graderRaw)) {
      errors.push({ line, message: `grader "${cell("grader")}" is not supported — the scanner tracks PSA/BGS/SGC only` });
      continue;
    }

    const grade = cell("grade");
    if (!GRADE_RX.test(grade)) {
      errors.push({ line, message: `grade "${grade}" must look like 10, 9.5, or 8` });
      continue;
    }

    const name = cell("name");
    if (!name) {
      errors.push({ line, message: "name is required" });
      continue;
    }

    const setName = cell("set_name");
    const cardNumber = cell("card_number");
    if (gameRaw === "pokemon" && !setName) {
      errors.push({ line, message: "set_name is required for pokemon rows" });
      continue;
    }
    if (!cardNumber) {
      errors.push({ line, message: "card_number is required" });
      continue;
    }

    const soldPriceCents = parsePriceCents(cell("sold_price"));
    if (soldPriceCents === null) {
      errors.push({ line, message: `sold_price "${cell("sold_price")}" must be a positive dollar amount up to $1,000,000` });
      continue;
    }

    const soldAt = parseSoldDate(cell("sold_date"), now);
    if (!soldAt) {
      errors.push({ line, message: `sold_date "${cell("sold_date")}" must be YYYY-MM-DD, not in the future, and no more than 5 years old` });
      continue;
    }

    const yearRaw = cell("year");
    let year: number | null = null;
    if (yearRaw) {
      const y = Number(yearRaw);
      if (!Number.isInteger(y)) {
        errors.push({ line, message: `year "${yearRaw}" must be a whole number` });
        continue;
      }
      year = y;
    }

    rows.push({
      game: gameRaw, setName, cardNumber, name, variant: cell("variant"), year,
      grader: graderRaw, grade, soldPriceCents, soldAt,
      venue: (cell("venue") || "unknown").toLowerCase(), note: cell("note"),
    });
  }

  return { rows, errors };
}

// Deterministic synthetic ebayItemId so re-importing the same CSV (or a
// second CSV recording the same real-world sale) dedupes via the comps_item
// unique index instead of accumulating duplicate comps.
export function syntheticCompId(row: ManualCompRow, cardId: number): string {
  const y = row.soldAt.getUTCFullYear();
  const m = String(row.soldAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(row.soldAt.getUTCDate()).padStart(2, "0");
  const base = `manual:${row.venue}:${cardId}:${row.grader}:${row.grade}:${y}${m}${d}:${row.soldPriceCents}`;
  if (row.note === "") return base;
  const slug = row.note.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base}:${slug}`;
}
