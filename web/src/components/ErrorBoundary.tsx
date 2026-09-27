import { Component, type ReactNode } from 'react'
import { Empty, Link } from './ui'

/** A page that throws while rendering shows this instead of a blank site. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <Empty title="Something broke on this page">
          <span className="muted small">{this.state.error.message}</span><br />
          <Link to="/" className="u">Back home</Link>
        </Empty>
      </div>
    )
  }
}
