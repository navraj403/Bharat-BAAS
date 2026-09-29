export function EmptyState({ title = "Nothing here yet", hint }: { title?: string; hint?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div role="status" className="px-4 py-8 text-center text-sm text-ink-faint">
      {label}
    </div>
  );
}
