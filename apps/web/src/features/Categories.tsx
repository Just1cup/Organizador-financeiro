import { Check, Plus, Tags } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Category, MergeSuggestion } from "../types";
import { Card, EmptyState, SectionTitle, Spinner } from "../components/ui";

export function Categories({ onChanged }: { onChanged: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [mergeBusy, setMergeBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCategories, nextSuggestions] = await Promise.all([
        api<Category[]>("/categories"),
        api<MergeSuggestion[]>("/categories/merge-suggestions")
      ]);
      setCategories(nextCategories); setSuggestions(nextSuggestions);
    } catch { /* falha aqui não deve travar a tela inteira */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mergeGroup(group: MergeSuggestion) {
    const key = group.names.join("|");
    const into = [...group.names].sort((left, right) => right.length - left.length)[0];
    const from = group.names.filter((name) => name !== into);
    setMergeBusy(key); setMessage("");
    try {
      const result = await api<{ transactions_moved: number }>("/categories/merge", { method: "POST", body: JSON.stringify({ into, from }) });
      setMessage(`Categorias fundidas em "${into}" • ${result.transactions_moved} lançamentos movidos.`);
      await load();
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Não foi possível fundir as categorias.");
    } finally {
      setMergeBusy(null);
    }
  }

  const topLevel = categories.filter((item) => !item.parent_name);
  const childrenOf = (name: string) => categories.filter((item) => item.parent_name === name);
  const totalTransactions = categories.reduce((sum, item) => sum + item.transaction_count, 0);

  return <div className="screen categories-screen">
    <header className="page-header">
      <div><span className="page-icon" aria-hidden="true"><Tags size={21}/></span><div><h1>Categorias</h1><p>Organize seus gastos e ensine o sistema a classificar sozinho da próxima vez.</p></div></div>
      <button className="button primary" type="button" onClick={() => setShowCreate((current) => !current)}><Plus size={18}/>Nova categoria</button>
    </header>

    {!loading && categories.length ? <Card className="category-stats">
      <div><strong>{topLevel.length}</strong><span>{topLevel.length === 1 ? "categoria principal" : "categorias principais"}</span></div>
      <div><strong>{categories.length - topLevel.length}</strong><span>{categories.length - topLevel.length === 1 ? "subtipo" : "subtipos"}</span></div>
      <div><strong>{totalTransactions}</strong><span>lançamentos classificados</span></div>
    </Card> : null}

    {showCreate ? <CategoryCreateForm categories={categories} onDone={() => { setShowCreate(false); void load(); }}/> : null}
    {message ? <div className="import-message"><Check size={17}/>{message}</div> : null}

    {suggestions.length ? <>
      <SectionTitle icon={<Tags/>} action={<span className="section-meta">{suggestions.length} {suggestions.length === 1 ? "grupo" : "grupos"}</span>}>Possíveis duplicidades</SectionTitle>
      <Card className="merge-suggestions">
        {suggestions.map((group) => {
          const key = group.names.join("|");
          return <div className="merge-suggestion-row" key={key}>
            <span>{group.names.join(" · ")}</span>
            <button className="button secondary" type="button" disabled={mergeBusy === key} onClick={() => void mergeGroup(group)}>
              {mergeBusy === key ? "Fundindo…" : "Fundir"}
            </button>
          </div>;
        })}
      </Card>
    </> : null}

    <SectionTitle icon={<Tags/>} action={topLevel.length ? <span className="section-meta">{categories.length} no total</span> : null}>Suas categorias</SectionTitle>
    {loading ? <Spinner label="Carregando categorias"/> : topLevel.length ? <Card className="category-tree">
      {topLevel.map((item) => <div className="category-tree-row" key={item.name}>
        <div><strong>{item.name}</strong><small>{item.transaction_count} {item.transaction_count === 1 ? "lançamento" : "lançamentos"}{item.is_system ? " · padrão" : ""}</small></div>
        {childrenOf(item.name).length ? <div className="category-tree-children">{childrenOf(item.name).map((child) => <span key={child.name}>{child.name} <i>{child.transaction_count}</i></span>)}</div> : null}
      </div>)}
    </Card> : <EmptyState title="Nenhuma categoria" text="As categorias aparecem automaticamente conforme você lança ou importa dados." action={<button className="button primary" type="button" onClick={() => setShowCreate(true)}><Plus size={17}/>Criar a primeira</button>}/>}
  </div>;
}

function CategoryCreateForm({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const parentName = String(form.get("parent_name") || "");
    try {
      await api("/categories", { method: "POST", body: JSON.stringify({ name: form.get("name"), ...(parentName ? { parent_name: parentName } : {}) }) });
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar categoria"); }
    finally { setBusy(false); }
  }
  return <Card><form className="goal-form" onSubmit={submit}>
    <label>Nome<input name="name" placeholder="Ex.: Pet" required minLength={2} maxLength={80}/></label>
    <label>Subtipo de (opcional)<select name="parent_name" defaultValue="">
      <option value="">Categoria principal</option>
      {categories.filter((item) => !item.parent_name).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></label>
    {error ? <div className="form-error">{error}</div> : null}
    <button className="button primary" disabled={busy}>{busy ? "Criando…" : "Criar categoria"}</button>
  </form></Card>;
}
