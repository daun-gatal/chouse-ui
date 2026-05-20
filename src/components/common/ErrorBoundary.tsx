import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/log';

// ============================================
// Types
// ============================================

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ============================================
// Error Boundary Component
// ============================================

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    // Log error
    log.error('Error Boundary caught an error:', { error: error?.message, componentStack: errorInfo?.componentStack });
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
          <div className="w-full max-w-md">
            <div className="rounded-xs border border-ink-500 bg-ink-100 p-8 text-center">
              <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </span>

              <h1 className="mb-2 text-[18px] font-semibold tracking-tight text-paper">
                Something went wrong
              </h1>

              <p className="mb-6 text-[12px] text-paper-muted">
                An unexpected error occurred. We've been notified and are working on it.
              </p>

              {process.env.NODE_ENV !== 'production' && this.state.error && (
                <div className="mb-6 rounded-xs border border-red-900/60 bg-red-950/40 p-4 text-left">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Error</p>
                  <p className="mt-1 break-all font-mono text-[12px] text-red-200">
                    {this.state.error.message}
                  </p>
                  {this.state.errorInfo && (
                    <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-red-300/80">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}

              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={this.handleRetry}
                  className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Try again
                </Button>

                <Button
                  onClick={this.handleGoHome}
                  className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                >
                  <Home className="h-3.5 w-3.5" />
                  Go home
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================
// Async Error Boundary (for data fetching)
// ============================================

interface AsyncErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AsyncErrorBoundary({ children, fallback }: AsyncErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
}

// ============================================
// Query Error Boundary (for React Query)
// ============================================

interface QueryErrorBoundaryProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export function QueryErrorFallback({ error, resetErrorBoundary }: QueryErrorBoundaryProps) {
  return (
    <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>

        <div className="flex-1">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Failed to load data</p>

          <p className="mb-4 text-[12px] text-red-200/90">
            {error.message}
          </p>

          <Button
            size="sm"
            variant="outline"
            onClick={resetErrorBoundary}
            className="h-9 gap-2 rounded-xs border-red-300 bg-red-50 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 hover:border-red-800 hover:bg-red-950/60 hover:text-red-200"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;

