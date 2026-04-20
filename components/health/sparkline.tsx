import { cn } from "@/lib/utils";

interface Props {
  values: number[];
  flag?: "high" | "low" | "ok" | null;
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({
  values,
  flag,
  width = 240,
  height = 38,
  className,
}: Props) {
  if (values.length === 0) {
    return (
      <div
        className={cn("text-border font-mono text-[11px]", className)}
        style={{ width, height }}
      >
        no data
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2;
  const stroke =
    flag === "high"
      ? "hsl(var(--flag-high))"
      : flag === "low"
        ? "hsl(var(--flag-low))"
        : "hsl(var(--foreground))";

  const n = values.length;
  const denom = Math.max(1e-9, max - min);
  const sx = (i: number) =>
    pad + (n === 1 ? (width - 2 * pad) / 2 : (i / (n - 1)) * (width - 2 * pad));
  const sy = (v: number) =>
    height - pad - ((v - min) / denom) * (height - 2 * pad);

  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.length === 1 && (
        <circle cx={sx(0)} cy={sy(values[0])} r={2.5} fill={stroke} />
      )}
    </svg>
  );
}
