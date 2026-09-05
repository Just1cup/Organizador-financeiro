import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";

export function AuthScreen({ initialized, onSuccess }: { initialized: boolean; onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!initialized && password !== confirm) {
      setError("As senhas não coincidem");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api(initialized ? "/auth/login" : "/auth/bootstrap", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao entrar");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <div className="auth-shell">
      <section className="auth-intro" aria-labelledby="auth-intro-title">
        <div className="auth-brand">
          <span className="auth-logo"><Sparkles size={25}/></span>
          <span><strong>Fluxo AI</strong><small>Seu espaço financeiro pessoal</small></span>
        </div>
        <div className="auth-intro-copy">
          <h2 id="auth-intro-title">Clareza para cuidar melhor do seu dinheiro.</h2>
          <p>Organize lançamentos, acompanhe metas e converse com seu assistente financeiro em um só lugar.</p>
        </div>
        <div className="auth-privacy-note">
          <ShieldCheck size={20}/>
          <span><strong>Privado por padrão</strong><small>Processamento local, sob o seu controle.</small></span>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <header className="auth-panel-header">
          <span className="auth-panel-icon"><LockKeyhole size={21}/></span>
          <h1 id="auth-title">{initialized ? "Bem-vindo de volta" : "Proteja seu espaço"}</h1>
          <p>{initialized ? "Entre com sua senha para acessar o painel." : "Crie uma senha com pelo menos 8 caracteres para começar."}</p>
        </header>

        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="auth-password"><span>Senha</span></label>
          <div className="field-with-icon auth-password-field">
            <LockKeyhole size={18} aria-hidden="true"/>
            <input
              id="auth-password"
              autoFocus
              type={showPassword ? "text" : "password"}
              autoComplete={initialized ? "current-password" : "new-password"}
              minLength={8}
              value={password}
              onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }}
              placeholder="Mínimo de 8 caracteres"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-error" : undefined}
              disabled={busy}
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              disabled={busy}
            >
              {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          </div>

          {!initialized ? <>
            <label htmlFor="auth-confirm"><span>Confirme a senha</span></label>
            <div className="field-with-icon auth-password-field">
              <LockKeyhole size={18} aria-hidden="true"/>
              <input
                id="auth-confirm"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                value={confirm}
                onChange={(event) => { setConfirm(event.target.value); if (error) setError(""); }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "auth-error" : undefined}
                disabled={busy}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm((visible) => !visible)}
                aria-label={showConfirm ? "Ocultar confirmação de senha" : "Mostrar confirmação de senha"}
                aria-pressed={showConfirm}
                disabled={busy}
              >
                {showConfirm ? <EyeOff size={18}/> : <Eye size={18}/>}
              </button>
            </div>
          </> : null}

          {error ? <div id="auth-error" className="form-error" role="alert">{error}</div> : null}
          <button className="button primary full auth-submit" disabled={busy}>
            {busy ? <><LoaderCircle className="spin-icon" size={18}/> Aguarde…</> : <>{initialized ? "Entrar" : "Criar acesso"}<ArrowRight size={18}/></>}
          </button>
        </form>

        <p className="auth-footnote"><ShieldCheck size={15}/> Seus dados financeiros permanecem neste ambiente.</p>
      </section>
    </div>
  </main>;
}
