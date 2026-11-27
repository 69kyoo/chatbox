// Tiny 8-bit sound effects via WebAudio. No assets, no background music, global toggle, starts only after a user gesture.
type Name = 'click' | 'send' | 'receive' | 'open' | 'notify' | 'alert' | 'secret' | 'error' | 'flap' | 'point' | 'hit' | 'star'
let ctx: AudioContext | null = null
let enabled = (() => { try { return localStorage.getItem('ck_sound') !== 'off' } catch { return true } })()
const listeners = new Set<() => void>()
export const soundEnabled = () => enabled
export function setSound(v: boolean) { enabled = v; try { localStorage.setItem('ck_sound', v ? 'on' : 'off') } catch { /* ignore */ } listeners.forEach(l => l()) }
export function onSoundChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

const SEQ: Record<Name, [number, number, OscillatorType?][]> = {
  click: [[660, .04, 'square']],
  send: [[520, .05, 'square'], [780, .06, 'square']],
  receive: [[880, .05, 'triangle'], [660, .06, 'triangle']],
  open: [[330, .05, 'square'], [440, .05, 'square'], [660, .08, 'square']],
  notify: [[988, .07, 'square'], [1319, .1, 'square']],
  alert: [[440, .12, 'sawtooth'], [330, .12, 'sawtooth'], [440, .12, 'sawtooth'], [330, .12, 'sawtooth'], [660, .2, 'sawtooth']],
  secret: [[523, .08, 'square'], [659, .08, 'square'], [784, .08, 'square'], [1047, .08, 'square'], [1319, .18, 'square']],
  error: [[196, .12, 'sawtooth'], [147, .16, 'sawtooth']],
  flap: [[420, .03, 'square'], [640, .04, 'square']],
  point: [[988, .05, 'square'], [1319, .09, 'square']],
  hit: [[240, .06, 'sawtooth'], [120, .2, 'sawtooth']],
  star: [[1319, .04, 'triangle'], [1760, .04, 'triangle'], [2349, .09, 'triangle']]
}
const VOL: Record<Name, number> = { click: .04, send: .05, receive: .04, open: .05, notify: .06, alert: .1, secret: .07, error: .06, flap: .035, point: .05, hit: .07, star: .05 }

export function play(name: Name) {
  if (!enabled) return
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = ctx ?? new AC()
    if (ctx.state === 'suspended') void ctx.resume()   // browsers block audio until a gesture; failures are silent
    let t = ctx.currentTime
    for (const [f, d, type] of SEQ[name]) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = type ?? 'square'; o.frequency.value = f
      g.gain.setValueAtTime(VOL[name], t); g.gain.exponentialRampToValueAtTime(0.0001, t + d)
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + .01); t += d
    }
  } catch { /* audio is optional */ }
}
