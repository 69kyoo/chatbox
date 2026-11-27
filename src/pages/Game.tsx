import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProfiles } from '../lib/profiles'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'
import { ThemeId, useTheme } from '../lib/theme'

// FLAPPY KARI: a pixel-art flappy bird that follows the site theme (Christmas, Outside, Kawaii, NYC, Horror; see PALS). 270x480 internal canvas, fixed 60 Hz physics, nearest-neighbour scaling.
// Dithered dusk sky, twinkling stars, aurora, moon, Santa's sleigh fly-by, 3 parallax layers (mountains, pine forest, snow hills),
// candy-cane pipes with snowy holly caps (icicles on the hanging ones), star pickups, particles, screen shake, ornament medals,
// and a global leaderboard. Everything is drawn in code, no assets.

const W = 270, H = 480, GROUND = 56, PW = 30, BX = 74, BR = 6.5
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const GOLD = '#ffd21f'
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

// ---------------------------------------------------------------- themes
// Every colour/shape of the game comes from a palette that follows the SITE theme. CHRISTMAS reproduces the original game 1:1.
type Pal = {
  ink: string; acc: string; acc2: string; accD: string
  bird: { out: string; body: string; belly: string; cheek: string; wing: string; tail: string; beak: string; beak2: string; eye: string; pupil: string }
  hat: 'santa' | 'bow' | 'cap' | 'none'; hatA: string; hatB: string; hatC: string
  pipeA: string; pipeB: string; pipeHi: string; pipeSh: string
  cap: { face: string; hi: string; lo: string; dotA: string; dotB: string; dotC: string }; capTop: [string, string] | null
  sky: string[]; stars: [string, string] | null; moon: [string, string, string]; aurora: [string, string] | null
  mtn: { kind: 'peaks' | 'city'; a: string; b: string; peak: string | null }
  frs: { kind: 'pine' | 'round' | 'city' | 'dead'; a: string; b: string; hi: string | null }
  hil: { a: string; hi: string }
  gnd: { top: string; shade: string; bandA: string; bandB: string; base: string; l1: string; l2: string }
  fly: 'sleigh' | 'plane' | 'balloon' | 'heli' | 'bats'; flyC: string
  fall: { c: string; rain?: boolean }; burst: string[]; puff: string[]
  title: string[]; sub: string; subC: string; tapC: string; hintC: string
  ui: { bg: string; trim: string; line: string; over: [string, string]; label: string; none: string }
}
const PALS: Record<ThemeId, Pal> = {
  christmas: {
    ink: '#120a24', acc: '#d62839', acc2: GOLD, accD: '#8f1d2c',
    bird: { out: '#3a1f12', body: '#ffd23f', belly: '#fff1b8', cheek: '#ff8aa0', wing: '#f0a30a', tail: '#f0a30a', beak: '#ff7a1a', beak2: '#e05a00', eye: '#fff', pupil: '#3a1f12' },
    hat: 'santa', hatA: '#d62839', hatB: '#8f1d2c', hatC: '#fff',
    pipeA: '#d62839', pipeB: '#f6f9ff', pipeHi: 'rgba(255,255,255,.35)', pipeSh: 'rgba(0,0,0,.3)',
    cap: { face: '#1f9d55', hi: '#4be08a', lo: '#136b3a', dotA: GOLD, dotB: '#d62839', dotC: '#ff8a95' }, capTop: ['#fff', '#cfe6ff'],
    sky: ['#050a22', '#08123a', '#0d1b52', '#142a70', '#253a8a', '#46489a', '#7a4f9a', '#b45a8a', '#e0766f'],
    stars: ['#cfd9ff', '#fff4c8'], moon: ['#2b3a82', '#fff6cf', '#ecdf9f'], aurora: ['#3ddc97', '#5ee7ff'],
    mtn: { kind: 'peaks', a: '#27356f', b: '#3b4c93', peak: '#dfeeff' }, frs: { kind: 'pine', a: '#0f4a3a', b: '#0a3a2d', hi: '#e6f3ff' }, hil: { a: '#c3d8f3', hi: '#ffffff' },
    gnd: { top: '#eaf4ff', shade: '#b9d4f5', bandA: '#d62839', bandB: '#f6f9ff', base: '#0b2f22', l1: '#136b3a', l2: '#1b6b4a' },
    fly: 'sleigh', flyC: '#3a1a2e', fall: { c: '#fff' }, burst: ['#d62839', '#f6f9ff', '#1f9d55', GOLD], puff: ['#ffffff', '#cfe6ff'],
    title: ['#d62839', '#fff', '#1f9d55', GOLD], sub: 'MERRY EDITION', subC: '#cfe6ff', tapC: '#fff', hintC: '#9ec1e8',
    ui: { bg: '#0d2230', trim: '#d62839', line: '#1f9d55', over: ['#ff6a78', '#d62839'], label: '#cfe6ff', none: '#8fb4e0' }
  },
  outside: {
    ink: '#14301a', acc: '#e03131', acc2: '#ffd84d', accD: '#a61e1e',
    bird: { out: '#3a1f12', body: '#ffd23f', belly: '#fff1b8', cheek: '#ff8aa0', wing: '#f0a30a', tail: '#f0a30a', beak: '#ff7a1a', beak2: '#e05a00', eye: '#fff', pupil: '#3a1f12' },
    hat: 'none', hatA: '', hatB: '', hatC: '',
    pipeA: '#5fd35f', pipeB: '#47b84a', pipeHi: 'rgba(255,255,255,.4)', pipeSh: 'rgba(0,40,0,.3)',
    cap: { face: '#3fae4a', hi: '#8ff08a', lo: '#2a7d34', dotA: '#ffe066', dotB: '#ff6b81', dotC: '#ffc2cc' }, capTop: ['#8ff08a', '#5fd35f'],
    sky: ['#4aa8f0', '#5db4f4', '#74c2f8', '#8cd0fb', '#a6dcfd', '#c0e8ff', '#d8f2ff', '#eaf8ff', '#fdfbe8'],
    stars: null, moon: ['#ffd84d', '#fff3a0', '#ffe066'], aurora: null,
    mtn: { kind: 'peaks', a: '#7fb6e0', b: '#96c8ec', peak: '#ffffff' }, frs: { kind: 'round', a: '#2f9e44', b: '#237a35', hi: '#6fd36a' }, hil: { a: '#4cb04f', hi: '#7bd36e' },
    gnd: { top: '#6fd16a', shade: '#3fae4a', bandA: '#c98a4b', bandB: '#a8713a', base: '#7a4b26', l1: '#5d3a1d', l2: '#8f5c30' },
    fly: 'plane', flyC: '#e03131', fall: { c: '#fff7b0' }, burst: ['#ffd84d', '#ffffff', '#ff6b81', '#5fd35f'], puff: ['#ffffff', '#e6f6ff'],
    title: ['#e03131', '#ffd84d', '#2f9e44', '#ffffff'], sub: 'SUNNY EDITION', subC: '#14301a', tapC: '#fff', hintC: '#14301a',
    ui: { bg: '#f1fbe4', trim: '#3fae4a', line: '#ffd84d', over: ['#ff8787', '#e03131'], label: '#14301a', none: '#4d7a50' }
  },
  kitty: {
    ink: '#6a1f4a', acc: '#ff5fa2', acc2: '#fff', accD: '#c2417f',
    bird: { out: '#6a1f4a', body: '#fff', belly: '#ffe0ee', cheek: '#ff8fc0', wing: '#ffc2dd', tail: '#ffc2dd', beak: '#ffb347', beak2: '#f08a00', eye: '#fff', pupil: '#3a1f3a' },
    hat: 'bow', hatA: '#ff5fa2', hatB: '#c2417f', hatC: '#fff',
    pipeA: '#ff9fcb', pipeB: '#fff', pipeHi: 'rgba(255,255,255,.5)', pipeSh: 'rgba(194,65,127,.25)',
    cap: { face: '#ff7ab8', hi: '#ffc2dd', lo: '#c2417f', dotA: '#fff', dotB: '#ffe066', dotC: '#fff' }, capTop: ['#fff', '#ffe0ee'],
    sky: ['#ff9fcb', '#ffaed3', '#ffbcda', '#ffc9e1', '#ffd5e8', '#ffe0ef', '#ffeaf4', '#fff2f8', '#fff9fc'],
    stars: ['#ffffff', '#fff3a0'], moon: ['#ff9fcb', '#ffffff', '#ffd6e8'], aurora: ['#ff9fcb', '#c9b2ff'],
    mtn: { kind: 'peaks', a: '#ffb3d4', b: '#ffc6de', peak: '#ffffff' }, frs: { kind: 'round', a: '#ff8fc0', b: '#ff6fae', hi: '#ffffff' }, hil: { a: '#ffd6e8', hi: '#ffffff' },
    gnd: { top: '#ffffff', shade: '#ffc2dd', bandA: '#ff8fc0', bandB: '#ffffff', base: '#ffd6e8', l1: '#ffb3d4', l2: '#ffffff' },
    fly: 'balloon', flyC: '#ff5fa2', fall: { c: '#ff7ab8' }, burst: ['#ff5fa2', '#ffffff', '#c9b2ff', '#ffe066'], puff: ['#ffffff', '#ffd6e8'],
    title: ['#ff5fa2', '#ffffff', '#c9b2ff', '#ffe066'], sub: 'KAWAII EDITION', subC: '#6a1f4a', tapC: '#fff', hintC: '#6a1f4a',
    ui: { bg: '#fff0f7', trim: '#ff8fc0', line: '#c9b2ff', over: ['#ff9fcb', '#ff5fa2'], label: '#6a1f4a', none: '#b0678c' }
  },
  nyc: {
    ink: '#050507', acc: '#ff2e63', acc2: '#ff9f1c', accD: '#8a1a38',
    bird: { out: '#15151b', body: '#9aa0ad', belly: '#d7dbe6', cheek: '#c58aff', wing: '#6f7683', tail: '#6f7683', beak: '#f2c230', beak2: '#c99a10', eye: '#ffb347', pupil: '#15151b' },
    hat: 'cap', hatA: '#ff2e63', hatB: '#8a1a38', hatC: '#fff',
    pipeA: '#9a4331', pipeB: '#7a3224', pipeHi: 'rgba(255,255,255,.18)', pipeSh: 'rgba(0,0,0,.4)',
    cap: { face: '#5a5a66', hi: '#8a8a98', lo: '#34343c', dotA: '#ff9f1c', dotB: '#ff2e63', dotC: '#37e1ff' }, capTop: null,
    sky: ['#06060c', '#0b0b16', '#12121f', '#1a1a2b', '#25253a', '#36304a', '#4d3a55', '#6e3f55', '#9a4a4a'],
    stars: ['#9aa0c0', '#ffe9a0'], moon: ['#3a3a55', '#d8d8e8', '#b0b0c8'], aurora: ['#ff2e63', '#37e1ff'],
    mtn: { kind: 'city', a: '#12121b', b: '#ffcf5a', peak: null }, frs: { kind: 'city', a: '#1d1620', b: '#2b2028', hi: '#ff9f1c' }, hil: { a: '#0c0c11', hi: '#1c1c26' },
    gnd: { top: '#5a5a66', shade: '#3a3a44', bandA: '#1d1d23', bandB: '#f2c230', base: '#16161b', l1: '#26262e', l2: '#34343e' },
    fly: 'heli', flyC: '#1a1a22', fall: { c: '#8fa0c8', rain: true }, burst: ['#ff2e63', '#37e1ff', '#ff9f1c', '#ffffff'], puff: ['#aab0c0', '#d8d8e8'],
    title: ['#ffe14d', '#ff2e63', '#37e1ff', '#ffffff'], sub: 'NYC EDITION', subC: '#ff9f1c', tapC: '#fff', hintC: '#aab0c0',
    ui: { bg: '#16161b', trim: '#ff2e63', line: '#ff9f1c', over: ['#ff5c8a', '#ff2e63'], label: '#d9d3c3', none: '#8a8a98' }
  },
  horror: {
    ink: '#000', acc: '#a40000', acc2: '#c9a227', accD: '#4a0000',
    bird: { out: '#000', body: '#1c1c22', belly: '#3a3a44', cheek: '#5a0000', wing: '#0e0e12', tail: '#0e0e12', beak: '#6a6a6a', beak2: '#3a3a3a', eye: '#ff2a2a', pupil: '#000' },
    hat: 'none', hatA: '', hatB: '', hatC: '',
    pipeA: '#2b2b30', pipeB: '#1a1a1d', pipeHi: 'rgba(255,255,255,.08)', pipeSh: 'rgba(0,0,0,.5)',
    cap: { face: '#3a0a0a', hi: '#6b1212', lo: '#1c0505', dotA: '#8a0303', dotB: '#555', dotC: '#aa2a2a' }, capTop: ['#8a0303', '#4a0000'],
    sky: ['#020103', '#06030a', '#0b0510', '#120611', '#1c0810', '#2a0a0e', '#3d0d0d', '#5a1010', '#7a1414'],
    stars: ['#6a5a6a', '#aa8a8a'], moon: ['#3a0000', '#c01818', '#8a0c0c'], aurora: ['#8a0303', '#3a0a3a'],
    mtn: { kind: 'peaks', a: '#120a14', b: '#1c1018', peak: null }, frs: { kind: 'dead', a: '#050505', b: '#050505', hi: null }, hil: { a: '#0d0f0b', hi: '#1a1f15' },
    gnd: { top: '#2a2f26', shade: '#161a14', bandA: '#3a0a0a', bandB: '#220505', base: '#0c0f0b', l1: '#1a2016', l2: '#4a0000' },
    fly: 'bats', flyC: '#000', fall: { c: '#8a8a8a' }, burst: ['#a40000', '#8a8a8a', '#4a0000', '#c9a227'], puff: ['#555', '#333'],
    title: ['#a40000', '#c40000', '#6a0000', '#8a8a8a'], sub: 'NIGHTMARE EDITION', subC: '#8a5a5a', tapC: '#ddd', hintC: '#7a6a6a',
    ui: { bg: '#0b0707', trim: '#8a0303', line: '#4a0000', over: ['#ff3030', '#a40000'], label: '#bbb', none: '#7a5a5a' }
  }
}
let CUR: Pal = PALS.christmas

function txt(c: Ctx, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center') {
  c.font = `${size}px \"Press Start 2P\", monospace`; c.textAlign = align; c.textBaseline = 'top'
  c.fillStyle = CUR.ink
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2], [2, 0], [-2, 0], [0, -2]]) c.fillText(s, x + dx, y + dy)
  c.fillStyle = col; c.fillText(s, x, y)
}

// ---------------------------------------------------------------- sprites
function birdFrame(frame: number): HTMLCanvasElement {
  const P = CUR, B = P.bird
  const [c, x] = mk(26, 26); const OUT = B.out
  x.fillStyle = OUT; x.fillRect(1, 13, 5, 5); x.fillStyle = B.tail; x.fillRect(2, 14, 3, 3)          // tail
  disc(x, 12, 14, 9, OUT); disc(x, 12, 14, 8, B.body); disc(x, 13, 18, 3, B.belly)                // body + belly
  x.fillStyle = B.cheek; x.fillRect(16, 16, 3, 2)                                                    // cheek
  disc(x, 16, 12, 3, B.eye); x.fillStyle = B.pupil; x.fillRect(17, 11, 2, 3); x.fillStyle = '#fff'; x.fillRect(17, 11, 1, 1) // eye
  x.fillStyle = OUT; x.fillRect(19, 13, 6, 5); x.fillStyle = B.beak; x.fillRect(20, 14, 4, 2); x.fillStyle = B.beak2; x.fillRect(20, 16, 4, 1) // beak
  const wy = [-3, 0, 3][frame]; disc(x, 8, 15 + wy, 4, OUT); disc(x, 8, 15 + wy, 3, B.wing)          // wing
  if (P.hat === 'santa') {
    const rows: [number, number, number][] = [[2, 10, 15], [3, 9, 16], [4, 7, 17], [5, 6, 18]]
    x.fillStyle = OUT; for (const [y, a, b] of rows) x.fillRect(a - 1, y - 1 + 0, b - a + 3, 1); x.fillRect(4, 6, 17, 4)
    x.fillStyle = P.hatA; for (const [y, a, b] of rows) x.fillRect(a, y, b - a + 1, 1)
    x.fillStyle = P.hatB; x.fillRect(16, 4, 2, 2)
    x.fillStyle = P.hatC; x.fillRect(5, 7, 15, 2)
    disc(x, 3, 9, 3, OUT); disc(x, 3, 9, 2, P.hatC)
  } else if (P.hat === 'bow') {
    x.fillStyle = OUT; x.fillRect(7, 1, 6, 8); x.fillRect(14, 1, 6, 8); x.fillRect(12, 3, 4, 5)
    x.fillStyle = P.hatA; x.fillRect(8, 2, 4, 6); x.fillRect(15, 2, 4, 6); x.fillStyle = P.hatB; x.fillRect(8, 6, 4, 2); x.fillRect(15, 6, 4, 2)
    x.fillStyle = P.hatC; x.fillRect(13, 4, 2, 3)
  } else if (P.hat === 'cap') {
    x.fillStyle = OUT; x.fillRect(5, 1, 14, 8); x.fillRect(17, 6, 9, 4)
    x.fillStyle = P.hatA; x.fillRect(6, 2, 12, 6); x.fillStyle = P.hatB; x.fillRect(6, 6, 12, 2); x.fillStyle = P.hatC; x.fillRect(17, 7, 8, 2); x.fillRect(10, 3, 3, 2)
  }
  return c
}
function pipeTile(): HTMLCanvasElement {
  const P = CUR
  const [c, x] = mk(PW, 12)
  for (let yy = 0; yy < 12; yy++) for (let xx = 0; xx < PW; xx++) {
    x.fillStyle = ((xx + yy) % 12) < 6 ? P.pipeA : P.pipeB; x.fillRect(xx, yy, 1, 1)
  }
  x.fillStyle = P.pipeHi; x.fillRect(2, 0, 3, 12)
  x.fillStyle = P.pipeSh; x.fillRect(PW - 6, 0, 5, 12)
  x.fillStyle = P.ink; x.fillRect(0, 0, 1, 12); x.fillRect(PW - 1, 0, 1, 12)
  return c
}
function capSprite(): HTMLCanvasElement {
  const P = CUR, K = P.cap
  const [c, x] = mk(38, 21)
  x.fillStyle = P.ink; x.fillRect(0, 5, 38, 16)
  x.fillStyle = K.face; x.fillRect(1, 6, 36, 14)
  x.fillStyle = K.hi; x.fillRect(2, 7, 34, 2)
  x.fillStyle = K.lo; x.fillRect(2, 17, 34, 2)
  for (let i = 0; i < 6; i++) { x.fillStyle = K.dotA; x.fillRect(5 + i * 6, 11, 2, 2); x.fillStyle = K.dotB; x.fillRect(8 + i * 6, 13, 3, 3); x.fillStyle = K.dotC; x.fillRect(8 + i * 6, 13, 1, 1) }
  if (P.capTop) {
    const hs = [3, 4, 2, 5, 3, 2, 4, 3, 5, 2, 4, 3, 2, 4, 5, 3, 2, 4]
    hs.forEach((h, i) => { x.fillStyle = P.capTop![0]; x.fillRect(1 + i * 2, 5 - h, 2, h + 1); x.fillStyle = P.capTop![1]; x.fillRect(1 + i * 2, 5, 2, 1) })
  }
  return c
}
function starSprite(): HTMLCanvasElement {
  const [c, x] = mk(9, 9)
  const m = ['....Y....', '....Y....', '...YYY...', 'YYYYWYYYY', '.YYYYYYY.', '..YYYYY..', '..YYYYY..', '.YYY.YYY.', '.YY...YY.']
  m.forEach((r, y) => [...r].forEach((ch, xx) => { if (ch !== '.') { x.fillStyle = ch === 'W' ? '#fff' : CUR.acc2 === '#fff' ? '#ffe066' : CUR.acc2; x.fillRect(xx, y, 1, 1) } }))
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
  const cols = CUR.sky
  const bh = c.height / cols.length
  for (let i = 0; i < cols.length; i++) {
    x.fillStyle = cols[i]; x.fillRect(0, Math.floor(i * bh), W, Math.ceil(bh) + 1)
    if (i < cols.length - 1) for (let y = 0; y < 6; y++) for (let xx = 0; xx < W; xx++) {
      if (BAYER[(y & 3) * 4 + (xx & 3)] / 16 < (y + 1) / 7) { x.fillStyle = cols[i + 1]; x.fillRect(xx, Math.floor((i + 1) * bh) - 3 + y, 1, 1) }
    }
  }
  return c
}
// city skyline strip: buildings tile exactly to the canvas width so it wraps seamlessly
function skyline(hMax: number, hMin: number, wMin: number, wMax: number, wall: string, win: string, seed: number, winRate: number, h: number): HTMLCanvasElement {
  const [c, x] = mk(W, h); let r = seed
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647
  let px = 0
  while (px < W) {
    let bw = Math.floor(wMin + rnd() * (wMax - wMin)); if (W - (px + bw) < wMin) bw = W - px
    const bh = Math.floor(hMin + rnd() * (hMax - hMin))
    x.fillStyle = wall; x.fillRect(px, h - bh, bw, bh)
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(px + bw - 2, h - bh, 2, bh)
    for (let wy = h - bh + 4; wy < h - 3; wy += 6) for (let wx = px + 3; wx < px + bw - 4; wx += 5) if (rnd() < winRate) { x.fillStyle = win; x.fillRect(wx, wy, 2, 3) }
    if (rnd() < .3) { x.fillStyle = wall; x.fillRect(px + 2, h - bh - 5, 1, 5) }   // antenna
    px += bw
  }
  return c
}
function mountains(): HTMLCanvasElement {
  const M = CUR.mtn
  if (M.kind === 'city') return skyline(120, 50, 12, 24, M.a, M.b, 11, .22, 150)
  const [c, x] = mk(W, 150); const T = Math.PI * 2 / W
  for (let xx = 0; xx < W; xx++) {
    const h = 74 + Math.sin(xx * T * 2) * 30 + Math.sin(xx * T * 5 + 1) * 14 + Math.sin(xx * T * 9 + 2) * 6
    x.fillStyle = M.a; x.fillRect(xx, 150 - h, 1, h)
    x.fillStyle = M.b; if ((xx + Math.floor(h)) % 7 < 2) x.fillRect(xx, 150 - h + 8, 1, 10)
    if (M.peak && h > 92) { x.fillStyle = M.peak; x.fillRect(xx, 150 - h, 1, Math.min(14, (h - 92) * 1.1 + 2)) }
  }
  return c
}
function forest(): HTMLCanvasElement {
  const F = CUR.frs
  if (F.kind === 'city') return skyline(80, 34, 14, 26, F.a, F.hi ?? '#ffcf5a', 5, .3, 90)
  const [c, x] = mk(W, 90); let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 16; i++) {
    const bx = Math.floor(i * (W / 16) + rnd() * 6), hgt = 34 + Math.floor(rnd() * 26)
    for (const off of [0, -W, W]) {
      const cx = bx + off
      if (F.kind === 'pine') for (let r = 0; r < hgt; r++) {
        const hw = Math.floor(r * .33) + 1, y = 90 - hgt + r
        x.fillStyle = F.a; x.fillRect(cx - hw, y, hw * 2 + 1, 1)
        if (F.hi && r % 7 < 2 && r > 3) { x.fillStyle = F.hi; x.fillRect(cx - hw, y, Math.max(2, hw), 1) }
        x.fillStyle = F.b; x.fillRect(cx + Math.floor(hw * .4), y, Math.ceil(hw * .6) + 1, 1)
      } else if (F.kind === 'round') {
        const r = 9 + Math.floor(rnd() * 5), top = 90 - Math.floor(hgt * .6)
        x.fillStyle = '#6b4423'; x.fillRect(cx - 1, top + r - 2, 3, 90 - top - r + 2)
        disc(x, cx, top, r, F.a); disc(x, cx + 3, top + 3, Math.floor(r * .6), F.b)
        if (F.hi) { x.fillStyle = F.hi; x.fillRect(cx - r + 3, top - r + 4, 3, 2); x.fillRect(cx - 2, top - r + 2, 2, 2) }
      } else {   // dead tree
        x.fillStyle = F.a; x.fillRect(cx - 1, 90 - hgt, 3, hgt)
        for (let k = 0; k < 4; k++) {
          const by = 90 - hgt + 6 + k * Math.floor(hgt / 5), dir = k % 2 ? 1 : -1
          for (let s = 1; s < 9 - k; s++) x.fillRect(cx + dir * s, by - Math.floor(s * .8), 1, 2)
        }
      }
    }
  }
  return c
}
function hills(): HTMLCanvasElement {
  const [c, x] = mk(W, 44); const T = Math.PI * 2 / W
  for (let xx = 0; xx < W; xx++) {
    const h = 26 + Math.sin(xx * T * 3) * 9 + Math.sin(xx * T * 7 + 2) * 4
    x.fillStyle = CUR.hil.a; x.fillRect(xx, 44 - h, 1, h)
    x.fillStyle = CUR.hil.hi; x.fillRect(xx, 44 - h, 1, 2)
  }
  return c
}
function groundStrip(): HTMLCanvasElement {
  const G = CUR.gnd, INK = CUR.ink
  const [c, x] = mk(16, GROUND)
  x.fillStyle = G.top; x.fillRect(0, 0, 16, 8); x.fillStyle = G.shade; x.fillRect(0, 6, 16, 2)
  x.fillStyle = INK; x.fillRect(0, 8, 16, 2)
  for (let y = 10; y < 22; y++) for (let xx = 0; xx < 16; xx++) { x.fillStyle = ((xx + y) % 16) < 8 ? G.bandA : G.bandB; x.fillRect(xx, y, 1, 1) }
  x.fillStyle = INK; x.fillRect(0, 22, 16, 2)
  x.fillStyle = G.base; x.fillRect(0, 24, 16, GROUND - 24)
  x.fillStyle = G.l1; for (let y = 28; y < GROUND; y += 8) x.fillRect(0, y, 16, 2)
  x.fillStyle = G.l2; for (let xx = 2; xx < 16; xx += 8) x.fillRect(xx, 30, 3, 2)
  return c
}

// ---------------------------------------------------------------- component
export default function Game() {
  const theme: ThemeId = useTheme()
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
    CUR = PALS[theme]   // everything below is drawn from the active site theme's palette
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
      burst(BX, by, 26, CUR.burst, 4.2, .14, 60)
      if (score > bestNow) { bestNow = score; newBest = true; try { localStorage.setItem(BEST_KEY, String(score)) } catch { /* ignore */ } setBest(score); emitWorld('secret'); play('secret') }
      void submit(score)
    }
    const flap = () => {
      if (phase === 'dead') { if (performance.now() - deadAt > 650) { reset(); phase = 'ready' } return }
      if (phase === 'ready') { phase = 'play'; emitWorld('open') }
      vy = -4.55; play('flap')
      burst(BX - 8, by + 4, 4, CUR.puff, 1.4, .02, 22)
    }

    const update = () => {
      t++; frame = Math.floor(t / 5) % 3
      const rain = !!CUR.fall.rain
      for (const f of flakes) { f.y += f.v * (phase === 'play' ? 1.3 : 1) * (rain ? 4 : 1); f.x += (rain ? 0 : Math.sin((t + f.d * 20) / 40) * .25) - (phase === 'dead' ? 0 : speed() * (rain ? .6 : .35)); if (f.y > H) { f.y = -2; f.x = Math.random() * W } if (f.x < -2) f.x = W + 2 }
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
        if (!p.passed && p.x + PW / 2 < BX) { p.passed = true; score++; pop = 1; play('point'); emitWorld('send'); if (score % 10 === 0) { play('secret'); burst(BX, by, 20, [CUR.acc2, '#fff'], 3, .05, 50) } }
        if (p.star && !p.star.taken && Math.abs(p.x - BX) < 13 && Math.abs(p.star.y - by) < 13) { p.star.taken = true; score++; pop = 1.4; play('star'); burst(p.x, p.star.y, 22, [CUR.acc2 === '#fff' ? '#ffe066' : CUR.acc2, '#fff', '#ffe98a'], 3, .03, 44) }
      }
    }

    const flyBy = (x: number, y: number) => {
      const P = CUR
      if (P.fly === 'plane') {
        ctx.fillStyle = P.flyC; ctx.fillRect(x, y, 18, 6); ctx.fillRect(x + 5, y - 5, 7, 5); ctx.fillRect(x - 5, y - 3, 5, 5); ctx.fillStyle = '#fff'; ctx.fillRect(x + 13, y + 1, 4, 2)
        ctx.fillStyle = '#14301a'; ctx.fillRect(x + 19, y - 3 + (t % 4 < 2 ? 0 : 5), 1, 4)
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 40, y + 1, 34, 4); ctx.fillStyle = P.flyC; for (let i = 0; i < 4; i++) ctx.fillRect(x - 36 + i * 8, y + 2, 3, 2)   // banner
      } else if (P.fly === 'balloon') {
        disc(ctx, x, y, 9, P.ink); disc(ctx, x, y, 8, P.flyC); ctx.fillStyle = '#fff'; ctx.fillRect(x - 5, y - 5, 3, 2)
        ctx.fillStyle = P.ink; ctx.fillRect(x - 4, y + 9, 1, 6); ctx.fillRect(x + 4, y + 9, 1, 6); ctx.fillRect(x - 5, y + 15, 11, 6); ctx.fillStyle = '#ffe0ee'; ctx.fillRect(x - 4, y + 16, 9, 4)
      } else if (P.fly === 'heli') {
        ctx.fillStyle = P.flyC; ctx.fillRect(x, y, 16, 7); ctx.fillRect(x - 16, y + 1, 17, 2); ctx.fillRect(x - 17, y - 3, 2, 5); ctx.fillRect(x + 2, y + 7, 12, 1)
        ctx.fillStyle = '#37e1ff'; ctx.fillRect(x + 10, y + 1, 5, 4); ctx.fillStyle = '#aab0c0'; ctx.fillRect(x - 6 + (t % 4 < 2 ? 0 : 3), y - 3, 24 - (t % 4 < 2 ? 0 : 6), 1)
        ctx.fillStyle = '#ff2e63'; if (t % 20 < 10) ctx.fillRect(x - 17, y - 4, 2, 2)
      } else if (P.fly === 'bats') {
        ctx.fillStyle = P.flyC
        for (let i = 0; i < 4; i++) { const bx = x - i * 22, by2 = y + Math.sin(t / 9 + i * 2) * 8 + i * 4, up = Math.sin(t / 3 + i) > 0 ? -3 : 2; ctx.fillRect(bx, by2, 3, 3); ctx.fillRect(bx - 5, by2 + up, 5, 2); ctx.fillRect(bx + 3, by2 + up, 5, 2); ctx.fillRect(bx - 8, by2 + up + 1, 3, 2); ctx.fillRect(bx + 8, by2 + up + 1, 3, 2) }
        ctx.fillStyle = '#ff2a2a'; ctx.fillRect(x, y + 1, 1, 1); ctx.fillRect(x + 2, y + 1, 1, 1)
      } else sleigh(x, y)
    }
    const sleigh = (x: number, y: number) => {
      ctx.fillStyle = CUR.flyC
      for (let i = 0; i < 3; i++) {
        const rx = x - 34 - i * 22, lg = Math.sin(t / 4 + i) * 2
        ctx.fillRect(rx, y + 2, 14, 6); ctx.fillRect(rx + 12, y - 3, 5, 5); ctx.fillRect(rx + 14, y - 8, 1, 5); ctx.fillRect(rx + 16, y - 8, 1, 5)
        ctx.fillRect(rx + 1, y + 8, 2, 5 + lg); ctx.fillRect(rx + 10, y + 8, 2, 5 - lg)
        if (i === 0) { ctx.fillStyle = CUR.acc; ctx.fillRect(rx + 17, y - 1, 2, 2); ctx.fillStyle = CUR.flyC }
        ctx.fillRect(rx + 14, y + 4, 22, 1)
      }
      ctx.fillStyle = '#6b1020'; ctx.fillRect(x - 6, y, 22, 8); ctx.fillStyle = GOLD; ctx.fillRect(x - 6, y + 7, 22, 2)
      ctx.fillStyle = CUR.flyC; ctx.fillRect(x - 8, y + 10, 26, 2); ctx.fillRect(x - 8, y + 6, 2, 5)
      ctx.fillStyle = CUR.acc; ctx.fillRect(x + 2, y - 6, 6, 6); ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y - 1, 8, 2); ctx.fillRect(x + 7, y - 8, 2, 2)
      ctx.fillStyle = '#f2c9a0'; ctx.fillRect(x + 3, y - 3, 4, 3)
      if (t % 2 === 0) burst(x - 100, y + 8, 1, [GOLD, '#fff'], .6, .01, 36)
    }

    const draw = () => {
      ctx.save()
      if (shake > .3 && !reduce) ctx.translate(Math.round((Math.random() - .5) * shake), Math.round((Math.random() - .5) * shake))
      ctx.drawImage(sky, 0, 0)
      if (CUR.stars) for (const s of stars) { const tw = Math.sin(t / 22 + s.p); if (tw > -.4) { ctx.fillStyle = s.b ? CUR.stars[1] : CUR.stars[0]; ctx.fillRect(s.x, s.y, s.b ? 2 : 1, s.b ? 2 : 1) } }
      // moon
      disc(ctx, 206, 78, 22, CUR.moon[0]); disc(ctx, 206, 78, 19, CUR.moon[1]); ctx.fillStyle = CUR.moon[2]; ctx.fillRect(198, 70, 5, 4); ctx.fillRect(210, 82, 6, 5); ctx.fillRect(204, 90, 3, 3)
      // aurora (grows with score)
      const aur = .3 + Math.min(score, 24) / 24 * .7
      if (CUR.aurora && (!reduce || score > 0)) for (let xx = 0; xx < W; xx += 3) {
        const yy = 150 + Math.sin(xx * .035 + t / 55) * 16 + Math.sin(xx * .09 - t / 40) * 6
        for (let k = 0; k < 5; k++) {
          ctx.globalAlpha = (.34 - k * .06) * aur; ctx.fillStyle = k % 2 ? CUR.aurora![0] : CUR.aurora![1]
          ctx.fillRect(xx, yy - k * 9, 3, 9)
        }
      }
      ctx.globalAlpha = 1
      // sleigh fly-by
      if (sleighT < 0) flyBy(W + 150 + sleighT * 1.1, 62 + Math.sin(t / 30) * 6)
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
      ctx.fillStyle = CUR.fall.c; for (const f of flakes) ctx.fillRect(Math.round(f.x), Math.round(f.y), CUR.fall.rain ? 1 : f.s, CUR.fall.rain ? 5 : f.s)
      if (flash > .05 && !reduce) { ctx.globalAlpha = flash * .7; ctx.fillStyle = flashC; ctx.fillRect(-10, -10, W + 20, H + 20); ctx.globalAlpha = 1 }
      ctx.restore()
      hud()
    }

    const medal = (x: number, y: number, tier: number) => {
      const cols = [['#8a5a2b', '#c98a4b'], ['#7f8fa6', '#d6e0ee'], ['#c77b00', '#ffd21f'], ['#5ee7ff', '#e9fbff']][tier]
      ctx.fillStyle = CUR.ink; ctx.fillRect(x - 2, y - 14, 4, 5); disc(ctx, x, y, 13, CUR.ink); disc(ctx, x, y, 11, cols[0]); disc(ctx, x, y, 8, cols[1])
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, y - 6, 3, 2); ctx.fillRect(x - 6, y - 4, 2, 2)
      ctx.fillStyle = CUR.acc; ctx.fillRect(x - 3, y - 17, 6, 3); ctx.fillStyle = CUR.acc2; ctx.fillRect(x - 1, y - 16, 2, 1)
    }
    const hud = () => {
      if (phase === 'ready') {
        const t1 = 'FLAPPY KARI', size = 18
        ;[...t1].forEach((ch, i) => txt(ctx, ch, Math.round(W / 2 - t1.length * size / 2 + i * size + size / 2), 86 + Math.round(Math.sin(t / 10 + i * .6) * 5), size, CUR.title[i % 4]))
        txt(ctx, CUR.sub, W / 2, 120, 8, CUR.subC)
        if (Math.floor(t / 28) % 2 === 0) txt(ctx, 'TAP TO FLAP', W / 2, 296, 11, CUR.tapC)
        txt(ctx, 'SPACE / CLICK / TAP', W / 2, 318, 7, CUR.hintC)
        if (bestNow > 0) txt(ctx, 'BEST ' + bestNow, W / 2, 350, 9, CUR.acc2)
        return
      }
      if (phase === 'play' || (phase === 'dead' && performance.now() - deadAt < 500)) { const s = 1 + Math.max(0, pop) * .15; txt(ctx, String(score), W / 2, 36 - Math.round(Math.max(0, pop) * 3), Math.round(26 * s), '#fff') }
      if (phase === 'dead' && performance.now() - deadAt >= 500) {
        const x0 = 30, y0 = 118, w = W - 60, h = 224
        ctx.fillStyle = CUR.ink; ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6); ctx.fillStyle = CUR.ui.trim; ctx.fillRect(x0, y0, w, h); ctx.fillStyle = CUR.ui.bg; ctx.fillRect(x0 + 3, y0 + 3, w - 6, h - 6)
        ctx.fillStyle = CUR.ui.line; ctx.fillRect(x0 + 3, y0 + 3, w - 6, 2); ctx.fillRect(x0 + 3, y0 + h - 5, w - 6, 2)
        txt(ctx, 'GAME OVER', W / 2, y0 + 14, 14, Math.floor(t / 10) % 2 ? CUR.ui.over[0] : CUR.ui.over[1])
        const tier = score >= 30 ? 3 : score >= 20 ? 2 : score >= 10 ? 1 : score >= 5 ? 0 : -1
        if (tier >= 0) medal(W / 2, y0 + 80, tier); else txt(ctx, 'NO MEDAL', W / 2, y0 + 72, 8, CUR.ui.none)
        txt(ctx, 'SCORE', W / 2, y0 + 112, 8, CUR.ui.label); txt(ctx, String(score), W / 2, y0 + 126, 16, '#fff')
        txt(ctx, 'BEST ' + bestNow, W / 2, y0 + 154, 9, CUR.acc2)
        if (newBest) txt(ctx, 'NEW BEST!', W / 2, y0 + 172, 9, Math.floor(t / 6) % 2 ? '#fff' : CUR.acc2)
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
  }, [refreshBoard, theme])

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
