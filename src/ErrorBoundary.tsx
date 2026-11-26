import { Component, ReactNode } from 'react'

// Shows the real error on screen instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="panel p-5 max-w-lg">
          <h2 className="font-pixel text-xs text-yellow-300 mb-3">SOMETHING BROKE</h2>
          <p className="text-pink-300 break-words">{this.state.error.message}</p>
        </div>
      </main>
    )
  }
}
