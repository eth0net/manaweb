import { useEffect, useState } from "react";
import { CatalogUpdate } from "./CatalogStatus";
import { Collection } from "./collection/Collection";
import { useCollection } from "./collection/cards";
import { useContainers } from "./collection/containers";
import { Owning } from "./collection/context";
import { Destination } from "./collection/Destination";
import { CATALOG } from "./config";
import { IMPORT, Import, ImportStatus } from "./import/Import";
import { attach, useWaiting } from "./import/runner";
import { Menu } from "./Menu";
import { Nav } from "./Nav";
import { useSession } from "./oauth/useSession";
import { HOME, known, Link, replace, tab, usePath } from "./router";
import { Search } from "./Search";
import { SETS, SetView } from "./Sets";
import { Soon } from "./Soon";
import { useCatalog } from "./useCatalog";

export function App() {
  const status = useCatalog();
  const { load } = status;
  const account = useSession();
  const signedIn =
    account.state.status === "in" ? account.state.session : null;
  const containers = useContainers(signedIn);
  const [chosen, choose] = useState<string | null>(null);
  const waiting = useWaiting();
  const collection = useCollection(signedIn, chosen, waiting);
  const path = usePath();
  const here = tab(path);

  // An import outlives the page that started it, so what picks it back up is
  // the app opening rather than that page being visited.
  useEffect(() => {
    void attach(signedIn, collection.snapshot, collection.landed);
  }, [signedIn, collection.snapshot, collection.landed]);

  // A bare `/` and the OAuth callback both land somewhere the bar can't mark,
  // and the callback has to be read out of the address before it is rewritten.
  useEffect(() => {
    if (account.state.status !== "restoring" && !known(path)) replace(HOME);
  }, [account.state.status, path]);

  const destination = signedIn && (
    <>
      <Destination
        containers={containers}
        owning={collection}
        chosen={chosen}
        onChoose={choose}
      />
      {collection.error && <span className="warn">{collection.error}</span>}
    </>
  );

  return (
    <main>
      <header>
        <h1>
          <Link to={HOME} className="mark">
            <img src="/icon.svg" alt="" width="128" height="128" />
            Manaweb
          </Link>
        </h1>
        <Menu
          account={account}
          status={status}
          loaded={load.status === "ready" ? load : null}
        />
      </header>

      <div className="column">
        <CatalogUpdate status={status} />
        <ImportStatus path={path} />

        {/* Signed out leaves this null, which is what hides every add button. */}
        <Owning value={collection.ready ? collection : null}>
          <div className="view">
            {here === "/cards" &&
              (load.status === "ready" ? (
                path === SETS ? (
                  <SetView catalog={load.catalog} tools={destination} />
                ) : (
                  <Search catalog={load.catalog} tools={destination} />
                )
              ) : load.status === "loading" ? (
                <p>{load.step}…</p>
              ) : (
                <p>
                  No catalog at <code>{CATALOG}</code>: {load.error}
                </p>
              ))}

            {here === "/collection" &&
              (path === IMPORT ? (
                <Import
                  session={signedIn}
                  owning={collection}
                  catalog={load.status === "ready" ? load.catalog : null}
                />
              ) : signedIn ? (
                <Collection
                  catalog={load.status === "ready" ? load.catalog : null}
                  containers={containers}
                  owning={collection}
                  path={path}
                />
              ) : (
                <p className="quiet">Sign in to see what you own.</p>
              ))}

            {here === "/decks" && <Soon what="Decks" />}
            {here === "/lists" && <Soon what="Lists" />}
          </div>
        </Owning>
      </div>

      <Nav path={here} />
    </main>
  );
}
