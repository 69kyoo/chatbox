import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProfiles } from '../lib/profiles'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'

// FLAPPY KARI: a pixel-art Christmas flappy bird. 270x480 internal canvas, fixed 60 Hz physics, nearest-neighbour scaling.
// Dithered dusk sky, twinkling stars, aurora, moon, Santa's sleigh fly-by, 3 parallax layers (mountains, pine forest, snow hills),
// candy-cane pipes with snowy holly caps (icicles on the hanging ones), star pickups, particles, screen shake, ornament medals,
// and a global leaderboard. Everything is drawn in code, no assets.

const W = 270, H = 480, GROUND = 56, PW = 30, BX = 74, BR = 6.5
const INK = '#120a24', RED = '#d62839', REDD = '#8f1d2c', GREEN = '#1f9d55', GREEND = '#136b3a', GOLD = '#ffd21f', GOLDD = '#c77b00'
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const BEST_KEY = 'ck_flappy_best'

type Phase = 'ready' | 'play' | 'dead'
type Pipe = { x: number; gapY: number; gap: number; passed: boolean; star: { y: number; taken: boolean } | null }
type Part = { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; c: string; s: number }
type Ctx = CanvasRenderingContext2D

function mk(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false
  return [c, x]
}
function disc(x: Ctx, cx: number, cy: number, r: number, col: string) {
  x.fillStyle = col
  for (let dy = -r; dy <= r; dy++) { const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * .6)); x.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1) }
}
function txt(c: Ctx, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center') {
  c.font = `${size}px "Press Start 2P", monospace`; c.textAlign = align; c.textBaseline = 'top'
  c.fillStyle = INK
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2], [2, 0], [-2, 0], [0, -2]]) c.fillText(s, x + dx, y + dy)
  c.fillStyle = col; c.fillText(s, x, y)
}

// ---------------------------------------------------------------- sprites
function birdFrame(frame: number): HTMLCanvasElement {
  const [c, x] = mk(26, 26); const OUT = '#3a1f12'
  x.fillStyle = OUT; x.fillRect(1, 13, 5, 5); x.fillStyle = '#f0a30a'; x.fillRect(2, 14, 3, 3)          // tail
  disc(x, 12, 14, 9, OUT); disc(x, 12, 14, 8, '#ffd23f'); disc(x, 13, 18, 3, '#fff1b8')                // body + belly
  x.fillStyle = '#ff8aa0'; x.fillRect(16, 16, 3, 2)                                                    // cheek
  disc(x, 16, 12, 3, '#fff'); x.fillStyle = OUT; x.fillRect(17, 11, 2, 3); x.fillStyle = '#fff'; x.fillRect(17, 11, 1, 1) // eye
  x.fillStyle = OUT; x.fillRect(19, 13, 6, 5); x.fillStyle = '#ff7a1a'; x.fillRect(20, 14, 4, 2); x.fillStyle = '#e05a00'; x.fillRect(20, 16, 4, 1) // beak
  const wy = [-3, 0, 3][frame]; disc(x, 8, 15 + wy, 4, OUT); disc(x, 8, 15 + wy, 3, '#f0a30a')          // wing
  // santa hat
  const rows: [number, number, number][] = [[2, 10, 15], [3, 9, 16], [4, 7, 17], [5, 6, 18]]
  x.fillStyle = OUT; for (const [y, a, b] of rows) x.fillRect(a - 1, y - 1 + 0, b - a + 3, 1); x.fillRect(4, 6, 17, 4)
  x.fillStyle = RED; for (const [y, a, b] of rows) x.fillRect(a, y, b - a + 1, 1)
  x.fillStyle = REDD; x.fillRect(16, 4, 2, 2)
  x.fillStyle = '#fff'; x.fillRect(5, 7, 15, 2)
  disc(x, 3, 9, 3, OUT); disc(x, 3, 9, 2, '#fff')
  return c
}
function pipeTile(): HTMLCanvasElement {
  const [c, x] = mk(PW, 12)
  for (let yy = 0; yy < 12; yy++) for (let xx = 0; xx < PW; xx++) {
    x.fillStyle = ((xx + yy) % 12) < 6 ? RED : '#f6f9ff'; x.fillRect(xx, yy, 1, 1)
  }
  x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(2, 0, 3, 12)
  x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(PW - 6, 0, 5, 12)
  x.fillStyle = INK; x.fillRect(0, 0, 1, 12); x.fillRect(PW - 1, 0, 1, 12)
  return c
}
function capSprite(): HTMLCanvasElement {
  const [c, x] = mk(38, 21)
  x.fillStyle = INK; x.fillRect(0, 5, 38, 16)
  x.fillStyle = GREEN; x.fillRect(1, 6, 36, 14)
  x.fillStyle = '#4be08a'; x.fillRect(2, 7, 34, 2)
  x.fillStyle = GREEND; x.fillRect(2, 17, 34, 2)
  for (let i = 0; i < 6; i++) { x.fillStyle = GOLD; x.fillRect(5 + i * 6, 11, 2, 2); x.fillStyle = RED; x.fillRect(8 + i * 6, 13, 3, 3); x.fillStyle = '#ff8a95'; x.fillRect(8 + i * 6, 13, 1, 1) }
  const hs = [3, 4, 2, 5, 3, 2, 4, 3, 5, 2, 4, 3, 2, 4, 5, 3, 2, 4]
  hs.forEach((h, i) => { x.fillStyle = '#fff'; x.fillRect(1 + i * 2, 5 - h, 2, h + 1); x.fillStyle = '#cfe6ff'; x.fillRect(1 + i * 2, 5, 2, 1) })
  return c
}
function starSprite(): HTMLCanvasElement {
  const [c, x] = mk(9, 9)
  const m = ['....Y....', '....Y....', '...YYY...', 'YYYYWYYYY', '.YYYYYYY.', '..YYYYY..', '..YYYYY..', '.YYY.YYY.', '.YY...YY.']
  m.forEach((r, y) => [...r].forEach((ch, xx) => { if (ch !== '.') { x.fillStyle = ch === 'W' ? '#fff' : GOLD; x.fillRect(xx, y, 1, 1) } }))
  return c
}
function rotate(src: ImageData, ang: number, out: ImageData) {
  const cs = Math.cos(ang), sn = Math.sin(ang), n = src.width, cx = (n - 1) / 2
  out.data.fill(0)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - cx, dy = y - cx
    const sx = Math.round(cs * dx + sn * dy + cx), sy = Math.round(-sn * dx + cs * dy + cx)
    if (sx < 0 || sy < 0 || sx >= n || sy >= n) continue
    const si = (sy * n + sx) * 4, di = (y * n + x) * 4
    out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3]
  }
}

// ---------------------------------------------------------------- scenery (pre-rendered, seamless horizontally)
function skyCanvas(): HTMLCanvasElement {
  const [c, x] = mk(W, H - GROUND + 8)
  const cols = ['#050a22', '#08123a', '#0d1b52', '#142a70', '#253a8a', '#46489a', '#7a4f9a', '#b45a8a', '#e0766f']
  const bh = c.height / cols.length
  for (let i = 0; i < cols.length; i++) {
    x.fillStyle = cols[i]; x.fillRect(0, Math.floor(i * bh), W, Math.ceil(bh) + 1)
    if (i < cols.length - 1) for (let y = 0; y < 6; y++) for (let xx = 0; xx < W; xx++) {
      if (BAYER[(y & 3) * 4 + (xx & 3)] / 16 < (y + 1) / 7) { x.fillStyle = cols[i + 1]; x.fillRect(xx, Math.floor((i + 1) * bh) - 3 + y, 1, 1) }
    }
  }
  return c
}
function mountains(): HTMLCanvasElement {
  const [c, x] = mk(W, 150); const T = Math.PI * 2 / W
  for (let xx = 0; xx < W; xx++) {
    const h = 74 + Math.sin(xx * T * 2) * 30 + Math.sin(xx * T * 5 + 1) * 14 + Math.sin(xx * T * 9 + 2) * 6
    x.fillStyle = '#27356f'; x.fillRect(xx, 150 - h, 1, h)
    x.fillStyle = '#3b4c93'; if ((xx + Math.floor(h)) % 7 < 2) x.fillRect(xx, 150 - h + 8, 1, 10)
    if (h > 92) { x.fillStyle = '#dfeeff'; x.fillRect(xx, 150 - h, 1, Math.min(14, (h - 92) * 1.1 + 2)) }
  }
  return c
}
function forest(): HTMLCanvasElement {
  const [c, x] = mk(W, 90); let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 16; i++) {
    const bx = Math.floor(i * (W / 16) + rnd() * 6), hgt = 34 + Math.floor(rnd() * 26)
    for (const off of [0, -W, W]) for (let r = 0; r < hgt; r++) {
      const hw = Math.floor(r * .33) + 1, cx = bx + off, y = 90 - hgt + r
      x.fillStyle = '#0f4a3a'; x.fillRect(cx - hw, y, hw * 2 + 1, 1)
      if (r % 7 < 2 && r > 3) { x.fillStyle = '#e6f3ff'; x.fillRect(cx - hw, y, Math.max(2, hw), 1) }
      x.fillStyle = '#0a3a2d'; x.fillRect(cx + Math.floor(hw * .4), y, Math.ceil(hw * .6) + 1, 1)
    }
  }
  return c
}
function hills(): HTMLCanvasElement {
  const [c, x] = mk(W, 44); const T = Math.PI * 2 / W
  for (let xx = 0; xx < W; xx++) {
    const h = 26 + Math.sin(xx * T * 3) * 9 + Math.sin(xx * T * 7 + 2) * 4
    x.fillStyle = '#c3d8f3'; x.fillRect(xx, 44 - h, 1, h)
    x.fillStyle = '#ffffff'; x.fillRect(xx, 44 - h, 1, 2)
  }
  return c
}
function groundStrip(): HTMLCanvasElement {
  const [c, x] = mk(16, GROUND)
  x.fillStyle = '#eaf4ff'; x.fillRect(0, 0, 16, 8); x.fillStyle = '#b9d4f5'; x.fillRect(0, 6, 16, 2)
  x.fillStyle = INK; x.fillRect(0, 8, 16, 2)
  for (let y = 10; y < 22; y++) for (let xx = 0; xx < 16; xx++) { x.fillStyle = ((xx + y) % 16) < 8 ? RED : '#f6f9ff'; x.fillRect(xx, y, 1, 1) }
  x.fillStyle = INK; x.fillRect(0, 22, 16, 2)
  x.fillStyle = '#0b2f22'; x.fillRect(0, 24, 16, GROUND - 24)
  x.fillStyle = GREEND; for (let y = 28; y < GROUND; y += 8) x.fillRect(0, y, 16, 2)
  x.fillStyle = '#1b6b4a'; for (let xx = 2; xx < 16; xx += 8) x.fillRect(xx, 30, 3, 2)
  return c
}

// ---------------------------------------------------------------- component
export default function Game() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 } })
  const [board, setBoard] = useState(false)
  const [rows, setRows] = useState<{ user_id: string; best: number }[]>([])
  const [boardErr, setBoardErr] = useState('')
  const who = useProfiles(rows.map(r => r.user_id))

  const refreshBoard = useCallback(async () => {
    const { data, error } = await supabase.from('flappy_scores').select('user_id,best').order('best', { ascending: false }).limit(10)
    if (error) { setBoardErr('Leaderboard not set up yet. Run chatkari-christmas-update.sql in Supabase.'); return }
    setBoardErr(''); setRows((data ?? []) as { user_id: string; best: number }[])
  }, [])
  useEffect(() => { void refreshBoard() }, [refreshBoard])

  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void document.fonts?.load('16px "Press Start 2P"')

    const sky = skyCanvas(), mtn = mountains(), frs = forest(), hil = hills(), gnd = groundStrip(), tile = pipeTile(), cap = capSprite(), starS = starSprite()
    const birds = [birdFrame(0), birdFrame(1), birdFrame(2)]
    const birdData = birds.map(b => b.getContext('2d')!.getImageData(0, 0, 26, 26))
    const [rotC, rotX] = mk(26, 26); const rotImg = rotX.createImageData(26, 26)
    const stars = Array.from({ length: 70 }, (_, i) => ({ x: (i * 97) % W, y: (i * 53) % 260, p: i * 1.7, b: i % 9 === 0 }))
    const flakes = Array.from({ length: 80 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, v: .4 + Math.random() * .9, s: i % 6 === 0 ? 2 : 1, d: Math.random() * 6 }))

    let phase: Phase = 'ready', score = 0, bestNow = best, newBest = false
    let by = H / 2 - 40, vy = 0, rot = 0, frame = 0, deadAt = 0
    let pipes: Pipe[] = [], parts: Part[] = []
    let off1 = 0, off2 = 0, off3 = 0, offG = 0, t = 0, shake = 0, flash = 0, flashC = '#fff', pop = 0, sleighT = 600
    let acc = 0, last = performance.now(), raf = 0

    const speed = () => 1.55 + Math.min(score, 40) * .018
    const gapFor = () => 118 - Math.min(score, 30) * .9
    const spawn = (x: number) => {
      const gap = gapFor(), lo = gap / 2 + 50, hi = H - GROUND - gap / 2 - 50
      const gapY = lo + Math.random() * (hi - lo)
      pipes.push({ x, gapY, gap, passed: false, star: Math.random() < .38 ? { y: gapY + (Math.random() - .5) * (gap - 44), taken: false } : null })
    }
    const burst = (x: number, y: number, n: number, cols: string[], sp: number, g = .12, life = 40) => {
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = Math.random() * sp; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * .3, g, life, max: life, c: cols[i % cols.length], s: Math.random() < .3 ? 2 : 1 }) }
    }
    const reset = () => { score = 0; newBest = false; pipes = []; spawn(W + 70); spawn(W + 70 + 135); by = H / 2 - 40; vy = 0; rot = 0; parts = []; shake = 0; flash = 0 }
    reset()

    const submit = async (s: number) => {
      if (s <= 0) return
      const { error } = await supabase.rpc('submit_flappy', { s })
      if (!error) void refreshBoard()
    }
    const die = () => {
      if (phase === 'dead') return
      phase = 'dead'; deadAt = performance.now(); vy = -3.4; play('hit'); emitWorld('error')
      if (!reduce) { shake = 9; flash = 1; flashC = '#fff' }
      burst(BX, by, 26, [RED, '#f6f9ff', GREEN, GOLD], 4.2, .14, 60)
      if (score > bestNow) { bestNow = score; newBest = true; try { localStorage.setItem(BEST_KEY, String(score)) } catch { /* ignore */ } setBest(score); emitWorld('secret'); play('secret') }
      void submit(score)
    }
    const flap = () => {
      if (phase === 'dead') { if (performance.now() - deadAt > 650) { reset(); phase = 'ready' } return }
      if (phase === 'ready') { phase = 'play'; emitWorld('open') }
      vy = -4.55; play('flap')
      burst(BX - 8, by + 4, 4, ['#ffffff', '#cfe6ff'], 1.4, .02, 22)
    }

    const update = () => {
      t++; frame = Math.floor(t / 5) % 3
      for (const f of flakes) { f.y += f.v * (phase === 'play' ? 1.3 : 1); f.x += Math.sin((t + f.d * 20) / 40) * .25 - (phase === 'dead' ? 0 : speed() * .35); if (f.y > H) { f.y = -2; f.x = Math.random() * W } if (f.x < -2) f.x = W + 2 }
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life-- }
      parts = parts.filter(p => p.life > 0)
      shake *= .86; flash *= .88; pop *= .88
      sleighT--; if (sleighT < -460) sleighT = 1000
      if (phase !== 'dead') { const sp = phase === 'play' ? speed() : 1.1; off1 += sp * .12; off2 += sp * .32; off3 += sp * .6; offG += sp }
      if (phase === 'ready') { by = H / 2 - 40 + Math.sin(t / 14) * 7; rot = 0; return }
      vy = Math.min(vy + .24, 6.2); by += vy
      rot = phase === 'dead' ? Math.min(rot + .12, 1.5) : Math.max(-.5, Math.min(1.2, vy * .13))
      if (by < BR) { by = BR; if (vy < 0) vy = 0 }
      const floorY = H - GROUND - BR
      if (by >= floorY) { by = floorY; if (phase === 'play') die(); vy = 0; return }
      if (phase === 'dead') return
      for (const p of pipes) p.x -= speed()
      if (pipes.length && pipes[0].x < -50) pipes.shift()
      const lastP = pipes[pipes.length - 1]; if (lastP.x < W - 135) spawn(lastP.x + 135)
      for (const p of pipes) {
        const l = p.x - 17, r = p.x + 17
        if (BX + BR > l && BX - BR < r) {
          const cx = Math.max(l, Math.min(BX, r))
          for (const [y0, y1] of [[0, p.gapY - p.gap / 2], [p.gapY + p.gap / 2, H - GROUND]]) {
            const cy = Math.max(y0, Math.min(by, y1)), dx = BX - cx, dy = by - cy
            if (dx * dx + dy * dy < BR * BR) die()
          }
        }
        if (!p.passed && p.x + PW / 2 < BX) { p.passed = true; score++; pop = 1; play('point'); emitWorld('send'); if (score % 10 === 0) { play('secret'); burst(BX, by, 20, [GOLD, '#fff'], 3, .05, 50) } }
        if (p.star && !p.star.taken && Math.abs(p.x - BX) < 13 && Math.abs(p.star.y - by) < 13) { p.star.taken = true; score++; pop = 1.4; play('star'); burst(p.x, p.star.y, 22, [GOLD, '#fff', '#ffe98a'], 3, .03, 44) }
      }
    }

    const sleigh = (x: number, y: number) => {
      ctx.fillStyle = '#3a1a2e'
      for (let i = 0; i < 3; i++) {
        const rx = x - 34 - i * 22, lg = Math.sin(t / 4 + i) * 2
        ctx.fillRect(rx, y + 2, 14, 6); ctx.fillRect(rx + 12, y - 3, 5, 5); ctx.fillRect(rx + 14, y - 8, 1, 5); ctx.fillRect(rx + 16, y - 8, 1, 5)
        ctx.fillRect(rx + 1, y + 8, 2, 5 + lg); ctx.fillRect(rx + 10, y + 8, 2, 5 - lg)
        if (i === 0) { ctx.fillStyle = RED; ctx.fillRect(rx + 17, y - 1, 2, 2); ctx.fillStyle = '#3a1a2e' }
        ctx.fillRect(rx + 14, y + 4, 22, 1)
      }
      ctx.fillStyle = '#6b1020'; ctx.fillRect(x - 6, y, 22, 8); ctx.fillStyle = GOLD; ctx.fillRect(x - 6, y + 7, 22, 2)
      ctx.fillStyle = '#3a1a2e'; ctx.fillRect(x - 8, y + 10, 26, 2); ctx.fillRect(x - 8, y + 6, 2, 5)
      ctx.fillStyle = RED; ctx.fillRect(x + 2, y - 6, 6, 6); ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y - 1, 8, 2); ctx.fillRect(x + 7, y - 8, 2, 2)
      ctx.fillStyle = '#f2c9a0'; ctx.fillRect(x + 3, y - 3, 4, 3)
      if (t % 2 === 0) burst(x - 100, y + 8, 1, [GOLD, '#fff'], .6, .01, 36)
    }

    const draw = () => {
      ctx.save()
      if (shake > .3 && !reduce) ctx.translate(Math.round((Math.random() - .5) * shake), Math.round((Math.random() - .5) * shake))
      ctx.drawImage(sky, 0, 0)
      for (const s of stars) { const tw = Math.sin(t / 22 + s.p); if (tw > -.4) { ctx.fillStyle = s.b ? '#fff4c8' : '#cfd9ff'; ctx.fillRect(s.x, s.y, s.b ? 2 : 1, s.b ? 2 : 1) } }
      // moon
      disc(ctx, 206, 78, 22, '#2b3a82'); disc(ctx, 206, 78, 19, '#fff6cf'); ctx.fillStyle = '#ecdf9f'; ctx.fillRect(198, 70, 5, 4); ctx.fillRect(210, 82, 6, 5); ctx.fillRect(204, 90, 3, 3)
      // aurora (grows with score)
      const aur = .3 + Math.min(score, 24) / 24 * .7
      if (!reduce || score > 0) for (let xx = 0; xx < W; xx += 3) {
        const yy = 150 + Math.sin(xx * .035 + t / 55) * 16 + Math.sin(xx * .09 - t / 40) * 6
        for (let k = 0; k < 5; k++) {
          ctx.globalAlpha = (.34 - k * .06) * aur; ctx.fillStyle = k % 2 ? '#3ddc97' : '#5ee7ff'
          ctx.fillRect(xx, yy - k * 9, 3, 9)
        }
      }
      ctx.globalAlpha = 1
      // sleigh fly-by
      if (sleighT < 0) sleigh(W + 150 + sleighT * 1.1, 62 + Math.sin(t / 30) * 6)
      // parallax
      const ly = H - GROUND
      for (const [img, o, y] of [[mtn, off1, ly - 150], [frs, off2, ly - 90], [hil, off3, ly - 44]] as [HTMLCanvasElement, number, number][]) {
        const ox = -Math.floor(o % W); ctx.drawImage(img, ox, y); ctx.drawImage(img, ox + W, y)
      }
      // pipes
      for (const p of pipes) {
        const x0 = Math.round(p.x - PW / 2), top = Math.round(p.gapY - p.gap / 2), bot = Math.round(p.gapY + p.gap / 2)
        for (let y = top - 12; y > -12; y -= 12) ctx.drawImage(tile, x0, y)
        for (let y = bot + 12; y < ly; y += 12) ctx.drawImage(tile, x0, y)
        ctx.save(); ctx.translate(0, top); ctx.scale(1, -1); ctx.drawImage(cap, Math.round(p.x - 19), -5, 38, 21); ctx.restore()
        ctx.drawImage(cap, Math.round(p.x - 19), bot - 5)
        if (p.star && !p.star.taken) { const bob = Math.sin(t / 8 + p.x) * 2, sc = 1 + Math.sin(t / 6) * .15; ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.star.y + bob)); ctx.scale(sc, sc); ctx.drawImage(starS, -4, -4); ctx.restore() }
      }
      // ground
      const gx = -Math.floor(offG % 16); for (let x = gx; x < W; x += 16) ctx.drawImage(gnd, x, ly)
      // bird
      rotate(birdData[phase === 'dead' ? 1 : frame], rot, rotImg); rotX.putImageData(rotImg, 0, 0)
      ctx.drawImage(rotC, Math.round(BX - 13), Math.round(by - 14))
      // particles
      for (const p of parts) { ctx.globalAlpha = Math.min(1, p.life / (p.max * .5)); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s) }
      ctx.globalAlpha = 1
      // snow in front
      ctx.fillStyle = '#fff'; for (const f of flakes) ctx.fillRect(Math.round(f.x), Math.round(f.y), f.s, f.s)
      if (flash > .05 && !reduce) { ctx.globalAlpha = flash * .7; ctx.fillStyle = flashC; ctx.fillRect(-10, -10, W + 20, H + 20); ctx.globalAlpha = 1 }
      ctx.restore()
      hud()
    }

    const medal = (x: number, y: number, tier: number) => {
      const cols = [['#8a5a2b', '#c98a4b'], ['#7f8fa6', '#d6e0ee'], ['#c77b00', '#ffd21f'], ['#5ee7ff', '#e9fbff']][tier]
      ctx.fillStyle = INK; ctx.fillRect(x - 2, y - 14, 4, 5); disc(ctx, x, y, 13, INK); disc(ctx, x, y, 11, cols[0]); disc(ctx, x, y, 8, cols[1])
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, y - 6, 3, 2); ctx.fillRect(x - 6, y - 4, 2, 2)
      ctx.fillStyle = RED; ctx.fillRect(x - 3, y - 17, 6, 3); ctx.fillStyle = GOLD; ctx.fillRect(x - 1, y - 16, 2, 1)
    }
    const hud = () => {
      if (phase === 'ready') {
        const t1 = 'FLAPPY KARI', size = 18
        ;[...t1].forEach((ch, i) => txt(ctx, ch, Math.round(W / 2 - t1.length * size / 2 + i * size + size / 2), 86 + Math.round(Math.sin(t / 10 + i * .6) * 5), size, [RED, '#fff', GREEN, GOLD][i % 4]))
        txt(ctx, 'MERRY EDITION', W / 2, 120, 8, '#cfe6ff')
        if (Math.floor(t / 28) % 2 === 0) txt(ctx, 'TAP TO FLAP', W / 2, 296, 11, '#fff')
        txt(ctx, 'SPACE / CLICK / TAP', W / 2, 318, 7, '#9ec1e8')
        if (bestNow > 0) txt(ctx, 'BEST ' + bestNow, W / 2, 350, 9, GOLD)
        return
      }
      if (phase === 'play' || (phase === 'dead' && performance.now() - deadAt < 500)) { const s = 1 + Math.max(0, pop) * .15; txt(ctx, String(score), W / 2, 36 - Math.round(Math.max(0, pop) * 3), Math.round(26 * s), '#fff') }
      if (phase === 'dead' && performance.now() - deadAt >= 500) {
        const x0 = 30, y0 = 118, w = W - 60, h = 224
        ctx.fillStyle = INK; ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6); ctx.fillStyle = RED; ctx.fillRect(x0, y0, w, h); ctx.fillStyle = '#0d2230'; ctx.fillRect(x0 + 3, y0 + 3, w - 6, h - 6)
        ctx.fillStyle = GREEN; ctx.fillRect(x0 + 3, y0 + 3, w - 6, 2); ctx.fillRect(x0 + 3, y0 + h - 5, w - 6, 2)
        txt(ctx, 'GAME OVER', W / 2, y0 + 14, 14, Math.floor(t / 10) % 2 ? '#ff6a78' : RED)
        const tier = score >= 30 ? 3 : score >= 20 ? 2 : score >= 10 ? 1 : score >= 5 ? 0 : -1
        if (tier >= 0) medal(W / 2, y0 + 80, tier); else txt(ctx, 'NO MEDAL', W / 2, y0 + 72, 8, '#8fb4e0')
        txt(ctx, 'SCORE', W / 2, y0 + 112, 8, '#cfe6ff'); txt(ctx, String(score), W / 2, y0 + 126, 16, '#fff')
        txt(ctx, 'BEST ' + bestNow, W / 2, y0 + 154, 9, GOLD)
        if (newBest) txt(ctx, 'NEW BEST!', W / 2, y0 + 172, 9, Math.floor(t / 6) % 2 ? '#fff' : GOLD)
        if (performance.now() - deadAt > 650 && Math.floor(t / 26) % 2 === 0) txt(ctx, 'TAP TO RETRY', W / 2, y0 + 196, 8, '#fff')
      }
    }

    const frameLoop = (now: number) => {
      raf = requestAnimationFrame(frameLoop)
      if (document.hidden) { last = now; return }
      acc += Math.min(now - last, 100); last = now
      while (acc >= 1000 / 60) { update(); acc -= 1000 / 60 }
      draw()
    }
    raf = requestAnimationFrame(frameLoop)

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !['Space', 'ArrowUp', 'KeyW'].includes(e.code)) return
      const tg = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(tg.tagName)) return
      e.preventDefault(); flap()
    }
    const onPtr = (e: PointerEvent) => { e.preventDefault(); flap() }
    addEventListener('keydown', onKey); canvas.addEventListener('pointerdown', onPtr)
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onPtr); emitWorld('close') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshBoard])

  return (
    <div className="game-wrap flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b-4 border-black">
        <span className="lbl">FLAPPY KARI</span><span className="flex-1" />
        <span className="text-xl text-yellow-300">BEST {best}</span>
        <button className="btn btn-sm" onClick={() => { play('click'); setBoard(b => !b); void refreshBoard() }}>{board ? 'PLAY' : 'TOP 10'}</button>
      </div>
      <div className="flex-1 min-h-0 relative bg-[#050a22]">
        <canvas ref={ref} width={W} height={H} tabIndex={0} aria-label="Flappy Kari game. Press space or tap to flap." style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        {board && (
          <div className="absolute inset-0 bg-[#06101f]/95 scroll-y p-4" role="dialog" aria-label="Leaderboard">
            <h3 className="lbl mb-3">LEADERBOARD</h3>
            {boardErr && <p className="text-pink-300">{boardErr}</p>}
            {!boardErr && rows.length === 0 && <p className="text-emerald-200">No scores yet. Be the first!</p>}
            <ol className="flex flex-col gap-2">
              {rows.map((r, i) => <li key={r.user_id} className="panel px-3 py-2 flex items-center gap-3">
                <span className="font-pixel text-xs w-8" style={{ color: ['#ffd21f', '#d6e0ee', '#c98a4b'][i] ?? '#cfe6ff' }}>{i + 1}</span>
                <span className="flex-1 truncate text-xl">{who(r.user_id).username}</span><span className="text-xl text-yellow-300">{r.best}</span></li>)}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
