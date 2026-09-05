import { useCallback, useEffect, useState } from "react";
import { AppShell, type Tab } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { AuthScreen } from "./features/AuthScreen";
import { Dashboard } from "./features/Dashboard";
import { Transactions } from "./features/Transactions";
import { Reconciliation } from "./features/Reconciliation";
import { Assistant } from "./features/Assistant";
import { Sources } from "./features/Sources";
import { api, ApiError } from "./lib/api";
import type { AiStatus, DashboardData } from "./types";

type AuthState = "loading" | "setup" | "login" | "authenticated";

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState("");
  const [openCreateSignal, setOpenCreateSignal] = useState(0);

  const load = useCallback(async () => {
    try {
      const [nextDashboard, nextAi] = await Promise.all([api<DashboardData>("/dashboard"), api<AiStatus>("/ai/status")]);
      setDashboard(nextDashboard); setAi(nextAi); setError("");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuth("login");
      else setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus dados");
    }
  }, []);

  useEffect(() => {
    api<{ initialized: boolean; authenticated: boolean }>("/auth/status")
      .then((status) => setAuth(status.authenticated ? "authenticated" : status.initialized ? "login" : "setup"))
      .catch(() => setAuth("login"));
  }, []);
  useEffect(() => {
    if (auth !== "authenticated") return;
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 5_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [auth, load]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setDashboard(null); setTab("overview"); setAuth("login");
  }

  function newTransaction() {
    setOpenCreateSignal((current) => current + 1);
    setTab("transactions");
  }

  if (auth === "loading") return <div className="boot"><span className="brand-mark">✦</span><Spinner label="Iniciando Fluxo AI"/></div>;
  if (auth === "setup" || auth === "login") return <AuthScreen initialized={auth === "login"} onSuccess={() => setAuth("authenticated")}/>;
  if (!dashboard) return <div className="boot">{error ? <><p>{error}</p><button className="button primary" onClick={load}>Tentar novamente</button></> : <Spinner label="Organizando suas finanças"/>}</div>;

  return <AppShell tab={tab} onTab={setTab} reconciliationCount={dashboard.pending_reconciliations} onLogout={() => void logout()}>
    {error ? <div className="global-error" role="alert">{error}<button onClick={load}>Tentar novamente</button></div> : null}
    {tab === "overview" ? <Dashboard data={dashboard} onNavigate={setTab} onNewTransaction={newTransaction}/> : null}
    {tab === "transactions" ? <Transactions onChanged={load} openCreateSignal={openCreateSignal}/> : null}
    {tab === "reconciliation" ? <Reconciliation onChanged={load}/> : null}
    {tab === "assistant" ? <Assistant status={ai} dashboard={dashboard}/> : null}
    {tab === "sources" ? <Sources data={dashboard} onChanged={load}/> : null}
  </AppShell>;
}
