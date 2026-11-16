// Preferences as a test wants them: nothing read, nothing set, and whatever
// the test says already chosen. Without it a test inherits what the one
// before it changed, and the read each key gets once per process.
import { forget, type Preference, preset } from "../preferences";

export function preferences(set: Partial<Record<Preference, boolean>> = {}) {
  forget();
  for (const [key, value] of Object.entries(set)) {
    preset(key as Preference, value as boolean);
  }
}
