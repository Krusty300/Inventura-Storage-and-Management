import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-app">
          <div className="bg-surface rounded-xl shadow-sm border border-border p-8 max-w-md text-center">
            <div className="text-red-500 text-5xl mb-4">!</div>
            <h1 className="text-xl font-bold text-ink mb-2">Something went wrong</h1>
            <p className="text-muted text-sm mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="btn-primary"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
