import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("App crashed", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-shell" role="alert" aria-live="assertive">
          <main className="app-stage">
            <div className="app-frame">
              <div className="app-frame-inner">
                <div className="app-workspace">
                  <section className="app-panel" aria-label="App error">
                    <div className="panel-head">
                      <div className="panel-head__title">Something went wrong</div>
                    </div>
                    <div className="panel-body panel-body--locked">
                      <div className="panel-center">
                        <p>Reload the page or return to the home screen.</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
