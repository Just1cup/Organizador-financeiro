import { ArrowRightLeft, Check, History, MessageSquareText, ReceiptText, RotateCcw, ShieldCheck, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { api, money, shortDate } from "../lib/api";
import type { Candidate, ReconciliationRecord, Transaction } from "../types";
import { Card, EmptyState, Progress, SectionTitle, Spinner } from "../components/ui";

function SourceBox({ item }: { item: Transaction }) {
  const whatsapp = item.source === "whatsapp";
  return <div className="source-box"><span className={whatsapp ? "positive-text" : "purple-text"}>{whatsapp ? <MessageSquareText size={16}/> : <ReceiptText size={16}/>} {item.source.replace("_csv", "").toUpperCase()}</span><strong>{item.description}</strong><small>{shortDate(item.occurred_at)}</small><b>{money(item.amount_cents)}</b></div>;
}

export function Reconciliation({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [history, setHistory] = useState<ReconciliationRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => Promise.all([
    api<Candidate[]>("/reconciliations/candidates"),
    api<ReconciliationRecord[]>("/reconciliations")
  ]).then(([nextItems, nextHistory]) => { setItems(nextItems); setHistory(nextHistory); }).catch((cause) => setError(cause.message));
  useEffect(() => { void load(); }, []);
  async function merge(item: Candidate) {
    setBusy(item.id); setError("");
    try {
      await api("/reconciliations", { method: "POST", body: JSON.stringify({ primary_id: item.right.id, secondary_id: item.left.id, score: item.score }) });
      await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conciliar"); }
    finally { setBusy(null); }
  }
  async function undo(item: ReconciliationRecord) {
    setBusy(item.id); setError("");
    try { await api(`/reconciliations/${item.id}`, { method: "DELETE" }); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao desfazer conciliação"); }
    finally { setBusy(null); }
  }
  return <div className="screen reconciliation-screen">
    <header className="page-header">
      <div><h1>Conciliação</h1><p>Revise possíveis duplicidades entre WhatsApp e extratos.</p></div>
      <span className="service-state"><i/> Motor ativo</span>
    </header>
    <Card className="reconciliation-summary"><span className="summary-symbol"><ShieldCheck/></span><div><strong>{items?.length || 0}</strong><span>{items?.length === 1 ? "sugestão aguarda revisão" : "sugestões aguardam revisão"}</span></div><Progress value={items?.length ? 72 : 100}/></Card>
    <SectionTitle icon={<ShieldCheck/>} action={items?.length ? <span className="counter">{items.length} {items.length === 1 ? "toque" : "toques"}</span> : null}>Sugestões de conciliação</SectionTitle>
    {error ? <div className="form-error">{error}</div> : null}
    {items === null ? <Spinner label="Analisando lançamentos"/> : items.length ? <div className="candidate-list">{items.map((item) => <Card className="candidate" key={item.id}>
      <div className="match-head"><span><ShieldCheck size={17}/>{item.score}% de confiança</span><small>{Math.abs(Math.abs(item.left.amount_cents) - Math.abs(item.right.amount_cents)) ? `Diferença de ${money(Math.abs(Math.abs(item.left.amount_cents) - Math.abs(item.right.amount_cents)))}` : "Valor idêntico • mesma janela"}</small></div>
      <div className="source-grid"><SourceBox item={item.left}/><SourceBox item={item.right}/></div>
      <div className="candidate-actions"><button className="button primary" disabled={busy === item.id} onClick={() => merge(item)}><ArrowRightLeft size={17}/>{busy === item.id ? "Unificando…" : "Confirmar fusão"}</button><button className="button secondary" onClick={() => setItems((current) => current?.filter((candidate) => candidate.id !== item.id) ?? [])}><Unlink size={16}/>Separar</button></div>
    </Card>)}</div> : <EmptyState title="Tudo conciliado" text="Nenhuma duplicidade provável aguarda sua revisão." action={<span className="success-inline"><Check size={15}/> Monitoramento ativo</span>}/>} 
    {history.length ? <><SectionTitle icon={<History/>}>Fusões recentes</SectionTitle><Card className="reconciliation-history">{history.slice(0, 8).map((item) => <div className="history-row" key={item.id}><span><strong>{item.primary_description}</strong><small>{item.status === "undone" ? "Desfeita" : item.status === "automatic" ? `Automática • ${item.score}%` : `Confirmada • ${item.score}%`}</small></span>{item.status !== "undone" ? <button className="icon-button" title="Desfazer fusão" aria-label={`Desfazer fusão de ${item.secondary_description}`} disabled={busy === item.id} onClick={() => void undo(item)}><RotateCcw size={17}/></button> : <Check size={17} className="muted-icon"/>}</div>)}</Card></> : null}
  </div>;
}
