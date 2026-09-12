import { useEffect, useState } from "react";
import { Account } from "./Account";
import { CatalogStatus, CatalogUpdate } from "./CatalogStatus";
import { Collection } from "./collection/Collection";
import { useCollection } from "./collection/cards";
import { useContainers } from "./collection/containers";
import { Owning } from "./collection/context";
import { Destination } from "./collection/Destination";
import { CATALOG } from "./config";
import { Footer } from "./Footer";
import { IMPORT, Import } from "./import/Import";
import { Nav } from "./Nav";
import { useSession } from "./oauth/useSession";
import { HOME, known, replace, tab, usePath } from "./router";
import { Search } from "./Search";
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
  const collection = useCollection(signedIn, chosen);
  const path = usePath();
  const here = tab(path);

  // A bare `/` and the OAuth callback both land somewhere the bar can't mark,
  // and the callback has to be read out of the address before it is rewritten.
  useEffect(() => {
    if (account.state.status !== "restoring" && !known(path)) replace(HOME);
  }, [account.state.status, path]);

  return (
    <main>
      <header>
        <h1>Manaweb</h1>
        {load.status === "ready" && (
          <CatalogStatus status={status} loaded={load} />
        )}
        <Account account={account} />
      </header>

      <div className="column">
        <CatalogUpdate status={status} />

        {signedIn && here === "/cards" && (
          <p className="destination">
            <Destination
              containers={containers}
              owning={collection}
              chosen={chosen}
              onChoose={choose}
            />
            {collection.error && (
              <span className="warn">{collection.error}</span>
            )}
          </p>
        )}

        {/* Signed out leaves this null, which is what hides every add button. */}
        <Owning value={collection.ready ? collection : null}>
          <div className="view">
            {here === "/cards" &&
              (load.status === "ready" ? (
                <Search catalog={load.catalog} />
              ) : load.status === "loading" ? (
                <p>{load.step}…</p>
              ) : (
                <p>
                  No catalog at <code>{CATALOG}</code>: {load.error}
                </p>
              ))}

            {here === "/collection" &&
              (path === IMPORT ? (
                <Import signedIn={signedIn !== null} />
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
      <Footer />
    </main>
  );
}
