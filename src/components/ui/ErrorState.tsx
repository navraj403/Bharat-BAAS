import { Button } from "./Button";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      <span>Something went wrong: {msg}</span>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
