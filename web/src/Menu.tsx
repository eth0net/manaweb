import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  type KeyboardEvent as Keyed,
  useEffect,
  useRef,
  useState,
} from "react";
import { Particulars } from "./About";
import { Avatar } from "./Avatar";
import type { Loaded } from "./catalog/load";
import { SCOPES } from "./config";
import { Panel } from "./Modal";
import { bare, wear } from "./oauth/profile";
import { type Repo, read } from "./oauth/records";
import type { Session } from "./oauth/useSession";
import { Settings } from "./Settings";
import type { Status } from "./useCatalog";

type View = "profile" | "settings" | "about";

const TITLES: Record<View, string> = {
  profile: "Profile",
  settings: "Settings",
  about: "About Manaweb",
};

// Everything hanging off the picture: who you are, what the app is, and the
// way out. Signed out there is no picture, so the press is the sign-in form.
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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const held = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [at, setAt] = useState(0);

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

  // A press anywhere else and the escape key, which is what a dialog would
  // have brought with it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!held.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // The arrows move which entry is the menu's one stop; this is what makes
  // that the entry a reader is on.
  useEffect(() => {
    if (open) items.current[at]?.focus();
  }, [open, at]);

  // Only the page-load read takes the menu away. Signing in keeps it, or the
  // dialog holding the form is torn down with the failure still to report.
  if (state.status === "restoring") return <span className="quiet">…</span>;
  const session = state.status === "in" ? state.session : null;
  const name = repo?.handle ?? session?.did ?? "";

  function go(to: View) {
    setOpen(false);
    setView(to);
  }

  // Back where the press came from, which a dialog does for itself and a
  // menu of plain controls does not.
  function shut() {
    setOpen(false);
    trigger.current?.focus();
  }

  const entries = [
    { name: "Profile", press: () => go("profile") },
    { name: "Settings", press: () => go("settings") },
    { name: "About", press: () => go("about") },
    { name: "Sign out", press: signOut },
  ];

  function steer(event: Keyed<HTMLDivElement>) {
    const last = entries.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: at === last ? 0 : at + 1,
      ArrowUp: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      setAt(to);
      return;
    }
    // Out of the menu rather than through it, as a menu's own key does.
    if (event.key === "Tab") shut();
  }

  return (
    <div className="account" ref={held}>
      <button
        ref={trigger}
        type="button"
        className="summary"
        aria-haspopup={session ? "menu" : undefined}
        aria-expanded={session ? open : undefined}
        onClick={() => {
          if (!session) return setView("profile");
          setAt(0);
          setOpen(!open);
        }}
      >
        {session ? (
          <>
            <span className="handle">{name}</span>
            {/* Keyed so wearing a new one reads it again: the trigger and
                the control that changed it are separate readers. */}
            <Avatar key={worn} session={session} name={name} />
          </>
        ) : (
          "Sign in"
        )}
      </button>

      {session && open && (
        <div className="account-menu" role="menu" onKeyDown={steer}>
          {entries.map((entry, index) => (
            <button
              key={entry.name}
              ref={(node) => {
                items.current[index] = node;
              }}
              type="button"
              role="menuitem"
              // One stop for the menu, the arrows moving within it.
              tabIndex={index === at ? 0 : -1}
              onClick={entry.press}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      {view !== null &&
        (session ? (
          <Panel title={TITLES[view]} onShut={() => setView(null)}>
            {view === "profile" ? (
              <Account
                session={session}
                repo={repo}
                failed={failed}
                onWorn={() => setWorn((n) => n + 1)}
              />
            ) : view === "settings" ? (
              <Settings />
            ) : (
              <Particulars status={status} loaded={loaded} />
            )}
          </Panel>
        ) : (
          <Panel title="Sign in" onShut={() => setView(null)}>
            <SignIn
              signIn={signIn}
              error={state.status === "out" ? state.error : undefined}
              going={state.status === "signing"}
            />
          </Panel>
        ))}
    </div>
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
      <label className="asks" htmlFor="handle">
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
