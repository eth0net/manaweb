import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useEffect, useState } from "react";
import { type Owned, stack } from "../collection/cards";
import type { Main } from "../lexicons/app/manaweb/import";
import { type Fields, type Held, list } from "../oauth/repo";

export const IMPORTED = "app.manaweb.import";

// What one import leaves behind, and what the next one is checked against.
export type Receipt = Fields<Main>;

// What the file said rather than the bytes it said it in, so a second export
// of an unchanged collection matches however its rows are ordered or spelled.
export async function digest(stacks: Owned[]): Promise<string> {
  const lines = stacks
    .map((one) => `${one.quantity}\t${stack(one)}`)
    .sort()
    .join("\n");

  return `sha256-${await sha(lines)}`;
}

// SHA-256 as hex. Exported because a part's record key is one too, over what
// the part holds rather than over the file.
export async function sha(of: string): Promise<string> {
  const sum = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(of),
  );

  return [...new Uint8Array(sum)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Every import already taken. Few enough to read whole, and read once: an
// import writes its own receipt only at the end.
export function useReceipts(session: OAuthSession | null): Held<Receipt>[] {
  const [taken, setTaken] = useState<Held<Receipt>[]>([]);

  useEffect(() => {
    if (!session) {
      setTaken([]);
      return;
    }

    let current = true;
    list<Receipt>(session, IMPORTED)
      .then((found) => current && setTaken(found))
      .catch(() => current && setTaken([]));

    return () => {
      current = false;
    };
  }, [session]);

  return taken;
}
