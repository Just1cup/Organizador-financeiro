import {
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Plus,
  Receipt,
  TrendingDown,
  TrendingUp,
  WalletCards
} from "lucide-react";
import type { CSSProperties } from "react";
import type { DashboardData, Transaction } from "../types";
import { money, shortDate } from "../lib/api";
import { Card, EmptyState, Progress, SectionTitle } from "../components/ui";

const chartColors = ["#62dcae", "#ff7168", "#f4bd50", "#74a7ff", "#a98ae8", "#758493"];

function monthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return "Mês atual";
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function TransactionRow({ item, onManage }: { item: Transaction; onManage: () => void }) {
  const income = item.amount_cents > 0;
  return <div className="transaction-row">
    <span className={`transaction-icon ${income ? "positive" : ""}`} aria-hidden="true"><Receipt size={18}/></span>
    <span className="transaction-copy"><strong>{item.description}</strong><small>{item.category} · {item.source.replace("_csv", "").toUpperCase()}</small></span>
    <span className="transaction-date">{shortDate(item.occurred_at)}</span>
    <span className={income ? "money positive-text" : "money danger-text"}>{income ? "+" : "−"}{money(Math.abs(item.amount_cents))}</span>
    <button className="row-action" type="button" onClick={onManage} aria-label={`Gerenciar lançamento ${item.description}`}><ChevronRight size={18}/></button>
  </div>;
}

function CategoryOverview({ data, onNavigate }: { data: DashboardData; onNavigate: (page: "categories") => void }) {
  const items = data.categories.slice(0, 6);
  const total = items.reduce((sum, item) => sum + item.total_cents, 0);
  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    cursor += total ? item.total_cents / total * 100 : 0;
    return `${chartColors[index]} ${start}% ${cursor}%`;
  });
  const chartStyle = { "--category-chart": stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#253344 0 100%)" } as CSSProperties;

  return <section className="category-overview" aria-labelledby="category-heading">
    <SectionTitle icon={<CircleDollarSign/>} action={<button className="text-button" type="button" onClick={() => onNavigate("categories")}>Gerenciar <ArrowRight size={15}/></button>}><span id="category-heading">Gastos por categoria</span></SectionTitle>
    {items.length ? <div className="category-layout">
      <div className="donut" style={chartStyle} role="img" aria-label={`Total de saídas: ${money(total)}`}><span><b>{money(total)}</b><small>em saídas</small></span></div>
      <div className="category-list">{items.map((item, index) => <div className="category-row" key={item.category}>
        <i style={{ backgroundColor: chartColors[index] }} aria-hidden="true"/>
        <span><strong>{item.category}</strong><small>{item.count} {item.count === 1 ? "lançamento" : "lançamentos"}</small></span>
        <b>{money(item.total_cents)}</b>
      </div>)}</div>
    </div> : <EmptyState title="Sem gastos neste mês" text="As categorias aparecem conforme você registra saídas."/>}
  </section>;
}

export function Dashboard({
  data,
  onNavigate,
  onNewTransaction,
  onChangeMonth,
  onResetMonth
}: {
  data: DashboardData;
  onNavigate: (page: "assistant" | "sources" | "transactions" | "categories") => void;
  onNewTransaction: () => void;
  onChangeMonth: (delta: number) => void;
  onResetMonth?: () => void;
}) {
  const { summary } = data;
  const monthNet = summary.income_cents - summary.expense_cents;
  // Quem sabe qual é o mês corrente é o servidor (que conhece APP_TIME_ZONE); comparar aqui
  // contra o mês em UTC erraria na virada, habilitando "próximo mês" para um mês futuro.
  const isCurrentMonth = data.is_current_month;

  return <div className="screen dashboard-screen">
    <header className="page-header dashboard-heading">
      <div>
        <h1>Visão geral</h1>
        <div className="month-nav">
          <button type="button" aria-label="Mês anterior" onClick={() => onChangeMonth(-1)}><ChevronLeft size={16}/></button>
          <p><CalendarDays size={16}/> {monthLabel(data.month)}</p>
          <button type="button" aria-label="Próximo mês" disabled={isCurrentMonth} onClick={() => onChangeMonth(1)}><ChevronRight size={16}/></button>
          {onResetMonth ? <button className="text-button" type="button" onClick={onResetMonth}>Mês atual</button> : null}
        </div>
      </div>
      <button className="button primary page-primary" type="button" onClick={onNewTransaction}><Plus size={19}/> Novo lançamento</button>
    </header>

    <Card className="financial-summary">
      <div className="balance-block"><span>Saldo do mês</span><strong>{money(summary.balance_cents)}</strong><small>Entradas menos saídas no período</small></div>
      <div className="summary-metric"><span><TrendingDown size={16}/> Entradas</span><strong className="positive-text">{money(summary.income_cents)}</strong><small>Receitas confirmadas</small></div>
      <div className="summary-metric"><span><TrendingUp size={16}/> Saídas</span><strong className="danger-text">{money(summary.expense_cents)}</strong><small>Despesas confirmadas</small></div>
      <div className="summary-metric projection-metric"><span><Bot size={16}/> Projeção</span><strong className={monthNet >= 0 ? "positive-text" : "danger-text"}>{money(monthNet)}</strong><small>Resultado no ritmo atual</small></div>
    </Card>

    <div className="insight-grid">
      <CategoryOverview data={data} onNavigate={onNavigate}/>
      <section className="budget-overview">
        <SectionTitle action={<button className="text-button" type="button" onClick={() => onNavigate("sources")}>Gerenciar <ArrowRight size={15}/></button>} icon={<WalletCards/>}>Tetos por categoria</SectionTitle>
        {data.budgets.length ? <div className="budget-list">{data.budgets.slice(0, 5).map((budget) => {
          const percent = budget.limit_cents ? budget.spent_cents / budget.limit_cents * 100 : 0;
          return <div className="budget" key={budget.category}>
            <div><strong>{budget.category}</strong><span><b>{money(budget.spent_cents)}</b> de {money(budget.limit_cents)}</span></div>
            <Progress value={percent} tone={percent >= 85 ? "warning" : "mint"}/>
            <small><span>{percent >= 85 ? `Restam ${money(Math.max(0, budget.limit_cents - budget.spent_cents))}` : "Dentro do planejado"}</span><b>{Math.round(percent)}%</b></small>
          </div>;
        })}</div> : <EmptyState title="Nenhum teto definido" text="Crie limites mensais para acompanhar cada categoria." action={<button className="text-button" type="button" onClick={() => onNavigate("sources")}>Definir tetos</button>}/>} 
      </section>
    </div>

    <section className="recent-section">
      <SectionTitle action={<button className="text-button" type="button" onClick={() => onNavigate("transactions")}>Ver todos <ArrowRight size={15}/></button>}>Últimos lançamentos</SectionTitle>
      {data.recent.length ? <div className="transaction-list ledger-list">
        <div className="ledger-head" aria-hidden="true"><span>Descrição</span><span>Data</span><span>Valor</span><span/></div>
        {data.recent.map((item) => <TransactionRow key={item.id} item={item} onManage={() => onNavigate("transactions")}/>) }
      </div> : <EmptyState title="Ainda sem lançamentos" text="Adicione manualmente ou importe um extrato para começar." action={<button className="button primary" type="button" onClick={onNewTransaction}><Plus size={17}/> Novo lançamento</button>}/>} 
    </section>

    <div className="dashboard-actions">
      <button className="assistant-cta" type="button" onClick={() => onNavigate("assistant")}><CircleDollarSign/><span><strong>Pergunte ao GranaBot</strong><small>Entenda seus dados com processamento local</small></span><ChevronRight/></button>
      <button className="source-cta" type="button" onClick={() => onNavigate("sources")}><WalletCards/><span><strong>Fontes conectadas</strong><small>WhatsApp, CSV e regras mensais</small></span><ChevronRight/></button>
    </div>
  </div>;
}
