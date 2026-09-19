import { describe, expect, test } from "bun:test";
import { compose, join, KEY, one, read, remove, value, write } from "./terms";

describe("reading", () => {
  test("a term anywhere in the query", () => {
    expect(value("bolt c:r mv<=1", "c")).toBe("r");
    expect(value("bolt", "c")).toBe("");
  });

  test("every value of a group the chips wrote", () => {
    expect(read("bolt (s:lea or s:2ed) c:r", "s").values).toEqual([
      "lea",
      "2ed",
    ]);
  });

  test("a key is not read out of a longer one", () => {
    expect(value("cn:161", "c")).toBe("");
    expect(value("c:r cn:161", "cn")).toBe("161");
  });

  test("the comparison comes back with the value", () => {
    expect(read("c<=wu", "c").op).toBe("<=");
    expect(read("c:wu", "c").op).toBe(":");
    expect(read("mv>=3", "mv").values).toEqual(["3"]);
  });

  test("a key inside a longer word is not the key", () => {
    expect(read("is:foil", "s").values).toEqual([]);
    expect(read("is:foil s:lea", "s").values).toEqual(["lea"]);
    expect(write("is:foil s:lea", "s", ["m10"])).toBe("is:foil s:m10");
  });

  test("a comparison is never taken for part of the value", () => {
    expect(read("c>=4", "c", { shape: "letters" }).values).toEqual([]);
    expect(read("c<=4", "c", { shape: "letters" }).values).toEqual([]);
    expect(read("c>=wu", "c", { shape: "letters" }).values).toEqual(["wu"]);
  });

  test("a key written twice keeps a comparison each", () => {
    expect(read("c>=2 c<=4", "c", { shape: "count" }).terms).toEqual([
      { op: ">=", value: "2" },
      { op: "<=", value: "4" },
    ]);
  });

  test("a refusal is read apart from what is wanted", () => {
    expect(read("c:g -c:r", "c").values).toEqual(["g"]);
    expect(read("c:g -c:r", "c", { not: true }).values).toEqual(["r"]);
  });
});

describe("writing", () => {
  test("rewriting one polarity leaves the other standing", () => {
    expect(write("c:g -c:r", "c", ["u"])).toBe("-c:r c:u");
    expect(write("c:g -c:r", "c", [], { not: true })).toBe("c:g");
  });

  test("keeps the comparison it was given", () => {
    expect(one("bolt", "c", "wu", "<=")).toBe("bolt c<=wu");
    expect(write("bolt", "c", ["w", "u"])).toBe("bolt (c:w or c:u)");
  });

  test("replaces a term written with another comparison", () => {
    expect(one("bolt c<=wu", "c", "r")).toBe("bolt c:r");
  });

  test("replaces what was there and leaves the rest", () => {
    expect(one("bolt c:r mv<=1", "c", "u")).toBe("bolt mv<=1 c:u");
  });

  test("an empty value takes the term out", () => {
    expect(one("bolt c:r", "c", "")).toBe("bolt");
    expect(one("c:r", "c", "")).toBe("");
  });

  test("terms of another shape are left standing", () => {
    expect(write("c:wu c=2", "c", ["r"], { shape: "letters" })).toBe(
      "c=2 c:r",
    );
    expect(write("c:wu c=2", "c", ["3"], { op: "=", shape: "count" })).toBe(
      "c:wu c=3",
    );
  });

  test("every one of them is a run, any of them is a group", () => {
    expect(write("bolt", "t", ["legendary", "creature"], { all: true })).toBe(
      "bolt t:legendary t:creature",
    );
  });

  test("several values become a group, and replace one", () => {
    expect(write("bolt s:lea", "s", ["lea", "2ed"])).toBe(
      "bolt (s:lea or s:2ed)",
    );
    expect(write("bolt (s:lea or s:2ed)", "s", ["m10"])).toBe("bolt s:m10");
  });
});

describe("editing by span", () => {
  test("a group mixing keys survives either control", () => {
    expect(write("(c:r or t:goblin)", KEY.colors, [])).toBe("t:goblin");
    expect(write("(c:r or t:goblin)", KEY.type, [])).toBe("c:r");
  });

  test("what the control didn't write is left as typed", () => {
    expect(write("bolt cmc>=3 -is:foil s:lea", KEY.set, ["m10"])).toBe(
      "bolt cmc>=3 -is:foil s:m10",
    );
  });

  test("an emptied group leaves no brackets behind", () => {
    expect(write("bolt (s:lea or s:2ed)", KEY.set, [])).toBe("bolt");
    expect(write("bolt (s:lea or s:2ed)", KEY.set, ["m10"])).toBe(
      "bolt s:m10",
    );
  });
});

describe("aliases", () => {
  test("a key is read by every spelling the syntax has", () => {
    expect(read("set:lea", KEY.set).values).toEqual(["lea"]);
    expect(read("e:lea", KEY.set).values).toEqual(["lea"]);
    expect(read("type:creature", KEY.type).values).toEqual(["creature"]);
    expect(read("color:r", KEY.colors).values).toEqual(["r"]);
  });

  test("and rewritten as one of them, not beside it", () => {
    expect(write("bolt set:lea", KEY.set, ["m10"])).toBe("bolt s:m10");
    expect(write("bolt edition:lea", KEY.set, [])).toBe("bolt");
  });
});

describe("quoted values", () => {
  test("a space inside quotes is one value", () => {
    expect(read('t:"time lord"', KEY.type).values).toEqual(["time lord"]);
  });

  test("and is written back with its quotes", () => {
    expect(write("bolt", KEY.type, ["time lord"])).toBe('bolt t:"time lord"');
  });

  test("a quoted value is not half taken", () => {
    expect(write('t:"time lord" c:r', KEY.type, ["goblin"])).toBe(
      "c:r t:goblin",
    );
  });
});

// The invariant every bug so far has broken — see `docs/search.md`.
describe("round trip", () => {
  const cases: [
    string,
    Parameters<typeof read>[1],
    Parameters<typeof read>[2],
  ][] = [
    ["c>=wu c<=4", KEY.colors, { shape: "letters" }],
    ["c>=wu c<=4", KEY.colors, { shape: "count" }],
    ["c:g -c:r", KEY.colors, { shape: "letters" }],
    ["c:g -c:r", KEY.colors, { shape: "letters", not: true }],
    ["is:foil s:lea", KEY.set, {}],
    ["(s:lea or s:2ed) t:goblin", KEY.set, {}],
    ["t:legendary t:creature", KEY.type, {}],
    ['t:"time lord"', KEY.type, {}],
    ["bolt lang:ja order:mv", KEY.lang, {}],
  ];

  for (const [query, key, how] of cases) {
    test(`${query} holds through ${String(key)}`, () => {
      const held = read(query, key, how);
      const again = write(query, key, held.values, { ...how, op: held.op });
      expect(read(again, key, how).values).toEqual(held.values);
      expect(read(again, key, how).op).toBe(held.op);
    });
  }
});

// Cutting a term used to run a tidy-up over the whole string, so any control
// writing its own term flattened everyone else's group.
describe("what a write leaves alone", () => {
  test("a group over another key keeps its or", () => {
    expect(write("(s:lea or s:2ed) bolt", KEY.colors, ["r"])).toBe(
      "(s:lea or s:2ed) bolt c:r",
    );
    expect(write("(c:w or c:u)", KEY.lang, ["ja"])).toBe(
      "(c:w or c:u) lang:ja",
    );
  });

  test("and a value spelling and or or is a value", () => {
    expect(write('a:"fire and ice"', KEY.colors, ["r"])).toBe(
      'a:"fire and ice" c:r',
    );
    expect(write("sword of fire and ice", KEY.colors, ["r"])).toBe(
      "sword of fire and ice c:r",
    );
  });

  test("a nested group empties without leaving its brackets", () => {
    expect(write("(s:lea or (s:2ed or s:3ed))", KEY.set, [])).toBe("");
    expect(write("(s:lea or (s:2ed or s:3ed)) bolt", KEY.set, [])).toBe(
      "bolt",
    );
  });

  test("a group the cut empties takes its or with it", () => {
    expect(write("bolt (s:lea or s:2ed) c:r", KEY.set, [])).toBe("bolt c:r");
    expect(write("(t:goblin or s:lea) c:r", KEY.set, [])).toBe("t:goblin c:r");
  });

  test("a negated group keeps its brackets, the minus being on them", () => {
    expect(write("-(s:lea or t:goblin) c:r", KEY.set, [])).toBe(
      "-(t:goblin) c:r",
    );
  });
});

describe("composing a run", () => {
  test("separate terms where every one of them is wanted", () => {
    expect(compose(KEY.type, ["legendary", "creature"], { all: true })).toBe(
      "t:legendary t:creature",
    );
    expect(compose(KEY.type, ["goblin", "wizard"])).toBe(
      "(t:goblin or t:wizard)",
    );
    expect(compose(KEY.type, [])).toBe("");
  });

  test("so two runs over one key survive each other", () => {
    const left = remove("bolt t:creature t:goblin", KEY.type);
    expect(
      join(
        left,
        compose(KEY.type, ["legendary", "creature"], { all: true }),
        compose(KEY.type, ["goblin", "wizard"]),
      ),
    ).toBe("bolt t:legendary t:creature (t:goblin or t:wizard)");
  });
});
