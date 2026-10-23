import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One dialog's worth of wiring: a trigger, a panel, and Escape.
export function Modal({
  label,
  trigger,
  onOpen,
  ...rest
}: Omit<Parameters<typeof Panel>[0], "onShut"> & {
  label: ReactNode;
  trigger: string;
  // Opening is the only moment a panel can be told to start over: what it
  // holds outlives a close, the trigger staying mounted.
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={trigger}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        {label}
      </button>

      {open && <Panel {...rest} onShut={() => setOpen(false)} />}
    </>
  );
}

// The panel on its own, for a page that shows one rather than a row that
// opens one: a list of several thousand rows paid for a modal apiece.
export function Panel({
  title,
  actions,
  wide,
  onShut,
  children,
}: {
  title: string;
  actions?: ReactNode;
  wide?: boolean;
  onShut: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Everything the element needs, once it exists. `closedby` because React's
  // types don't carry it yet, and a listener beside it because Safari does
  // not implement it.
  useEffect(() => {
    const on = dialog.current;
    if (!on) return;
    on.setAttribute("closedby", "any");
    on.showModal();
    // Opening would otherwise focus the first control in the panel and ring
    // it, for a click that was aimed at the trigger.
    panel.current?.focus();

    // The dialog's own box is the panel, `padding: 0` saying so, and a press
    // that began inside is a drag rather than a tap beside it.
    let beside = false;
    const down = (event: PointerEvent) => {
      beside = event.target === on;
    };
    const up = (event: MouseEvent) => {
      if (beside && event.target === on) on.close();
    };

    on.addEventListener("pointerdown", down);
    on.addEventListener("click", up);
    return () => {
      on.removeEventListener("pointerdown", down);
      on.removeEventListener("click", up);
    };
  }, []);

  // Out of the tree that showed it: a dialog is flow content, and a trigger
  // inside a sentence would end the paragraph holding it.
  return createPortal(
    <dialog
      ref={dialog}
      className={wide ? "wide" : undefined}
      onClose={onShut}
    >
      <div className="panel" ref={panel} tabIndex={-1}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="shut"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        {children}
        {actions && <p className="actions">{actions}</p>}
      </div>
    </dialog>,
    document.body,
  );
}
