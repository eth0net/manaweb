import type { OAuthSession } from "@atproto/oauth-client-browser";
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { published } from "./CatalogStatus";
import type { Loaded } from "./catalog/load";
import { CATALOG, SCOPES } from "./config";
import { Modal } from "./Modal";
import { bare, wear } from "./oauth/profile";
import { type Repo, read } from "./oauth/records";
import type { Session } from "./oauth/useSession";
import type { Status } from "./useCatalog";

// Everything that is about the app rather than in it: who you are, what the
// catalog is, and what the licenses oblige. One panel, because each of these
// alone is a header control, and four of those is a header nobody can read on
// a phone.
export function Menu({
  account,
  status,
  loaded,
}: {
  account: Session;
  status: Status;
  loaded: Loaded | null;
}) {
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

  if (state.status === "restoring") return <span className="quiet">…</span>;
  const session = state.status === "in" ? state.session : null;

  return (
    <Modal
      trigger="summary"
      title="Manaweb"
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
        <SignIn signIn={signIn} error={state.error} />
      )}

      {loaded && <Catalog loaded={loaded} status={status} />}
      {/* todo(eth0net): a panel of its own once there is somewhere to open one
          from, because under the sign-in form these read as part of signing
          in. The fifth tab is the scanner's. */}
      <Licenses />
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
      <h3>Account</h3>
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
}: {
  signIn: (handle: string) => Promise<void>;
  error?: string;
}) {
  const [handle, setHandle] = useState("");

  return (
    <>
      <h3>Sign in</h3>
      <form
        className="query"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(handle);
        }}
      >
        <input
          type="text"
          value={handle}
          placeholder="liliana.mnwb.me"
          onChange={(event) => setHandle(event.target.value)}
          autoComplete="username"
          spellCheck={false}
        />
        <button type="submit" disabled={handle.trim().length === 0}>
          Continue
        </button>
      </form>
      <p className="quiet">
        Your handle or DID. Records are written to your own PDS, never ours.
      </p>
      {error && <p className="warn">{error}</p>}
    </>
  );
}

function Catalog({ loaded, status }: { loaded: Loaded; status: Status }) {
  const { catalog, manifest, cached } = loaded;

  return (
    <>
      <h3>Catalog</h3>
      <p className="quiet">
        {catalog.cards.toLocaleString()} cards · {published(catalog.version)}
        {cached && " · cached"}
      </p>
      <dl>
        <dt>Version</dt>
        <dd>{catalog.version}</dd>
        <dt>Cards</dt>
        <dd>{rows(manifest.cards.rows, manifest.cards.bytes)}</dd>
        <dt>Printings</dt>
        <dd>{rows(manifest.prints.rows, manifest.prints.bytes)}</dd>
        <dt>Read from</dt>
        <dd>{cached ? "this device" : CATALOG}</dd>
        <dt>Checked</dt>
        <dd>
          {status.checkedAt ? status.checkedAt.toLocaleTimeString() : "never"}
          {status.error && ` — ${status.error}`}
        </dd>
      </dl>
      <p className="actions">
        <button
          type="button"
          onClick={status.check}
          disabled={status.checking}
        >
          {status.checking ? "Checking…" : "Check for a newer catalog"}
        </button>
        <button type="button" onClick={status.reset}>
          Forget and download again
        </button>
      </p>
    </>
  );
}

// The Fan Content Policy asks for its disclaimer verbatim and Scryfall for a
// credit naming them as the source; neither asks for a place. See `docs/ip.md`.
function Licenses() {
  return (
    <>
      <h3>Licenses</h3>
      <p>
        Manaweb is unofficial Fan Content permitted under the{" "}
        <a href="https://company.wizards.com/en/legal/fancontentpolicy">
          Fan Content Policy
        </a>
        . Not approved/endorsed by Wizards. Portions of the materials used are
        property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </p>
      <dl>
        <dt>Manaweb</dt>
        <dd>
          AGPL-3.0-only —{" "}
          <a href="https://github.com/eth0net/manaweb">source</a>
        </dd>

        <dt>Card names, text and mana symbols</dt>
        <dd>
          ©Wizards of the Coast LLC, used under the{" "}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy">
            Fan Content Policy
          </a>
        </dd>

        <dt>Card data and images</dt>
        <dd>
          <a href="https://scryfall.com">Scryfall</a>, under their{" "}
          <a href="https://scryfall.com/docs/api">API terms</a>. Hotlinked
          rather than redistributed, and not endorsed by Scryfall.
        </dd>

        <dt>React, React DOM</dt>
        <dd>MIT</dd>
      </dl>
    </>
  );
}

function rows(count: number, bytes: number) {
  return `${count.toLocaleString()} rows · ${(bytes / 1e6).toFixed(1)} MB`;
}
