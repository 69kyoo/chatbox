import { useRef } from 'react'
import { emitWorld } from '../lib/bus'
import { play } from '../lib/sfx'

// Layered arcade logo: each letter is a stack of hard black outline layers + golden face with a pixel-stepped highlight.
export default function Logo({ small = false, onSecret }: { small?: boolean; onSecret?: () => void }) {
  const clicks = useRef({ n: 0, t: 0 })
  const click = () => {
    const now = Date.now(); const c = clicks.current
    c.n = now - c.t < 1500 ? c.n + 1 : 1; c.t = now
    if (c.n >= 7) { c.n = 0; play('secret'); emitWorld('secret'); onSecret?.() }
  }
  return (
    <h1 className={'logo select-none ' + (small ? 'logo-sm' : '')} onClick={click} aria-label="CHATKARI">
      <span className="logo-text" data-text="CHATKARI" aria-hidden="true">CHATKARI<i className="hat" /></span>
    </h1>
  )
}
