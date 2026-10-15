// Keeps one broken part from blanking the panel: the orb's 3D view can fail when the GPU runs out of memory
// or WebGL is switched off. The flat orb shows instead, and the 3D view is retried a few times.
import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback: (error: Error, retry: () => void) => ReactNode; retryAfterMs?: number }

export class ErrorBoundary extends Component<Props, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 };
  private timer = 0;
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.warn('[Aullevo:Voice] Recovered from an error:', error);
    // Retry a few times (10 s, 20 s, 40 s), then stop, so a browser with graphics switched off doesn't fill the error log.
    if (this.props.retryAfterMs && this.state.attempt < 3) this.timer = window.setTimeout(this.retry, this.props.retryAfterMs * 2 ** this.state.attempt);
  }
  componentWillUnmount() { clearTimeout(this.timer); }
  retry = () => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }));
  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.retry);
    // A new key remounts the children from scratch on retry.
    return <div key={this.state.attempt} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}
