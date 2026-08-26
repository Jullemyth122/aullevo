import { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: 'red' }}>
                    Something went wrong (likely chrome API in dev preview).
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
