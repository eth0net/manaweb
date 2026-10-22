import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One dialog's worth of wiring: a trigger, a panel, and Escape.
export function Modal({
  label,
  trigger,
  title,
  actions,
  wide,
  children,
}: {
  label: ReactNode;
  trigger: string;
  title: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // `closedby` is set here because React's types don't carry it yet, and
  // listened for beside it because Safari does not implement it.
  useEffect(() => {
    const on = dialog.current;
    if (!on) return;
    on.setAttribute("closedby", "any");

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

  return (
    <>
      <button
        type="button"
        className={trigger}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
          // Opening would otherwise focus the first control in the panel and
          // ring it, for a click that was aimed at the trigger.
          panel.current?.focus();
        }}
      >
        {label}
      </button>

      {/* Out of the tree that triggered it: a dialog is flow content, and a
          trigger inside a sentence would end the paragraph holding it. */}
      {createPortal(
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
            {/* Built on opening, so a modal per search result costs three
                elements rather than a list nobody has asked to see. */}
            {open && children}
            {actions && <p className="actions">{actions}</p>}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
