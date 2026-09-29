// Where the dev server takes a reported frame. Its own module because the
// plugin that serves the route and the check that the built app carries no
// trace of it both read this, and neither wants what posts to it.
export const CAPTURE = "/debug/capture";
