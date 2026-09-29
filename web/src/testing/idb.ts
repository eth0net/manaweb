// A browser's database, for tests that run where there is none. Defined
// rather than assigned: a plain assignment is refused once the property
// exists, and two test files in one process both want to reset it.
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

export function database(factory: IDBFactory = new IDBFactory()): IDBFactory {
  define("indexedDB", factory);
  // A browser has this alongside; a key range is how a store is asked for a
  // span rather than a key.
  define("IDBKeyRange", IDBKeyRange);
  return factory;
}

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

// One whose every open fails, for the difference between a read that found
// nothing and a read that could not happen.
export function broken(why: string): void {
  const factory = new IDBFactory();
  factory.open = () => {
    throw new Error(why);
  };
  database(factory);
}
