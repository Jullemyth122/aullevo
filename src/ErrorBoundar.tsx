// ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (this.state.hasError) {
            return <div style={{ padding: 20, color: 'red' }}>Something went wrong (likely chrome API in dev preview).</div>;
        }
        return this.props.children;
    }
}

export default ErrorBoundary;