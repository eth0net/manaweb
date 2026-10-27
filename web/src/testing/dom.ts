// A browser's document, for tests that render. Needs `bun test --isolate`, or
// these globals reach every other file in the run.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "https://manaweb.app/" });
