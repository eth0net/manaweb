import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One dialog's worth of wiring: a trigger, a panel, and Escape.
export function Modal({
  label,
  trigger,
  title,
  actions,
  wide,
  onOpen,
  children,
}: {
  label: ReactNode;
  trigger: string;
  title: string;
  actions?: ReactNode;
  wide?: boolean;
  // Opening is the only moment a panel can be told to start over: what it
  // holds outlives a close, the trigger staying mounted.
  onOpen?: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Everything the element needs, once it exists. `closedby` because React's
  // types don't carry it yet, and a listener beside it because Safari does
  // not implement it.
  useEffect(() => {
    // Runs when the dialog is built rather than when the trigger mounts,
    // there being no element to wire up until then.
    if (!open) return;
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
  }, [open]);

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

      {/* Nothing until it is opened: the dialog goes to the body, so a list
          windowing its rows cannot skip one per row — and a collection has
          thousands. Out of the triggering tree because a dialog is flow
          content, and a trigger inside a sentence would end its paragraph. */}
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className={wide ? "wide" : undefined}
            onClose={() => setOpen(false)}
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
        )}
    </>
  );
}
