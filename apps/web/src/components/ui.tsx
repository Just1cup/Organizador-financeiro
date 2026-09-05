import type { HTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { Inbox } from "lucide-react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}

export function SectionTitle({ children, action, icon }: PropsWithChildren<{ action?: ReactNode; icon?: ReactNode }>) {
  return <div className="section-title"><h2>{icon}{children}</h2>{action}</div>;
}

export function Progress({ value, tone = "mint" }: { value: number; tone?: "mint" | "cyan" | "purple" | "warning" }) {
  return <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span className={tone} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <Card className="empty"><Inbox size={28} aria-hidden="true"/><strong>{title}</strong><p>{text}</p>{action}</Card>;
}

export function Spinner({ label = "Carregando" }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{label}</div>;
}
