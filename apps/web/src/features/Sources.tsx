import { CalendarDays, Check, FileSpreadsheet, Landmark, MessageCircle, Plus, RefreshCw, Sparkles, Tags, Target, UploadCloud, WalletCards } from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CategoryPicker } from "../components/CategoryPicker";
import { api, money } from "../lib/api";
import type { Category, DashboardData, MergeSuggestion } from "../types";
import { Card, EmptyState, Progress, SectionTitle, Spinner } from "../components/ui";

type Preview = { filename: string; source: string; total: number; preview: Array<{ description: string; amountCents: number; occurredAt: string; name: string; is_new: boolean }> };
type HistoryMode = "latest" | "all";
type ImportState = "idle" | "running" | "completed" | "error";
type WhatsAppState = {
  state: "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "error" | "offline";
  qr: string | null;
  selected_chat: string | null;
  history_mode: HistoryMode | null;
  import_state: ImportState;
  imported_count: number;
  processed_count: number;
  skipped_count: number;
  import_error: string | null;
};
type WhatsAppSelectionResult = Partial<WhatsAppState> & { ok?: boolean };
type Chat = { id: string; name: string; selected: boolean };

export function Sources({ data, onChanged }: { data: DashboardData; onChanged: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showGoal, setShowGoal] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [whatsapp, setWhatsapp] = useState<WhatsAppState | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatError, setChatError] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [draftChatId, setDraftChatId] = useState("");
  const [draftHistoryMode, setDraftHistoryMode] = useState<HistoryMode | "">("");
  const chatsRequested = useRef(false);
  const selectionInitialized = useRef(false);
  const previousImportState = useRef<ImportState | undefined>(undefined);
  const onChangedRef = useRef(onChanged);

  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  async function refreshChats() {
    chatsRequested.current = true; setChatBusy(true); setChatError("");
    try {
      const nextChats = await api<Chat[]>("/sources/whatsapp/chats");
      setChats(nextChats);
      if (!nextChats.length) setChatError("Nenhuma conversa individual foi encontrada nesta sessão.");
    } catch (cause) { setChatError(cause instanceof Error ? cause.message : "Não foi possível carregar as conversas"); }
    finally { setChatBusy(false); }
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next = await api<WhatsAppState>("/sources/whatsapp").catch(() => ({
        state: "offline", qr: null, selected_chat: null, history_mode: null, import_state: "idle",
        imported_count: 0, processed_count: 0, skipped_count: 0, import_error: null
      } as WhatsAppState));
      if (!active) return;
      setWhatsapp(next);
      if (next.state === "ready") {
        if (!selectionInitialized.current) {
          setDraftChatId(next.selected_chat || "");
          setDraftHistoryMode(next.history_mode || "");
          selectionInitialized.current = true;
        }
        if (!chatsRequested.current) void refreshChats();
      } else {
        chatsRequested.current = false; selectionInitialized.current = false;
        setChats([]); setChatError(""); setDraftChatId(""); setDraftHistoryMode("");
      }
      if (previousImportState.current === "running" && next.import_state === "completed") onChangedRef.current();
      previousImportState.current = next.import_state;
    };
    void load(); const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function chooseChat(chatId: string) {
    setDraftChatId(chatId);
    setChatError("");
    setDraftHistoryMode(chatId === whatsapp?.selected_chat ? whatsapp.history_mode || "" : "");
  }

  async function confirmChatSelection() {
    if (!draftChatId || !draftHistoryMode) return;
    setSelectBusy(true); setChatError("");
    try {
      const result = await api<WhatsAppSelectionResult>("/sources/whatsapp/select", {
        method: "POST", body: JSON.stringify({ chat_id: draftChatId, history_mode: draftHistoryMode })
      });
      setChats((current) => current.map((chat) => ({ ...chat, selected: chat.id === draftChatId })));
      setWhatsapp((current) => current ? {
        ...current, ...result, selected_chat: result.selected_chat ?? draftChatId,
        history_mode: result.history_mode ?? draftHistoryMode
      } : current);
      if (result.import_state) previousImportState.current = result.import_state;
      if (result.import_state === "completed") onChangedRef.current();
    } catch (cause) { setChatError(cause instanceof Error ? cause.message : "Não foi possível autorizar e ler a conversa"); }
    finally { setSelectBusy(false); }
  }

  async function inspect(selected: File) {
    setFile(selected); setBusy(true); setMessage("");
    const body = new FormData(); body.append("file", selected);
    try { setPreview(await api<Preview>("/imports/csv?mode=preview", { method: "POST", body })); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Não foi possível ler o arquivo"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return; setBusy(true); const body = new FormData(); body.append("file", file);
    try {
      const result = await api<{ inserted: number; duplicated: number }>("/imports/csv?mode=commit", { method: "POST", body });
      setMessage(`${result.inserted} lançamentos importados${result.duplicated ? ` • ${result.duplicated} já existentes` : ""}.`); setPreview(null); setFile(null); onChanged();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Falha na importação"); }
    finally { setBusy(false); }
  }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { const selected = event.target.files?.[0]; if (selected) void inspect(selected); };
  const drop = (event: DragEvent) => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected) void inspect(selected); };
  const importRunning = whatsapp?.import_state === "running";
  const selectionMatchesCurrent = Boolean(
    draftChatId && draftHistoryMode && draftChatId === whatsapp?.selected_chat && draftHistoryMode === whatsapp.history_mode
  );

  return <div className="screen sources-screen">
    <header className="page-header">
      <div><h1>Metas & Fontes</h1><p>Organize seus objetivos e escolha de onde chegam os lançamentos.</p></div>
      <span className="service-state"><i/> Monitoramento ativo</span>
    </header>
    <SectionTitle icon={<Target/>} action={<button className="text-button" onClick={() => setShowGoal(!showGoal)}>Nova meta <Plus size={14}/></button>}>Metas financeiras ativas</SectionTitle>
    {showGoal ? <GoalForm onDone={() => { setShowGoal(false); onChanged(); }}/>: null}
    {data.goals.length ? <div className="goal-list">{data.goals.map((goal) => {
      const percent = goal.target_cents ? goal.current_cents / goal.target_cents * 100 : 0;
      return <Card className="goal-card" key={goal.id}><div className="goal-head"><span className="goal-icon"><Target/></span><span><strong>{goal.name}</strong><small>Meta: {money(goal.target_cents)}</small></span><em>{Math.round(percent)}%</em></div><div className="goal-value"><b>{money(goal.current_cents)}</b><span>/ {money(goal.target_cents)}</span></div><Progress value={percent}/>{goal.target_date ? <small className="goal-date"><CalendarDays size={13}/> Prazo: {new Date(goal.target_date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</small> : null}</Card>;
    })}</div> : <EmptyState title="Nenhuma meta criada" text="Defina um objetivo e acompanhe seu progresso."/>}

    <SectionTitle icon={<WalletCards/>} action={<button className="text-button" onClick={() => setShowBudget(!showBudget)}>Definir teto <Plus size={14}/></button>}>Tetos mensais</SectionTitle>
    {showBudget ? <BudgetForm onDone={() => { setShowBudget(false); onChanged(); }}/> : null}
    {data.budgets.length ? <Card className="budget-list">{data.budgets.map((budget) => {
      const percent = budget.limit_cents ? budget.spent_cents / budget.limit_cents * 100 : 0;
      return <div className="budget" key={budget.category}><div><strong>{budget.category}</strong><span>{Math.round(percent)}%</span></div><Progress value={percent}/><small><b>{money(budget.spent_cents)} usados</b><span>de {money(budget.limit_cents)}</span></small></div>;
    })}</Card> : <EmptyState title="Nenhum teto definido" text="Crie limites por categoria para acompanhar o mês."/>}

    <CategoriesPanel onChanged={onChanged}/>

    <SectionTitle icon={<Sparkles/>} action={<span className="section-meta">Tempo real</span>}>Canais de ingestão</SectionTitle>
    <div className="source-cards">
      <Card className="integration-card"><div className="integration-title"><span className="integration-icon green"><MessageCircle/></span><span><strong>WhatsApp Bot</strong><small>Conversa financeira dedicada</small></span><em className={whatsapp?.state === "ready" ? "" : "offline"}>{whatsapp?.state === "ready" ? <><i/> Online</> : whatsapp?.state === "qr" ? "Aguardando QR" : "Desconectado"}</em></div><p>Envie mensagens rápidas como “Mercado 82,50”. Apenas a conversa escolhida será processada.</p>
        {whatsapp?.qr ? <div className="qr-panel"><img src={whatsapp.qr} alt="QR Code para conectar o WhatsApp"/><span>Abra o WhatsApp no celular e acesse <b>Aparelhos conectados</b>.</span></div> : null}
        {whatsapp?.state === "ready" ? <div className="chat-panel">
          <label className="chat-select" htmlFor="whatsapp-chat">Conversa que o bot deve acompanhar
            <select
              id="whatsapp-chat"
              value={draftChatId}
              disabled={chatBusy || selectBusy || importRunning}
              aria-describedby="whatsapp-config-help"
              onChange={(event) => chooseChat(event.target.value)}
            >
              <option value="" disabled>{chatBusy ? "Carregando conversas…" : chats.length ? "Selecione uma conversa" : "Nenhuma conversa carregada"}</option>
              {draftChatId && !chats.some((chat) => chat.id === draftChatId) ? <option value={draftChatId}>Conversa selecionada</option> : null}
              {chats.map((chat) => <option value={chat.id} key={chat.id}>{chat.name}</option>)}
            </select>
          </label>

          <fieldset className="history-mode" disabled={!draftChatId || selectBusy || importRunning}>
            <legend>O que deve ser lido?</legend>
            <label className={draftHistoryMode === "latest" ? "selected" : ""}>
              <input
                type="radio"
                name="whatsapp-history-mode"
                value="latest"
                checked={draftHistoryMode === "latest"}
                onChange={() => setDraftHistoryMode("latest")}
              />
              <span><strong>Somente a mensagem mais recente</strong><small>Analisa apenas a última mensagem disponível.</small></span>
            </label>
            <label className={draftHistoryMode === "all" ? "selected" : ""}>
              <input
                type="radio"
                name="whatsapp-history-mode"
                value="all"
                checked={draftHistoryMode === "all"}
                onChange={() => setDraftHistoryMode("all")}
              />
              <span><strong>Ler histórico inteiro</strong><small>Percorre todas as mensagens disponíveis na conversa.</small></span>
            </label>
          </fieldset>

          <WhatsAppImportStatus
            whatsapp={whatsapp}
            chatError={chatError}
            selectBusy={selectBusy}
            draftChatId={draftChatId}
            draftHistoryMode={draftHistoryMode}
            selectionMatchesCurrent={selectionMatchesCurrent}
          />

          <small id="whatsapp-config-help" className="chat-config-help">A conversa e o modo só mudam depois da confirmação.</small>
          <div className="chat-actions">
            <button className="button secondary" type="button" disabled={chatBusy || selectBusy} onClick={() => void refreshChats()}>
              <RefreshCw size={15} className={chatBusy ? "spin-icon" : ""}/>{chatBusy ? "Carregando…" : "Atualizar conversas"}
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!draftChatId || !draftHistoryMode || selectBusy || importRunning}
              onClick={() => void confirmChatSelection()}
            >
              {selectBusy ? <><RefreshCw size={15} className="spin-icon"/> Iniciando leitura…</> : importRunning ? "Leitura em andamento" : selectionMatchesCurrent ? "Ler novamente" : "Confirmar e iniciar leitura"}
            </button>
          </div>
        </div> : null}
        {whatsapp?.state === "offline" ? <button className="button secondary full" disabled>Serviço indisponível</button> : null}
      </Card>
      <Card className="integration-card"><div className="integration-title"><span className="integration-icon purple"><Landmark/></span><span><strong>Extratos bancários</strong><small>Nubank, Itaú e CSV genérico</small></span><em><i/> Local</em></div><p>Os arquivos são processados apenas no servidor local e protegidos contra reimportações.</p></Card>
    </div>

    <SectionTitle icon={<FileSpreadsheet/>} action={<span className="section-meta">CSV • 25 MB</span>}>Importação manual</SectionTitle>
    <Card
      className={`drop-zone ${busy ? "busy" : ""}`}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      aria-label="Selecionar arquivo CSV para importação"
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      onClick={() => !busy && fileInput.current?.click()}
      onKeyDown={(event) => {
        if (!busy && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          fileInput.current?.click();
        }
      }}
    >
      <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={handleFile}/><span><UploadCloud/></span><strong>{busy ? "Lendo arquivo…" : "Arraste ou selecione um arquivo"}</strong><p>CSV do Nubank, Itaú ou outro banco</p>
    </Card>
    {preview ? <Card className="preview-card"><div><strong>{preview.filename}</strong><span>{preview.total} lançamentos reconhecidos • {preview.source.replace("_csv", "")}</span></div><div className="preview-rows">{preview.preview.slice(0, 4).map((row, index) => <p key={`${row.occurredAt}-${index}`}><span>{row.description} <em className={row.is_new ? "category-badge new" : "category-badge"}>{row.is_new ? `Nova: ${row.name}` : row.name}</em></span><b>{money(row.amountCents)}</b></p>)}</div><button className="button primary full" onClick={commit} disabled={busy}><Check size={17}/>{busy ? "Importando…" : `Confirmar ${preview.total} lançamentos`}</button></Card> : null}
    {message ? <div className="import-message"><Check size={17}/>{message}</div> : null}
    <Card className="privacy-note"><Sparkles/><p>O motor local categoriza, evita registros duplicados e prepara somente agregados financeiros para o GranaBot.</p></Card>
  </div>;
}

function WhatsAppImportStatus({
  whatsapp, chatError, selectBusy, draftChatId, draftHistoryMode, selectionMatchesCurrent
}: {
  whatsapp: WhatsAppState;
  chatError: string;
  selectBusy: boolean;
  draftChatId: string;
  draftHistoryMode: HistoryMode | "";
  selectionMatchesCurrent: boolean;
}) {
  if (chatError) return <div className="whatsapp-import-status error" role="alert"><span><strong>Não foi possível concluir</strong><small>{chatError}</small></span></div>;
  if (selectBusy) return <div className="whatsapp-import-status running" role="status" aria-live="polite"><RefreshCw className="spin-icon"/><span><strong>Preparando a leitura</strong><small>Autorizando a conversa e iniciando o processamento…</small></span></div>;

  const mode = whatsapp.history_mode || draftHistoryMode;
  const counts = `${whatsapp.processed_count || 0} processadas · ${whatsapp.imported_count || 0} importadas · ${whatsapp.skipped_count || 0} ignoradas`;
  if (whatsapp.import_state === "running") return <div className="whatsapp-import-status running" role="status" aria-live="polite">
    <RefreshCw className="spin-icon"/>
    <span><strong>{mode === "all" ? "Lendo o histórico inteiro" : "Lendo a mensagem mais recente"}</strong><small>{counts}</small></span>
    <span className="import-progress" aria-hidden="true"><i/></span>
  </div>;
  if (!draftChatId) return <div className="whatsapp-import-status neutral" role="status"><span><strong>Escolha uma conversa</strong><small>O bot só terá acesso à conversa que você confirmar.</small></span></div>;
  if (!draftHistoryMode) return <div className="whatsapp-import-status neutral" role="status"><span><strong>Escolha o modo de leitura</strong><small>Você decide se o bot analisa só a última mensagem ou todo o histórico.</small></span></div>;
  if (!selectionMatchesCurrent) return <div className="whatsapp-import-status pending" role="status"><span><strong>Configuração pronta para confirmar</strong><small>Nenhuma conversa será lida antes de você confirmar abaixo.</small></span></div>;
  if (whatsapp.import_state === "error" || whatsapp.import_error) return <div className="whatsapp-import-status error" role="alert"><span><strong>Falha ao ler a conversa</strong><small>{whatsapp.import_error || "O WhatsApp não conseguiu processar as mensagens."}</small></span></div>;
  if (whatsapp.import_state === "completed") return <div className="whatsapp-import-status success" role="status" aria-live="polite">
    <Check/>
    <span><strong>Leitura concluída</strong><small>{counts}</small></span>
  </div>;
  return <div className="whatsapp-import-status success" role="status"><Check/><span><strong>Conversa protegida e autorizada</strong><small>Use “Ler novamente” para executar uma nova leitura.</small></span></div>;
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await api("/goals", { method: "POST", body: JSON.stringify({ name: form.get("name"), target_cents: Math.round(Number(form.get("target")) * 100), current_cents: Math.round(Number(form.get("current")) * 100), target_date: form.get("date") || undefined }) }); onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar meta"); }
    finally { setBusy(false); }
  }
  return <Card><form className="goal-form" onSubmit={submit}><label>Nome<input name="name" placeholder="Reserva de emergência" required minLength={2}/></label><div><label>Objetivo (R$)<input name="target" type="number" min="1" step="0.01" required/></label><label>Já guardado (R$)<input name="current" type="number" min="0" step="0.01" defaultValue="0" required/></label></div><label>Prazo opcional<input name="date" type="date"/></label>{error ? <div className="form-error">{error}</div> : null}<button className="button primary" disabled={busy}>{busy ? "Salvando…" : "Criar meta"}</button></form></Card>;
}

function BudgetForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("Alimentação");
  useEffect(() => { void api<Category[]>("/categories").then((next) => setCategories(next.filter((item) => item.name !== "Receitas"))).catch(() => undefined); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await api(`/budgets/${encodeURIComponent(category)}`, { method: "PUT", body: JSON.stringify({ limit_cents: Math.round(Number(form.get("limit")) * 100) }) }); onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao definir teto"); }
    finally { setBusy(false); }
  }
  return <Card><form className="goal-form" onSubmit={submit}>
    <label>Categoria<CategoryPicker value={category} categories={categories} onChange={setCategory} onCreated={() => { void api<Category[]>("/categories").then((next) => setCategories(next.filter((item) => item.name !== "Receitas"))); }}/></label>
    <label>Limite mensal (R$)<input name="limit" type="number" min="1" step="0.01" required placeholder="800,00"/></label>
    {error ? <div className="form-error">{error}</div> : null}
    <button className="button primary" disabled={busy}>{busy ? "Salvando…" : "Salvar teto"}</button>
  </form></Card>;
}

function CategoriesPanel({ onChanged }: { onChanged: () => void }) {
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
    } catch { /* painel de apoio: uma falha aqui não deve travar Metas & Fontes */ }
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

  return <>
    <SectionTitle icon={<Tags/>} action={<button className="text-button" onClick={() => setShowCreate(!showCreate)}>Nova categoria <Plus size={14}/></button>}>Categorias</SectionTitle>
    {showCreate ? <CategoryCreateForm categories={categories} onDone={() => { setShowCreate(false); void load(); }}/> : null}
    {message ? <div className="import-message"><Check size={17}/>{message}</div> : null}
    {suggestions.length ? <Card className="merge-suggestions">
      <strong>Possíveis duplicidades</strong>
      {suggestions.map((group) => {
        const key = group.names.join("|");
        return <div className="merge-suggestion-row" key={key}>
          <span>{group.names.join(" · ")}</span>
          <button className="button secondary" type="button" disabled={mergeBusy === key} onClick={() => void mergeGroup(group)}>
            {mergeBusy === key ? "Fundindo…" : "Fundir"}
          </button>
        </div>;
      })}
    </Card> : null}
    {loading ? <Spinner label="Carregando categorias"/> : topLevel.length ? <Card className="category-tree">
      {topLevel.map((item) => <div className="category-tree-row" key={item.name}>
        <div><strong>{item.name}</strong><small>{item.transaction_count} {item.transaction_count === 1 ? "lançamento" : "lançamentos"}{item.is_system ? " · padrão" : ""}</small></div>
        {childrenOf(item.name).length ? <div className="category-tree-children">{childrenOf(item.name).map((child) => <span key={child.name}>{child.name} <i>{child.transaction_count}</i></span>)}</div> : null}
      </div>)}
    </Card> : <EmptyState title="Nenhuma categoria" text="As categorias aparecem automaticamente conforme você lança ou importa dados."/>}
  </>;
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
