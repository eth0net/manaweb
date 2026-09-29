// A browser's database, for tests that run where there is none. Defined
// rather than assigned: a plain assignment is refused once the property
// exists, and two test files in one process both want to reset it.
import { IDBFactory } from "fake-indexeddb";

export function database(factory: IDBFactory = new IDBFactory()): IDBFactory {
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
    writable: true,
  });
  return factory;
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
