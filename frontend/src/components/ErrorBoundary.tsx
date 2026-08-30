import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Copy, Home } from "lucide-react";

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null; info: string | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? null });
  }

  copyDetails = () => {
    const { error, info } = this.state;
    const text = [
      error?.message,
      error?.stack,
      info && `Component stack:${info}`,
    ].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  resetSoft = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-app">
          <div className="bg-surface rounded-xl shadow-sm border border-border p-8 max-w-md text-center">
            <AlertTriangle className="text-red-500 mx-auto mb-4" size={48} />
            <h1 className="text-xl font-bold text-ink mb-2">Something went wrong</h1>
            <p className="text-muted text-sm mb-1">{this.state.error?.message || "An unexpected error occurred."}</p>
            <p className="text-faint text-xs mb-6">If this keeps happening, please report it with the details below.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={this.resetSoft}
                className="btn-primary flex items-center justify-center gap-2 w-full"
              >
                <RefreshCw size={16} />
                Try again
              </button>
              <div className="flex gap-2">
                <button
                  onClick={this.copyDetails}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
                >
                  <Copy size={14} />
                  Copy error details
                </button>
                <button
                  onClick={() => window.location.href = "/"}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
                >
                  <Home size={14} />
                  Go to dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
