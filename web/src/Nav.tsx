import { entry, Link, TABS, tab } from "./router";

export function Nav({ path }: { path: string }) {
  const here = tab(path);

  return (
    <nav>
      {TABS.map(({ path: to, label }) => (
        <Link
          key={to}
          to={entry(to, here)}
          className={to === here ? "here" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
