import { ArrowDownLeft, ArrowUpRight, Check, Filter, Plus, ReceiptText, RotateCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CategoryPicker } from "../components/CategoryPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TransactionForm } from "../components/TransactionForm";
import { Card, EmptyState, Spinner } from "../components/ui";
import { api, money } from "../lib/api";
import type { Category, Transaction, TransactionKind } from "../types";

type TypeFilter = "all" | TransactionKind;
type Toast = { tone: "success" | "error"; text: string };
const PAGE_SIZE = 100;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  whatsapp: "WhatsApp",
  nubank_csv: "Nubank",
  itau_csv: "Itaú",
  generic_csv: "Extrato"
};

let lastConsumedCreateSignal = 0;

function transactionDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function sourceLabel(transaction: Transaction): string {
  if (transaction.external_id?.startsWith("recurring:salary:")) return "Automático";
  return SOURCE_LABELS[transaction.source] || transaction.source.replaceAll("_", " ");
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function LedgerRow({
  item, categories, onDelete, onCategoryChange, onCategoryCreated
}: {
  item: Transaction;
  categories: Category[];
  onDelete: (item: Transaction) => void;
  onCategoryChange: (item: Transaction, category: string) => void;
  onCategoryCreated: () => void;
}) {
  const income = item.amount_cents > 0;
  const [editingCategory, setEditingCategory] = useState(false);
  return <li className={`ledger-row ${income ? "income" : "expense"}`}>
    <span className="ledger-icon" aria-hidden="true">{income ? <ArrowDownLeft size={19}/> : <ArrowUpRight size={19}/>}</span>
    <span className="ledger-copy">
      <strong>{item.description}</strong>
      <small>
        {editingCategory ? <CategoryPicker
          compact
          autoFocus
          value={item.category}
          categories={categories}
          onChange={(category) => { setEditingCategory(false); onCategoryChange(item, category); }}
          onCreated={onCategoryCreated}
        /> : <button type="button" className="category-chip" onClick={() => setEditingCategory(true)} aria-label={`Editar categoria de ${item.description}, atual: ${item.category}`}>{item.category}</button>}
        <i aria-hidden="true"/> {sourceLabel(item)} · {transactionDate(item.occurred_at)}
      </small>
    </span>
    <strong className={`ledger-amount ${income ? "positive-text" : "danger-text"}`}>{income ? "+" : "−"}{money(Math.abs(item.amount_cents))}</strong>
    <button className="ledger-delete" type="button" title="Excluir lançamento" aria-label={`Excluir ${item.description}, ${money(Math.abs(item.amount_cents))}`} onClick={() => onDelete(item)}>
      <Trash2 size={17}/>
    </button>
  </li>;
}

export function Transactions({ onChanged, openCreateSignal = 0 }: { onChanged: () => void | Promise<void>; openCreateSignal?: number }) {
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [category, setCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await api<Transaction[]>(`/transactions?limit=${PAGE_SIZE}&offset=0`);
      setItems(next);
      setHasMore(next.length === PAGE_SIZE);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os lançamentos."); setItems((current) => current ?? []); }
  }, []);

  const loadCategories = useCallback(async () => {
    try { setAvailableCategories(await api<Category[]>("/categories")); }
    catch { /* a lista de categorias é uma conveniência de edição; falha aqui não deve travar a tela */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  useEffect(() => {
    const refreshFirstPage = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const latest = await api<Transaction[]>(`/transactions?limit=${PAGE_SIZE}&offset=0`);
        setItems((current) => {
          if (!current || latest.length < PAGE_SIZE) return latest;
          const ids = new Set(latest.map((item) => item.id));
          const boundary = latest.at(-1)!;
          const older = current.filter((item) => !ids.has(item.id) && (
            item.occurred_at < boundary.occurred_at || (item.occurred_at === boundary.occurred_at && item.id < boundary.id)
          ));
          return [...latest, ...older];
        });
        if (latest.length < PAGE_SIZE) setHasMore(false);
      } catch {
        // A falha silenciosa do refresh não substitui os dados já visíveis.
      }
    };
    const timer = window.setInterval(() => void refreshFirstPage(), 5_000);
    document.addEventListener("visibilitychange", refreshFirstPage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshFirstPage);
    };
  }, []);

  useEffect(() => {
    if (openCreateSignal > lastConsumedCreateSignal) {
      lastConsumedCreateSignal = openCreateSignal;
      setCreateOpen(true);
    }
  }, [openCreateSignal]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categories = useMemo(() => [...new Set((items || []).map((item) => item.category))].sort((left, right) => left.localeCompare(right, "pt-BR")), [items]);
  const filtered = useMemo(() => {
    const search = normalizeSearch(query.trim());
    return (items || []).filter((item) => {
      const matchesText = !search || normalizeSearch(`${item.description} ${item.merchant || ""} ${item.category}`).includes(search);
      const matchesType = type === "all" || (type === "income" ? item.amount_cents > 0 : item.amount_cents < 0);
      const matchesCategory = category === "all" || item.category === category;
      return matchesText && matchesType && matchesCategory;
    });
  }, [category, items, query, type]);

  const filteredBalance = filtered.reduce((total, item) => total + item.amount_cents, 0);
  const hasFilters = Boolean(query || type !== "all" || category !== "all");

  function clearFilters() {
    setQuery(""); setType("all"); setCategory("all");
  }

  function created() {
    setToast({ tone: "success", text: "Lançamento adicionado com sucesso." });
    void load();
    void Promise.resolve(onChanged()).catch(() => undefined);
  }

  async function loadMore() {
    if (!items || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const more = await api<Transaction[]>(`/transactions?limit=${PAGE_SIZE}&offset=${items.length}`);
      setItems((current) => {
        const existing = new Set((current || []).map((item) => item.id));
        return [...(current || []), ...more.filter((item) => !existing.has(item.id))];
      });
      setHasMore(more.length === PAGE_SIZE);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais lançamentos.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setDeleteBusy(true); setDeleteError("");
    try {
      await api(`/transactions/${pendingDelete.id}`, { method: "DELETE" });
      setItems((current) => current?.filter((item) => item.id !== pendingDelete.id) ?? []);
      setToast({ tone: "success", text: "Lançamento excluído com sucesso." });
      setPendingDelete(null);
      void Promise.resolve(onChanged()).catch(() => undefined);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Não foi possível excluir o lançamento.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function changeCategory(item: Transaction, category: string) {
    if (category === item.category) return;
    try {
      const updated = await api<Transaction>(`/transactions/${item.id}`, { method: "PATCH", body: JSON.stringify({ category }) });
      setItems((current) => current?.map((row) => row.id === item.id ? { ...row, category: updated.category } : row) ?? []);
      setToast({ tone: "success", text: "Categoria atualizada." });
      void Promise.resolve(onChanged()).catch(() => undefined);
    } catch (cause) {
      setToast({ tone: "error", text: cause instanceof Error ? cause.message : "Não foi possível atualizar a categoria." });
    }
  }

  const recurringSalary = pendingDelete?.external_id?.startsWith("recurring:salary:") ?? false;

  return <div className="screen transactions-screen">
    <header className="page-header transactions-header">
      <div><span className="page-icon" aria-hidden="true"><ReceiptText size={21}/></span><div><h1>Lançamentos</h1><p>Acompanhe e ajuste todas as movimentações em um só lugar.</p></div></div>
      <button className="button primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={18}/>Novo lançamento</button>
    </header>

    <Card className="transaction-toolbar">
      <label className="transaction-search">
        <Search size={18} aria-hidden="true"/>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por descrição, estabelecimento ou categoria" aria-label="Buscar lançamentos"/>
        {query ? <button type="button" aria-label="Limpar busca" onClick={() => setQuery("")}><X size={16}/></button> : null}
      </label>
      <label className="transaction-filter"><Filter size={16} aria-hidden="true"/><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value as TypeFilter)} aria-label="Filtrar por tipo"><option value="all">Todos</option><option value="income">Entradas</option><option value="expense">Saídas</option></select></label>
      <label className="transaction-filter"><span>Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoria"><option value="all">Todas</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
    </Card>

    <div className="ledger-summary" aria-live="polite">
      <span><strong>{filtered.length}</strong> {filtered.length === 1 ? "lançamento" : "lançamentos"}</span>
      <span>Resultado exibido <strong className={filteredBalance >= 0 ? "positive-text" : "danger-text"}>{money(filteredBalance)}</strong></span>
    </div>

    {error ? <div className="global-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}><RotateCw size={15}/> Tentar novamente</button></div> : null}
    {items === null ? <Spinner label="Carregando lançamentos"/> : filtered.length ? <Card className="transaction-ledger">
      <ul>{filtered.map((item) => <LedgerRow
        key={item.id}
        item={item}
        categories={availableCategories}
        onDelete={(selected) => { setDeleteError(""); setPendingDelete(selected); }}
        onCategoryChange={(selected, next) => void changeCategory(selected, next)}
        onCategoryCreated={() => void loadCategories()}
      />)}</ul>
      {hasMore ? <div className="ledger-load-more"><button className="button secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Carregar lançamentos anteriores"}</button></div> : null}
    </Card> : items.length && hasFilters ? <EmptyState title="Nenhum resultado" text="Tente ajustar os filtros ou carregue registros mais antigos." action={<div className="empty-actions"><button className="text-button" type="button" onClick={clearFilters}>Limpar filtros</button>{hasMore ? <button className="text-button" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Buscar em registros antigos"}</button> : null}</div>}/> : <EmptyState title="Nenhum lançamento" text="Adicione uma entrada ou saída para começar a acompanhar sua movimentação." action={<button className="button primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={17}/>Novo lançamento</button>}/>} 

    <TransactionForm open={createOpen} onClose={() => setCreateOpen(false)} onChanged={created}/>
    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title="Excluir este lançamento?"
      description={pendingDelete ? recurringSalary
        ? `${pendingDelete.description}, no valor de ${money(Math.abs(pendingDelete.amount_cents))}, será removido deste mês. O salário continuará programado para os próximos meses e um registro de auditoria será preservado.`
        : `${pendingDelete.description}, no valor de ${money(Math.abs(pendingDelete.amount_cents))}, será removido dos seus totais. Um registro de auditoria será preservado.` : ""}
      busy={deleteBusy}
      error={deleteError}
      onClose={() => { if (!deleteBusy) { setPendingDelete(null); setDeleteError(""); } }}
      onConfirm={() => void remove()}
    />

    <div className={`toast-region ${toast ? "visible" : ""}`} aria-live={toast?.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
      {toast ? <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <Check size={17}/> : null}<span>{toast.text}</span><button type="button" aria-label="Fechar aviso" onClick={() => setToast(null)}><X size={16}/></button></div> : null}
    </div>
  </div>;
}
