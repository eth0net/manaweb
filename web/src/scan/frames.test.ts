import { afterEach, expect, test } from "bun:test";
import { database } from "../testing/idb";
import { frame, hold, reading, send } from "./frames";
import type { Entry } from "./scratch";

const fetching = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetching;
  void database();
});
database();

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);

test("a frame comes back by the stack it belongs to", async () => {
  await hold("a", png());
  expect(await frame("a")).not.toBeNull();
  expect(await frame("b")).toBeNull();
});

// Bounded, because these are megabytes each and a scanning run is long.
test("only the last few are kept", async () => {
  for (const id of ["a", "b", "c", "d", "e", "f", "g"]) await hold(id, png());

  expect(await frame("a")).toBeNull();
  expect(await frame("b")).toBeNull();
  expect(await frame("c")).not.toBeNull();
  expect(await frame("g")).not.toBeNull();
});

test("a frame missing is not an error, it is nothing to report", async () => {
  expect(await frame("never")).toBeNull();
});

// The stack carries whatever was picked last, so reading the answer back off
// it filed every correction as a read that agreed with the person.
test("a read says what the index returned, not what the stack was put right to", () => {
  expect(reading(corrected).said).toBe("guessed");
});

test("the note carries the read and the answer apart", async () => {
  await hold("a", png());
  const sent = posted();

  await send("a", {
    read: reading(corrected),
    answer: {
      print: "corrected",
      label: "ecl-89",
      finish: "nonfoil",
      matched: false,
    },
    wrong: "",
  });

  const note = (await sent).note;
  expect(note.read.said).toBe("guessed");
  expect(note.answer?.print).toBe("corrected");
});

const corrected: Entry = {
  id: "a",
  at: "2026-09-29T00:00:00.000Z",
  margin: 2,
  detected: true,
  matched: [{ distance: 0, prints: ["guessed"] }],
  scryfallId: "corrected",
  picked: true,
  finish: "nonfoil",
  quantity: 1,
};

// Bun has no `FileReader`, and base64 through one is how a frame is carried.
class Reader {
  result = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((bytes) => {
      this.result = `data:;base64,${Buffer.from(bytes).toString("base64")}`;
      this.onload?.();
    });
  }
}

Object.defineProperty(globalThis, "FileReader", {
  value: Reader,
  configurable: true,
  writable: true,
});

// The one call `send` makes, and the body it went out with.
function posted(): Promise<{
  note: { answer: { print: string } | null; read: { said: string } };
}> {
  return new Promise((keep) => {
    globalThis.fetch = ((_where: string, how: { body: string }) => {
      keep(JSON.parse(how.body));
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
  });
}
