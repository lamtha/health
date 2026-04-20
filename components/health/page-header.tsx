import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  crumbs?: string[];
  title: string;
  subtitle?: string;
  stats?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  crumbs = [],
  title,
  subtitle,
  stats,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("px-8 pt-6 pb-5", className)}>
      {crumbs.length > 0 && (
        <div className="mb-1 font-mono text-[11.5px] text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i}>
              {c}
              {i < crumbs.length - 1 && <span className="mx-1 text-border">/</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-serif-display text-[40px] leading-none tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-1.5 text-[13px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {stats && <div className="flex shrink-0 items-end gap-8">{stats}</div>}
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-serif-display mt-1 text-[28px] leading-none",
          accent,
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}
