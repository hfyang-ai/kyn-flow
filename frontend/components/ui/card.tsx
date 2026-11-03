import { clsx } from "clsx";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={clsx("rounded-md border border-line bg-panel p-5", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-b border-line pb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}

export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-bright active:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "w-full rounded-md border border-line bg-panel px-3 py-2 text-left text-sm text-muted transition-colors hover:border-sage-600 hover:bg-sage-50 hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "accent" | "warn" | "success" | "danger" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-panel-2 text-muted",
    accent: "border-sage-700 bg-sage-50 text-accent",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-600",
    danger: "border-rose-200 bg-rose-50 text-rose-600",
    info: "border-sky-200 bg-sky-50 text-sky-600",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
