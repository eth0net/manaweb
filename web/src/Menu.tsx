import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { SCOPES } from "./config";
import { Modal } from "./Modal";
import { bare, wear } from "./oauth/profile";
import { type Repo, read } from "./oauth/records";
import type { Session } from "./oauth/useSession";

// Who you are, and nothing else: under a sign-in form an index version and a
// license read as its terms. The rest is in `About`.
export function Menu({ account }: { account: Session }) {
  const { state, signIn, signOut } = account;
  const [repo, setRepo] = useState<Repo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [worn, setWorn] = useState(0);

  useEffect(() => {
    if (state.status !== "in") {
      setRepo(null);
      return;
    }
    let live = true;
    read(state.session).then(
      (found) => {
        if (live) setRepo(found);
      },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : "failed");
      },
    );
    return () => {
      live = false;
    };
  }, [state]);

  // Only the page-load read takes the menu away. Signing in keeps it, or the
  // dialog holding the form is torn down with the failure still to report.
  if (state.status === "restoring") return <span className="quiet">…</span>;
  const session = state.status === "in" ? state.session : null;

  return (
    <Modal
      trigger="summary"
      title={session ? "Account" : "Sign in"}
      label={
        state.status === "in" ? (
          <>
            <span className="handle">{repo?.handle ?? state.session.did}</span>
            {/* Keyed so wearing a new one reads it again: the trigger and
                the control that changed it are separate readers. */}
            <Avatar
              key={worn}
              session={state.session}
              name={repo?.handle ?? state.session.did}
            />
          </>
        ) : (
          "Sign in"
        )
      }
      actions={
        session && (
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        )
      }
    >
      {state.status === "in" ? (
        <Account
          session={state.session}
          repo={repo}
          failed={failed}
          onWorn={() => setWorn((n) => n + 1)}
        />
      ) : (
        <SignIn
          signIn={signIn}
          error={state.status === "out" ? state.error : undefined}
          going={state.status === "signing"}
        />
      )}
    </Modal>
  );
}

function Account({
  session,
  repo,
  failed,
  onWorn,
}: {
  session: OAuthSession;
  repo: Repo | null;
  failed: string | null;
  onWorn: () => void;
}) {
  const missing = repo ? SCOPES.filter((s) => !repo.granted.includes(s)) : [];

  return (
    <>
      <Picture session={session} onWorn={onWorn} />
      <dl>
        <dt>DID</dt>
        <dd>{session.did}</dd>
        <dt>Server</dt>
        <dd>{session.serverMetadata.issuer}</dd>
        <dt>Granted</dt>
        <dd>{repo ? repo.granted.join(" ") : "…"}</dd>
        {missing.length > 0 && (
          <>
            <dt>Not granted</dt>
            <dd className="warn">{missing.join(" ")}</dd>
          </>
        )}
        <dt>Records</dt>
        <dd>
          {repo
            ? repo.counts.length > 0
              ? repo.counts
                  .map(
                    (c) =>
                      `${c.collection.slice(12)} ${c.records}${c.more ? "+" : ""}`,
                  )
                  .join(", ")
              : "none yet"
            : "…"}
        </dd>
      </dl>
      {failed && <p className="warn">{failed}</p>}
    </>
  );
}

// Shrunk before it goes up, so a phone camera's output does not become what
// every page load reads back.
function Picture({
  session,
  onWorn,
}: {
  session: OAuthSession;
  onWorn: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = (what: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    what().then(
      () => {
        setBusy(false);
        onWorn();
      },
      (error: unknown) => {
        setBusy(false);
        setFailed(error instanceof Error ? error.message : "failed");
      },
    );
  };

  return (
    <>
      <p className="actions">
        <label className="file">
          {busy ? "Working…" : "Choose a picture"}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) run(() => wear(session, file));
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => bare(session))}
        >
          Remove
        </button>
      </p>
      {failed && <p className="warn">{failed}</p>}
    </>
  );
}

function SignIn({
  signIn,
  error,
  going,
}: {
  signIn: (handle: string) => Promise<void>;
  error?: string;
  going: boolean;
}) {
  const [handle, setHandle] = useState("");

  return (
    <>
      <label className="field" htmlFor="handle">
        Enter your handle or DID
      </label>
      <form
        className="query"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(handle);
        }}
      >
        <input
          id="handle"
          type="text"
          value={handle}
          placeholder="liliana.mnwb.me"
          onChange={(event) => setHandle(event.target.value)}
          autoComplete="username"
          spellCheck={false}
        />
        <button type="submit" disabled={going || handle.trim().length === 0}>
          {going ? "Continuing…" : "Continue"}
        </button>
      </form>
      {error && <p className="warn">{error}</p>}
      {/* A new tab, unlike every other link here: this one is mid-flow, and
          a handle has to be carried back to the form behind it. */}
      <p className="quiet">
        No account? Sign up with{" "}
        <a href="https://bsky.app" target="_blank" rel="noreferrer">
          Bluesky
        </a>{" "}
        or{" "}
        <a href="https://tangled.org/signup" target="_blank" rel="noreferrer">
          Tangled
        </a>
        .
      </p>
      <p className="quiet">Records are written to your own PDS, never ours.</p>
    </>
  );
}
