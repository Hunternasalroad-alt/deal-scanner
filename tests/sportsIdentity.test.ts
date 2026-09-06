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
  ["2023 Panini Prizm Draymond Green #123 Silver Prizm PSA 10 Warriors",
    { year: 2023, set: "Panini Prizm", cardNumber: "123", player: "Draymond Green", variant: "Prizm Silver" }],
  ["1990 Fleer Magic Johnson #63 PSA 9 Lakers",
    { year: 1990, set: "Fleer", cardNumber: "63", player: "Magic Johnson", variant: "" }],
  ["2018 Panini Prizm Case Keenum #45 PSA 10 Vikings",
    { year: 2018, set: "Panini Prizm", cardNumber: "45", player: "Case Keenum", variant: "" }],
  ["2002-03 Upper Deck Allan Houston #58 PSA 9 Knicks",
    { year: 2002, set: "Upper Deck", cardNumber: "58", player: "Allan Houston", variant: "" }],
  ["2024 Topps Chrome Jazz Chisholm Jr #100 PSA 10 Marlins",
    { year: 2024, set: "Topps Chrome", cardNumber: "100", player: "Jazz Chisholm Jr", variant: "" }],
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
