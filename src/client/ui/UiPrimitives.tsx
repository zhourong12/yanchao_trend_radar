import type { CollectionRecord } from "../../shared/types";
import { RefreshCw } from "lucide-react";

export function PageHeading({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}

export function Kpi({
  label,
  value,
  suffix,
  note,
  icon,
  tone = "default"
}: {
  label: string;
  value: number;
  suffix: string;
  note: string;
  icon: React.ReactNode;
  tone?: "default" | "positive" | "warning";
}) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
      <p>{note}</p>
    </article>
  );
}

export function Score({ value, large = false }: { value: number; large?: boolean }) {
  return (
    <span
      className={`score-badge ${large ? "is-large" : ""} ${value >= 75 ? "is-high" : value >= 55 ? "is-medium" : "is-low"}`}
    >
      {Math.round(value)}
    </span>
  );
}

export function DataState({ live, liveText, fallbackText }: { live: boolean; liveText: string; fallbackText: string }) {
  return (
    <span className={`data-state ${live ? "is-live" : "is-pending"}`}>
      <i />
      {live ? liveText : fallbackText}
    </span>
  );
}

export function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`status-badge ${ok ? "is-ok" : "is-failed"}`}>
      <i />
      {ok ? "最近采集成功" : "最近采集失败"}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span className={`risk-badge risk-${risk}`}>
      {risk === "low" ? "低风险" : risk === "medium" ? "中风险" : "高风险"}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: CollectionRecord["outcome"] }) {
  const labels = { mapped: "商品映射", filtered: "未命中", validation: "商业验证", demo: "Seed 演示" };
  return <span className={`outcome-badge outcome-${outcome}`}>{labels[outcome]}</span>;
}

export function LoadingState() {
  return (
    <div className="loading-state">
      <RefreshCw className="is-spinning" size={24} />
      <strong>正在汇总今日商业机会</strong>
      <span>采集状态、供给样本和验证进展正在同步</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
