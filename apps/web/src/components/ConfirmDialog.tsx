import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar exclusão",
  busy = false,
  error = "",
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function requestClose() {
    if (!busy) dialogRef.current?.close();
  }

  return <dialog
    ref={dialogRef}
    className="modal confirm-dialog"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    onClose={onClose}
    onCancel={(event) => {
      event.preventDefault();
      requestClose();
    }}
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}
  >
    <div className="modal-surface confirm-dialog-surface">
      <button className="modal-close" type="button" aria-label="Fechar confirmação" disabled={busy} onClick={requestClose}>
        <X size={19}/>
      </button>
      <span className="confirm-dialog-icon" aria-hidden="true"><AlertTriangle size={23}/></span>
      <div className="confirm-dialog-copy">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="modal-actions">
        <button className="button secondary" type="button" autoFocus disabled={busy} onClick={requestClose}>Cancelar</button>
        <button className="button danger" type="button" disabled={busy} onClick={onConfirm}>
          <Trash2 size={17}/>{busy ? "Excluindo…" : confirmLabel}
        </button>
      </div>
    </div>
  </dialog>;
}
