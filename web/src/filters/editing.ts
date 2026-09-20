// What every filter control is handed: the query as it stands, and the way to
// say what it should stand as.
export interface Editing {
  text: string;
  onText: (next: string) => void;
}
