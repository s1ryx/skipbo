import React from 'react';
import debugLog from '../debugLog';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Without this, a render error is caught silently and the user only sees
    // "Something went wrong" with no diagnostic trail. When the reconnect bug
    // surfaces as a render crash (rather than a server-side error), this is
    // the only place we can capture it.
    debugLog('error-boundary', 'render error', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>The application encountered an unexpected error.</p>
          <button onClick={this.handleReset}>Try Again</button>
          <button onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
