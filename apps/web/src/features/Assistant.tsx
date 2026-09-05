import { ArrowUp, Bot, BrainCircuit, CircleAlert, Sparkles, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import type { AiStatus, DashboardData } from "../types";
import { Card } from "../components/ui";

type Message = { role: "user" | "assistant"; text: string; source?: string };
const prompts = ["Quanto gastei por categoria?", "Como está meu orçamento?", "Quais gastos parecem recorrentes?"];

export function Assistant({ status, dashboard }: { status: AiStatus | null; dashboard: DashboardData }) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "Olá! Posso analisar seus lançamentos, categorias, tetos e recorrências. Os cálculos vêm do motor financeiro; eu ajudo a interpretá-los." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(text = input) {
    const trimmed = text.trim(); if (!trimmed || busy) return;
    setMessages((current) => [...current, { role: "user", text: trimmed }]); setInput(""); setBusy(true);
    try {
      const result = await api<{ answer: string; source: string }>("/assistant", { method: "POST", body: JSON.stringify({ message: trimmed }) });
      setMessages((current) => [...current, { role: "assistant", text: result.answer, source: result.source }]);
    } catch (cause) { setMessages((current) => [...current, { role: "assistant", text: cause instanceof Error ? cause.message : "Não consegui responder agora." }]); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(); }
  return <div className="screen assistant-screen">
    <header className="page-header">
      <div><h1>GranaBot IA</h1><p>Converse com seus dados sem enviá-los para a nuvem.</p></div>
    </header>
    <Card className="assistant-header"><span className="bot-orb"><Bot/></span><span><small>GranaBot</small><strong>Seu copiloto financeiro</strong><em><i/> {status?.online && status.installed ? `${status.model} pronto` : status?.online ? "Baixando modelo local" : "Modo determinístico"}</em></span><span className="analytic"><BrainCircuit size={14}/> Analítico</span></Card>
    {!status?.online || !status.installed ? <div className="ai-notice"><CircleAlert size={18}/><span><strong>{status?.online ? "Modelo ainda não instalado" : "Ollama está offline"}</strong> O chat continuará exibindo resumos calculados pelo backend.</span></div> : null}
    <div className="chat-feed" aria-live="polite">
      {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
        <span className="message-avatar">{message.role === "assistant" ? <Bot size={18}/> : <UserRound size={18}/>}</span>
        <div><small>{message.role === "assistant" ? "GranaBot IA" : "Você"}</small><p>{message.text}</p>{message.source ? <em>{message.source === "ollama" ? "Processado localmente pelo Ollama" : "Resumo determinístico"}</em> : null}</div>
      </div>)}
      {busy ? <div className="message assistant"><span className="message-avatar"><Bot size={18}/></span><div><small>GranaBot IA</small><p className="thinking"><i/><i/><i/> Analisando dados locais…</p></div></div> : null}
    </div>
    {!dashboard.recent.length ? <Card className="chat-empty"><Sparkles/><div><strong>O GranaBot precisa de dados</strong><p>Importe um extrato para receber análises personalizadas.</p></div></Card> : null}
    <div className="suggestions"><span>Sugestões para você</span><div>{prompts.map((prompt) => <button key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div></div>
    <form className="chat-input" onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pergunte sobre suas finanças" aria-label="Mensagem para o GranaBot"/><button disabled={busy || !input.trim()} aria-label="Enviar"><ArrowUp/></button></form>
  </div>;
}
