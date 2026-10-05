import { expect, test } from "bun:test";
import type { Owned, Stack } from "../collection/cards";
import { columns, detect, FORMATS, MANABOX, MANAWEB } from "../import/formats";
import { header, read } from "../import/read";
import { write } from "./csv";
import { rows } from "./rows";

const NOW = "2026-10-05T00:00:00.000Z";
const ID = "d40c73de-7a5f-46f2-a70b-449bc8ecfe24";
const BINDER = "at://x/app.manaweb.container/one";
const PLACES = new Map([[BINDER, "Draft binder"]]);

// Every field a record can carry, so what the file loses is visible.
const WHOLE: Owned[] = [
  {
    scryfallId: ID,
    finish: "etched",
    quantity: 3,
    condition: "lightPlayed",
    container: BINDER,
    proxy: true,
    note: 'Signed, "Ach! Hans, Run!"',
    tags: ["altered", "misprint", "signed"],
    acquisitions: [
      {
        quantity: 1,
        at: "2025-01-01T00:00:00.000Z",
        price: "2.50",
        currency: "GBP",
        marketValue: "3.00",
        marketCurrency: "USD",
      },
      {
        quantity: 2,
        at: "2025-06-01T00:00:00.000Z",
        price: "1.00",
        currency: "EUR",
      },
    ],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
  },
  {
    scryfallId: "c49d6139-fc0c-41db-be08-dfa87c685092",
    finish: "nonfoil",
    quantity: 1,
    createdAt: "2024-03-03T00:00:00.000Z",
  },
];

function stacks(owned: Owned[]): Stack[] {
  return owned.map((value, at) => ({ uri: `at://x/${at}`, cid: "", value }));
}

function exported(owned: Owned[] = WHOLE): string {
  return write(rows(stacks(owned), MANAWEB, () => new Map(), PLACES).rows);
}

test("the file names itself rather than the tracker it is not", () => {
  expect(detect(header(exported()))?.name).toBe("Manaweb");
});

test("a format with no header of its own writes what it binds", () => {
  expect(columns(MANAWEB)).toEqual(Object.values(MANAWEB.binding));
  expect(header(exported())).toEqual(columns(MANAWEB));
});

test("every column a record can fill is one this format has", () => {
  expect(
    rows(stacks(WHOLE), MANAWEB, () => new Map(), PLACES).dropped,
  ).toEqual([]);
});

// The two fields a reader cannot put back — `docs/scryfall.md`.
test("a collection comes back whole but for the two a read drops", () => {
  const { stacks: back, skipped } = read(exported(), MANAWEB, NOW);

  expect(skipped).toEqual([]);
  expect(back).toEqual(
    WHOLE.map(({ container: _c, updatedAt: _u, ...rest }) => rest as Owned),
  );
});

test("where it was filed is written even so", () => {
  const { rows: out } = rows(stacks(WHOLE), MANAWEB, () => new Map(), PLACES);
  const at = columns(MANAWEB).indexOf("Container");

  expect(out[1]?.[at]).toBe("Draft binder");
  expect(out[3]?.[at]).toBe("");
});

test("a note carrying a comma and a quote survives the trip", () => {
  const { stacks: back } = read(exported(), MANAWEB, NOW);
  expect(back[0]?.note).toBe('Signed, "Ach! Hans, Run!"');
});

test("a lot keeps the day it was come by", () => {
  const { stacks: back } = read(exported(), MANAWEB, NOW);
  expect(back[0]?.acquisitions?.map((one) => one.at)).toEqual([
    "2025-01-01T00:00:00.000Z",
    "2025-06-01T00:00:00.000Z",
  ]);
});

test("a ManaBox file is not read as this one", async () => {
  const at = new URL("../import/fixtures/manabox-binder.csv", import.meta.url);
  expect(detect(header(await Bun.file(at).text()))?.name).toBe("ManaBox");
});

test("no format writes one column twice", () => {
  for (const format of FORMATS) {
    const written = columns(format);
    expect(new Set(written).size).toBe(written.length);
  }
});

test("what is written and not read back is said so", () => {
  const { unread } = rows(stacks(WHOLE), MANAWEB, () => new Map(), PLACES);
  expect(unread).toEqual(["container", "updatedAt"]);
});

test("a collection carrying neither loses nothing to them", () => {
  const loose = WHOLE.map(
    ({ container: _c, updatedAt: _u, ...rest }) => rest as Owned,
  );
  const { unread, dropped } = rows(stacks(loose), MANAWEB, () => new Map());
  expect([...unread, ...dropped]).toEqual([]);
});

test("a format with no column for it says nothing about reading it back", () => {
  const { unread } = rows(stacks(WHOLE), MANABOX, () => new Map(), PLACES);
  expect(unread).toEqual([]);
});

test("a day with no figure beside it is still a lot", () => {
  const dated: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, at: "2025-02-02T00:00:00.000Z" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([dated]), MANAWEB, NOW);

  expect(back[0]?.acquisitions).toEqual([
    { quantity: 1, at: "2025-02-02T00:00:00.000Z" },
  ]);
});

test("a column the reader consults is one the file has to carry", () => {
  const short = columns(MANAWEB).filter((one) => one !== "Proxy");
  expect(detect(short)).toBeNull();
});

test("a year no lexicon would take is not read at all", () => {
  const far = exported([
    {
      ...(WHOLE[1] as Owned),
      acquisitions: [{ quantity: 1, at: "2025-01-01T00:00:00.000Z" }],
    },
  ]).replace("2025-01-01T00:00:00.000Z", "275760-09-12");
  const { stacks: back } = read(far, MANAWEB, NOW);

  expect(back[0]?.acquisitions).toBeUndefined();
});

test("a column that is not a date at all is not guessed at", () => {
  for (const said of ["12", "Mar 3", "2025", "yes", ""]) {
    const one = exported([WHOLE[1] as Owned]).replace(
      "2024-03-03T00:00:00.000Z",
      said,
    );
    const { stacks: back } = read(one, MANAWEB, NOW);
    expect(back[0]?.createdAt).toBe(NOW);
  }
});

test("a tag is cut to the bytes a lexicon counts, not the units", () => {
  const long: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    tags: ["\u{1F600}".repeat(32)],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([long]), MANAWEB, NOW);
  const tag = back[0]?.tags?.[0] ?? "";

  expect(new TextEncoder().encode(tag).length).toBeLessThanOrEqual(64);
  expect([...tag]).toHaveLength(16);
});

test("a tag holding the comma it is joined on is counted as lost", () => {
  const comma: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 2,
    tags: ["foo, bar"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([comma]), MANAWEB, () => new Map()).unkept).toBe(2);
});

test("a figure with no currency beside it is counted as lost", () => {
  const loose: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    acquisitions: [{ quantity: 1, price: "2.50" }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([loose]), MANAWEB, () => new Map()).unkept).toBe(1);
});

test("a lot that is only a count is counted as lost", () => {
  const bare: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 3,
    acquisitions: [{ quantity: 2 }],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([bare]), MANAWEB, () => new Map()).unkept).toBe(3);
});

test("a collection a read puts back whole is counted as nothing", () => {
  expect(rows(stacks(WHOLE), MANAWEB, () => new Map(), PLACES).unkept).toBe(0);
});

test("a tag comma is nothing to a format with no tags column", () => {
  const comma: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    tags: ["foo, bar"],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  expect(rows(stacks([comma]), MANABOX, () => new Map()).unkept).toBe(0);
});

test("a note is cut between characters, never through one", () => {
  const long: Owned = {
    scryfallId: ID,
    finish: "nonfoil",
    quantity: 1,
    note: "\u{1F600}".repeat(400),
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const { stacks: back } = read(exported([long]), MANAWEB, NOW);
  const note = back[0]?.note ?? "";

  expect([...note]).toHaveLength(300);
  // With the unicode flag the class reaches only an unpaired surrogate,
  // which is what a cut through a pair leaves behind.
  expect(note).not.toMatch(/[\uD800-\uDFFF]/u);
});

// A read drops it, so nothing else here would notice the column going blank.
test("when a stack last changed is written even so", () => {
  const { rows: out } = rows(stacks(WHOLE), MANAWEB, () => new Map(), PLACES);
  const at = columns(MANAWEB).indexOf("Updated");

  expect(out[1]?.[at]).toBe("2026-02-02T00:00:00.000Z");
  expect(out[3]?.[at]).toBe("");
});
