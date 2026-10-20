// The stamp `web/vite/built.ts` serves. Declared rather than generated: one
// line beats a file nobody edits appearing in every diff.
declare module "virtual:built" {
  export const at: string;
  export const rev: string;
}
