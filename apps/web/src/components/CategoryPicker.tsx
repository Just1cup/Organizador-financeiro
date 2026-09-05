import { useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Category } from "../types";

const CREATE_VALUE = "__create__";

function buildTree(categories: Category[]): Array<{ root: Category; children: Category[] }> {
  const names = new Set(categories.map((category) => category.name));
  const children = new Map<string, Category[]>();
  const roots: Category[] = [];
  for (const category of categories) {
    if (category.parent_name && names.has(category.parent_name)) {
      const list = children.get(category.parent_name) ?? [];
      list.push(category);
      children.set(category.parent_name, list);
    } else roots.push(category);
  }
  const byName = (left: Category, right: Category) => left.name.localeCompare(right.name, "pt-BR");
  roots.sort(byName);
  for (const list of children.values()) list.sort(byName);
  return roots.map((root) => ({ root, children: children.get(root.name) ?? [] }));
}

type CategoryPickerProps = {
  value: string;
  categories: Category[];
  onChange: (name: string) => void;
  onCreated?: (name: string) => void;
  compact?: boolean;
  id?: string;
  autoFocus?: boolean;
};

export function CategoryPicker({ value, categories, onChange, onCreated, compact, id, autoFocus }: CategoryPickerProps) {
  const tree = useMemo(() => buildTree(categories), [categories]);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftParent, setDraftParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmCreate() {
    const name = draftName.trim();
    if (name.length < 2) { setError("Informe um nome com ao menos 2 letras."); return; }
    setBusy(true); setError("");
    try {
      const created = await api<Category>("/categories", {
        method: "POST",
        body: JSON.stringify({ name, ...(draftParent ? { parent_name: draftParent } : {}) })
      });
      setCreating(false); setDraftName(""); setDraftParent("");
      onCreated?.(created.name);
      onChange(created.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a categoria.");
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return <div className={`category-picker-create ${compact ? "compact" : ""}`}>
      <input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Nome da categoria" maxLength={80}/>
      <select value={draftParent} onChange={(event) => setDraftParent(event.target.value)} aria-label="Categoria pai (opcional)">
        <option value="">Categoria principal</option>
        {categories.filter((category) => !category.parent_name).map((category) => <option key={category.name} value={category.name}>Subtipo de {category.name}</option>)}
      </select>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="category-picker-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => { setCreating(false); setError(""); }}>Cancelar</button>
        <button type="button" className="button primary" disabled={busy} onClick={() => void confirmCreate()}>{busy ? "Criando…" : "Criar"}</button>
      </div>
    </div>;
  }

  const knownValue = categories.some((category) => category.name === value);
  return <select
    id={id}
    autoFocus={autoFocus}
    className={compact ? "category-picker compact" : "category-picker"}
    value={knownValue ? value : ""}
    onChange={(event) => {
      if (event.target.value === CREATE_VALUE) setCreating(true);
      else onChange(event.target.value);
    }}
  >
    {!knownValue && value ? <option value="">{value}</option> : null}
    {tree.map(({ root, children }) => children.length
      ? <optgroup label={root.name} key={root.name}>
          <option value={root.name}>{root.name} (geral)</option>
          {children.map((child) => <option value={child.name} key={child.name}>{child.name}</option>)}
        </optgroup>
      : <option value={root.name} key={root.name}>{root.name}</option>)}
    <option value={CREATE_VALUE}>+ Criar nova categoria…</option>
  </select>;
}
