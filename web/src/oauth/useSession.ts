import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useCallback, useEffect, useState } from "react";
import { oauth, restore } from "./client";

export type State =
  // Reading the session back on page load, before anything can be shown.
  | { status: "restoring" }
  // Leaving for the authorization server, which is a different wait: it was
  // asked for, and whatever asked has to stay up to say so if it fails.
  | { status: "signing" }
  | { status: "out"; error?: string }
  | { status: "in"; session: OAuthSession };

export type Session = ReturnType<typeof useSession>;

export function useSession() {
  const [state, setState] = useState<State>({ status: "restoring" });

  useEffect(() => {
    let live = true;
    restore().then(
      (result) => {
        if (!live) return;
        setState(
          result
            ? { status: "in", session: result.session }
            : { status: "out" },
        );
      },
      (error: unknown) => {
        if (live) setState({ status: "out", error: reason(error) });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Resolves only on failure: success navigates to the authorization server.
  const signIn = useCallback(async (handle: string) => {
    setState({ status: "signing" });
    try {
      const client = await oauth();
      await client.signIn(handle.trim());
    } catch (error) {
      setState({ status: "out", error: reason(error) });
    }
  }, []);

  const signOut = useCallback(async () => {
    if (state.status !== "in") return;
    await state.session.signOut();
    setState({ status: "out" });
  }, [state]);

  return { state, signIn, signOut };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
