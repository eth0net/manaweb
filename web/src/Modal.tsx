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

  // Set here because React's types don't carry it yet. A click handler on the
  // backdrop would be a way to close that a keyboard can't reach.
  useEffect(() => {
    dialog.current?.setAttribute("closedby", "any");
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
