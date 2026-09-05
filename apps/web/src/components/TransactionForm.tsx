import { ArrowDownLeft, ArrowUpRight, CalendarDays, Save, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { CategoryPicker } from "./CategoryPicker";
import { api } from "../lib/api";
import type { Category, ManualTransactionInput, PaymentMethod, Transaction, TransactionKind } from "../types";

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "pix", label: "Pix" },
  { value: "credit", label: "Cartão de crédito" },
  { value: "debit", label: "Cartão de débito" },
  { value: "cash", label: "Dinheiro" },
  { value: "transfer", label: "Transferência" },
  { value: "unknown", label: "Não informado" }
];

function localDateTimeValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type TransactionFormProps = {
  open: boolean;
  onChanged: (transaction: Transaction) => void | Promise<void>;
  onClose: () => void;
};

export function TransactionForm({ open, onChanged, onClose }: TransactionFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [category, setCategory] = useState("Alimentação");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      formRef.current?.reset();
      setKind("expense");
      setCategory("Alimentação");
      setError("");
      dialog.showModal();
      api<Category[]>("/categories").then(setCategories).catch(() => undefined);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function chooseKind(nextKind: TransactionKind) {
    setKind(nextKind);
    setCategory(nextKind === "income" ? "Receitas" : "Alimentação");
  }

  function requestClose() {
    if (!busy) dialogRef.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get("amount") || "").replace(",", "."));
    const occurredAt = new Date(String(form.get("occurred_at") || ""));

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (Number.isNaN(occurredAt.getTime())) {
      setError("Informe uma data e hora válidas.");
      return;
    }

    const merchant = String(form.get("merchant") || "").trim();
    const input: ManualTransactionInput = {
      kind,
      amount_cents: Math.round(amount * 100),
      description: String(form.get("description") || "").trim(),
      occurred_at: occurredAt.toISOString(),
      category,
      payment_method: String(form.get("payment_method")) as PaymentMethod,
      ...(merchant ? { merchant } : {})
    };

    setBusy(true);
    setError("");
    try {
      const transaction = await api<Transaction>("/transactions", { method: "POST", body: JSON.stringify(input) });
      dialogRef.current?.close();
      void Promise.resolve(onChanged(transaction)).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o lançamento.");
    } finally {
      setBusy(false);
    }
  }

  return <dialog
    ref={dialogRef}
    className="modal transaction-drawer"
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
    <div className="modal-surface transaction-form-surface">
      <header className="modal-header">
        <div><h2 id={titleId}>Novo lançamento</h2><p id={descriptionId}>Inclua uma entrada ou saída manualmente.</p></div>
        <button className="modal-close" type="button" aria-label="Fechar formulário" disabled={busy} onClick={requestClose}><X size={20}/></button>
      </header>

      <form ref={formRef} className="transaction-form" onSubmit={submit}>
        <fieldset className="transaction-kind">
          <legend>Tipo do lançamento</legend>
          <label className={kind === "expense" ? "selected expense" : ""}>
            <input type="radio" name="kind" value="expense" checked={kind === "expense"} onChange={() => chooseKind("expense")}/>
            <ArrowUpRight size={18}/><span><strong>Saída</strong><small>Dinheiro gasto</small></span>
          </label>
          <label className={kind === "income" ? "selected income" : ""}>
            <input type="radio" name="kind" value="income" checked={kind === "income"} onChange={() => chooseKind("income")}/>
            <ArrowDownLeft size={18}/><span><strong>Entrada</strong><small>Dinheiro recebido</small></span>
          </label>
        </fieldset>

        <label className="form-field amount-field">
          <span>Valor</span>
          <div className="input-with-prefix"><b>R$</b><input autoFocus name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0,00" required/></div>
        </label>

        <label className="form-field">
          <span>Descrição</span>
          <input name="description" minLength={2} maxLength={160} placeholder={kind === "income" ? "Ex.: Pagamento de cliente" : "Ex.: Almoço no restaurante"} required/>
        </label>

        <label className="form-field">
          <span>{kind === "income" ? "Pagador" : "Estabelecimento"} <small>opcional</small></span>
          <input name="merchant" maxLength={120} placeholder={kind === "income" ? "Quem fez o pagamento" : "Onde você comprou"}/>
        </label>

        <div className="transaction-form-grid">
          <label className="form-field">
            <span>Categoria</span>
            {kind === "income"
              ? <select value="Receitas" disabled><option>Receitas</option></select>
              : <CategoryPicker value={category} categories={categories.filter((item) => item.name !== "Receitas")} onChange={setCategory} onCreated={() => { api<Category[]>("/categories").then(setCategories).catch(() => undefined); }}/>}
          </label>
          <label className="form-field">
            <span>Forma de pagamento</span>
            <select name="payment_method" defaultValue={kind === "income" ? "transfer" : "unknown"} key={kind}>
              {PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        <label className="form-field">
          <span><CalendarDays size={15}/> Data e hora</span>
          <input name="occurred_at" type="datetime-local" defaultValue={localDateTimeValue()} required/>
        </label>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <footer className="modal-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={requestClose}>Cancelar</button>
          <button className="button primary" type="submit" disabled={busy}><Save size={17}/>{busy ? "Salvando…" : "Salvar lançamento"}</button>
        </footer>
      </form>
    </div>
  </dialog>;
}
