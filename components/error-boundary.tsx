'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children:   ReactNode;
  fallback?:  ReactNode;
  onError?:   (error: Error, info: ErrorInfo) => void;
  resetKeys?: unknown[]; // re-mount boundary when any of these change
}

interface State {
  hasError: boolean;
  error:    Error | null;
  errorId:  string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorId: Date.now().toString(36) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', {
      error:  error.message,
      stack:  error.stack,
      component: info.componentStack,
    });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: Props) {
    const { resetKeys } = this.props;
    if (!this.state.hasError || !resetKeys) return;
    const prevKeys = prevProps.resetKeys ?? [];
    if (resetKeys.some((k, i) => k !== prevKeys[i])) {
      this.reset();
    }
  }

  reset = () => this.setState({ hasError: false, error: null, errorId: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return this.props.fallback ?? (
      <ScannerErrorFallback
        error={this.state.error}
        errorId={this.state.errorId}
        onReset={this.reset}
      />
    );
  }
}

// ─── Default fallback UI ──────────────────────────────────────────────────────

function ScannerErrorFallback({
  error,
  errorId,
  onReset,
}: {
  error:   Error | null;
  errorId: string | null;
  onReset: () => void;
}) {
  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text font-mono flex items-center justify-center p-4">
      <div className="glass-card rounded-xl p-8 max-w-md w-full border border-bear-DEFAULT/30 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-bear-muted border border-bear-DEFAULT/30 flex items-center justify-center flex-shrink-0">
            <span className="text-bear-text text-sm">⚠</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-terminal-text uppercase tracking-wider">
              Unexpected Error
            </h2>
            {errorId && (
              <p className="text-[9px] text-terminal-dim font-mono mt-0.5">ID: {errorId}</p>
            )}
          </div>
        </div>

        {/* Error message — always shown for diagnostics */}
        {error && (
          <div className="rounded-lg bg-terminal-surface border border-terminal-border/50 p-3">
            <p className="text-[11px] text-terminal-muted leading-relaxed break-all">
              {error.message}
            </p>
            {error.stack && (
              <pre className="mt-2 text-[9px] text-terminal-dim overflow-auto max-h-40 whitespace-pre-wrap">
                {error.stack.split('\n').slice(1, 6).join('\n')}
              </pre>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="flex-1 py-2 px-4 rounded-lg bg-bull-DEFAULT/10 border border-bull-DEFAULT/30 text-bull-text text-xs font-semibold hover:bg-bull-DEFAULT/20 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 py-2 px-4 rounded-lg glass-surface border border-terminal-border/50 text-terminal-muted text-xs font-semibold hover:text-terminal-text transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
