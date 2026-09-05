import {
  Bot,
  Landmark,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Tags,
  type LucideIcon
} from "lucide-react";
import type { PropsWithChildren } from "react";

export type Tab = "overview" | "transactions" | "categories" | "reconciliation" | "assistant" | "sources";

type NavigationItem = {
  id: Tab;
  label: string;
  mobileLabel: string;
  description: string;
  Icon: LucideIcon;
};

const tabs: NavigationItem[] = [
  { id: "overview", label: "Visão geral", mobileLabel: "Visão", description: "Resumo do mês", Icon: LayoutDashboard },
  { id: "transactions", label: "Lançamentos", mobileLabel: "Lançamentos", description: "Entradas e saídas", Icon: ReceiptText },
  { id: "categories", label: "Categorias", mobileLabel: "Categorias", description: "Organize e ensine", Icon: Tags },
  { id: "reconciliation", label: "Conciliação", mobileLabel: "Conciliar", description: "Revisar duplicidades", Icon: Repeat2 },
  { id: "assistant", label: "GranaBot", mobileLabel: "Assistente", description: "Análises com IA local", Icon: Bot },
  { id: "sources", label: "Metas e fontes", mobileLabel: "Fontes", description: "Integrações e planos", Icon: Landmark }
];

type NavigationButtonProps = {
  item: NavigationItem;
  active: boolean;
  reconciliationCount: number;
  compact?: boolean;
  onSelect: (tab: Tab) => void;
};

function NavigationButton({ item, active, reconciliationCount, compact = false, onSelect }: NavigationButtonProps) {
  const { id, label, mobileLabel, description, Icon } = item;
  const pending = id === "reconciliation" ? reconciliationCount : 0;
  const accessibleLabel = pending > 0 ? `${label}, ${pending} pendências` : label;

  return <button
    type="button"
    className={`${compact ? "bottom-nav-item" : "sidebar-nav-item"}${active ? " active" : ""}`}
    onClick={() => onSelect(id)}
    aria-current={active ? "page" : undefined}
    aria-label={accessibleLabel}
  >
    <span className="nav-icon" aria-hidden="true">
      <Icon size={compact ? 21 : 19}/>
      {pending > 0 ? <em>{Math.min(pending, 99)}</em> : null}
    </span>
    {compact
      ? <span className="nav-label">{mobileLabel}</span>
      : <span className="sidebar-nav-copy"><strong>{label}</strong><small>{description}</small></span>}
  </button>;
}

export function AppShell({ tab, onTab, reconciliationCount, onLogout, children }: PropsWithChildren<{
  tab: Tab;
  onTab: (tab: Tab) => void;
  reconciliationCount: number;
  onLogout: () => void;
}>) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>

    <aside className="sidebar desktop-sidebar" aria-label="Menu principal">
      <button type="button" className="brand sidebar-brand" onClick={() => onTab("overview")} aria-label="Ir para visão geral">
        <span className="brand-mark"><Sparkles size={19}/></span>
        <span className="brand-copy"><strong>Fluxo AI</strong><small>Finanças pessoais</small></span>
      </button>

      <nav className="sidebar-nav" aria-label="Navegação principal">
        {tabs.map((item) => <NavigationButton
          key={item.id}
          item={item}
          active={tab === item.id}
          reconciliationCount={reconciliationCount}
          onSelect={onTab}
        />)}
      </nav>

      <footer className="sidebar-footer">
        <div className="local-status" role="status" aria-label="Processamento local ativo">
          <span className="local-status-icon"><ShieldCheck size={17}/></span>
          <span><strong>Ambiente local</strong><small>Dados protegidos neste dispositivo</small></span>
          <i aria-hidden="true"/>
        </div>
        <button type="button" className="logout-button" onClick={onLogout}>
          <LogOut size={18}/><span>Encerrar sessão</span>
        </button>
      </footer>
    </aside>

    <div className="app-frame">
      <header className="topbar mobile-topbar">
        <button type="button" className="brand mobile-brand" onClick={() => onTab("overview")} aria-label="Ir para visão geral">
          <span className="brand-mark"><Sparkles size={17}/></span>
          <span className="brand-copy"><strong>Fluxo AI</strong><small><i/> Processamento local</small></span>
        </button>
        <button type="button" className="mobile-logout" onClick={onLogout} aria-label="Encerrar sessão">
          <LogOut size={18}/><span>Sair</span>
        </button>
      </header>

      <main id="main-content" className="content" tabIndex={-1}>{children}</main>
    </div>

    <nav className="bottom-nav mobile-bottom-nav" aria-label="Navegação principal">
      {tabs.map((item) => <NavigationButton
        key={item.id}
        item={item}
        active={tab === item.id}
        reconciliationCount={reconciliationCount}
        compact
        onSelect={onTab}
      />)}
    </nav>
  </div>;
}
