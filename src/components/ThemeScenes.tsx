import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { onWorld, emitWorld } from '../lib/bus'
import { play } from '../lib/sfx'

// Low-poly retro backgrounds for the non-Christmas themes (Christmas lives untouched in Background3D.tsx).
// Same look/pipeline as the Christmas scene: 480x270 (320x180 on phones), flat shading, 64px dithered textures with NearestFilter,
// grid-snapped vertices, Bayer-dithered colour. Everything reacts to the same UI events (nav, send, receive, alert, secret).
export type SceneTheme = 'outside' | 'kitty' | 'nyc' | 'horror'

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function noiseTex(base: string, accent: string, density = .33): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!; g.fillStyle = base; g.fillRect(0, 0, 64, 64)
  g.fillStyle = accent
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = ((Math.sin(x * .6) * Math.cos(y * .5) + 1) / 2) * density * 2
    if (v > BAYER[(y & 3) * 4 + (x & 3)] / 16) g.fillRect(x, y, 1, 1)
  }
  return finishTex(new THREE.CanvasTexture(c))
}
function finishTex(t: THREE.CanvasTexture) {
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t
}
// building facade: brick/concrete with a grid of windows, a share of them lit
function facadeTex(wall: string, mortar: string, lit: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!; g.fillStyle = wall; g.fillRect(0, 0, 64, 64)
  g.fillStyle = mortar
  for (let y = 0; y < 64; y += 4) { g.fillRect(0, y, 64, 1); for (let x = (y / 4) % 2 ? 0 : 4; x < 64; x += 8) g.fillRect(x, y, 1, 4) }
  let r = seed
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647 }
  for (let wy = 6; wy < 58; wy += 14) for (let wx = 6; wx < 58; wx += 14) {
    g.fillStyle = '#05050a'; g.fillRect(wx - 1, wy - 1, 8, 10)
    g.fillStyle = rnd() > .45 ? lit : '#1a1c28'; g.fillRect(wx, wy, 6, 8)
  }
  return finishTex(new THREE.CanvasTexture(c))
}

function retro(m: THREE.MeshLambertMaterial, snap = 90) {
  m.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      gl_Position.xy = floor(gl_Position.xy / gl_Position.w * ${snap.toFixed(1)} + .5) / ${snap.toFixed(1)} * gl_Position.w;`)
    s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      {
        int ix = int(mod(gl_FragCoord.x, 4.0)); int iy = int(mod(gl_FragCoord.y, 4.0));
        float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        float th = b[iy*4+ix] / 16.0 - 0.5;
        gl_FragColor.rgb = floor(gl_FragColor.rgb * 7.0 + th + 0.5) / 7.0;
      }`)
  }
  return m
}
const lam = (o: THREE.MeshLambertMaterialParameters) => retro(new THREE.MeshLambertMaterial({ flatShading: true, ...o }))
const solid = (color: string, emissive?: string) => lam({ color, ...(emissive ? { emissive: new THREE.Color(emissive) } : {}) })

// shared live state fed by UI events
type S = { pulse: number; flash: number; alert: number; party: number; hop: number }
type Built = { pick: THREE.Object3D[]; onPick: (o: THREE.Object3D) => void; tick: (t: number, now: number, s: S) => void; bg: THREE.Color; fogBase: THREE.Color; fog: THREE.Fog }
type Ctx = { scene: THREE.Scene; small: boolean }

export default function ThemeScenes({ theme }: { theme: SceneTheme }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const small = window.matchMedia('(max-width: 768px)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const W = small ? 320 : 480, H = small ? 180 : 270
    const fallback: Record<SceneTheme, string> = { outside: 'linear-gradient(#7ec8ff,#bfe6ff)', kitty: 'linear-gradient(#ffc2dd,#fff0f7)', nyc: 'linear-gradient(#0b0b12,#2a1a24)', horror: 'linear-gradient(#050308,#2a0505)' }
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' }) }
    catch { canvas.style.background = fallback[theme]; return }   // no WebGL => static gradient, app still works
    renderer.setPixelRatio(1); renderer.setSize(W, H, false)

    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(55, W / H, .1, 70); cam.position.set(0, 3.2, 9)
    const disposables: { dispose(): void }[] = []
    const ctx: Ctx = { scene, small }
    const built = ({ outside, kitty, nyc, horror } as const)[theme](ctx, disposables)
    scene.background = built.bg.clone(); scene.fog = built.fog

    const st: S = { pulse: 0, flash: 0, alert: 0, party: 0, hop: 0 }
    let tx = 0, ty = 0, scroll = 0, zoom = 0, shake = 0
    const onMove = (e: PointerEvent) => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5 }
    const onScroll = (e: Event) => { const t = e.target as HTMLElement; scroll = Math.min(1, (t.scrollTop ?? 0) / 800) }
    addEventListener('pointermove', onMove, { passive: true }); addEventListener('scroll', onScroll, { capture: true, passive: true })
    const off = onWorld(e => {
      if (e === 'nav') shake = 1
      if (e === 'open') zoom = 1
      if (e === 'close') zoom = -.6
      if (e === 'send') { st.hop = 1; st.pulse = .5 }
      if (e === 'receive') { st.flash = 1; st.pulse = .3 }
      if (e === 'alert') { st.alert = 2; st.pulse = 2; st.party = 2 }
      if (e === 'secret') st.party = 6
      if (e === 'error') st.pulse = -.5
    })
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2()
    let pokes = 0
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role=dialog],.panel,.logo')) return
      const r = canvas.getBoundingClientRect()
      v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(v2, cam)
      const hit = ray.intersectObjects(built.pick, true)[0]
      if (hit) { built.onPick(hit.object); play('notify'); st.hop = 1.2; if (++pokes >= 7) { pokes = 0; play('secret'); st.party = 5; emitWorld('secret') } }
    }
    addEventListener('click', onClick)

    let raf = 0, last = 0, running = true
    const clock = new THREE.Clock(); const fpsGap = small ? 1000 / 30 : 1000 / 45
    const alertCol = new THREE.Color('#5a0f1a'), hsl = new THREE.Color(); let hue = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!running || now - last < fpsGap) return
      last = now
      const t = clock.getElapsedTime() * (reduce ? 0 : 1), dt = .05
      st.pulse *= .92; zoom *= .93; shake *= .9; st.flash *= .9; st.hop *= .9
      st.party = Math.max(0, st.party - .03); st.alert = Math.max(0, st.alert - .03)
      cam.position.x += ((tx * 2.2) - cam.position.x) * dt * 2
      cam.position.y += ((3.2 - ty * 1.2 - scroll * 1.2 - zoom * .6) - cam.position.y) * dt * 2
      cam.position.z += ((9 - scroll * 3 - zoom * 1.6 - st.pulse * .3) - cam.position.z) * dt * 2
      cam.rotation.z = shake * .04 * Math.sin(now * .02)
      cam.lookAt(tx * 1.5, 2 - scroll, -6)
      built.tick(t, now, st)
      const bg = scene.background as THREE.Color
      bg.copy(built.bg)
      if (st.party > 0) { hue = (hue + .02) % 1; hsl.setHSL(hue, .55, theme === 'outside' || theme === 'kitty' ? .7 : .2); bg.lerp(hsl, Math.min(1, st.party)) }
      if (st.alert > 0) bg.lerp(alertCol, Math.min(1, st.alert))
      built.fog.color.copy(st.party > 0 || st.alert > 0 ? bg : built.fogBase)
      renderer.render(scene, cam)
    }
    const vis = () => { running = !document.hidden }
    document.addEventListener('visibilitychange', vis)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf); off()
      removeEventListener('pointermove', onMove); removeEventListener('scroll', onScroll, true); removeEventListener('click', onClick)
      document.removeEventListener('visibilitychange', vis)
      scene.traverse(o => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        ;(Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => { (x as THREE.MeshLambertMaterial).map?.dispose(); x.dispose() })
      })
      disposables.forEach(d => d.dispose()); renderer.dispose()
    }
  }, [theme])

  return <canvas id="bg3d" ref={ref} aria-hidden="true" />
}

// ---------- helpers ----------
function snapG<T extends THREE.BufferGeometry>(g: T, n = 4) {
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setXYZ(i, Math.round(p.getX(i) * n) / n, Math.round(p.getY(i) * n) / n, Math.round(p.getZ(i) * n) / n)
  g.computeVertexNormals(); return g
}
const mk = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(snapG(g), m); o.position.set(x, y, z); parent.add(o); return o
}
function hills(w: number, amp: number, tex: THREE.Texture, color?: string) {
  const g = new THREE.PlaneGeometry(w, w, 6, 6).rotateX(-Math.PI / 2)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * .5) * amp + Math.cos(p.getZ(i) * .45) * amp * .85)
  tex.repeat.set(6, 6)
  return new THREE.Mesh(snapG(g), lam({ map: tex, ...(color ? { color } : {}) }))
}
function points(n: number, fill: (i: number, a: Float32Array) => void, color: string, size: number, opacity = 1, fog = true) {
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) fill(i, a)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3))
  const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: opacity < 1, opacity, fog })
  return { pts: new THREE.Points(g, m), attr: g.attributes.position as THREE.BufferAttribute }
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

// =============== OUTSIDE: sunny meadow ===============
function outside({ scene, small }: Ctx, _d: { dispose(): void }[]): Built {
  const bg = new THREE.Color('#7ec8ff'), fogBase = new THREE.Color('#c4e8ff'), fog = new THREE.Fog('#c4e8ff', 12, 38)
  scene.add(new THREE.AmbientLight('#ffffff', 1.0))
  const sunL = new THREE.DirectionalLight('#fff4cc', 1.1); sunL.position.set(6, 10, 5); scene.add(sunL)
  scene.add(hills(44, .34, noiseTex('#4cb04f', '#3a9440'), undefined))
  const trunk = solid('#7a4b26'), leaf1 = lam({ map: noiseTex('#2f9e44', '#237a35'), }), leaf2 = lam({ map: noiseTex('#3fb04a', '#2c8a3a') })
  const trees: THREE.Group[] = []
  ;([[-7, -4, 1.3, 0], [7.5, -5, 1.5, 1], [-4.5, -9, 1.2, 1], [4, -8, 1.0, 0], [-11, -9, 1.6, 0], [11, -10, 1.4, 1], [-1.5, -14, 1.5, 1], [-9, -1, 1.0, 1], [0.5, -11, 1.9, 0]] as const).forEach(([x, z, s, k]) => {
    const g = new THREE.Group(); g.position.set(x, 0, z)
    mk(g, new THREE.CylinderGeometry(.18 * s, .24 * s, 1.5 * s, 5), trunk, 0, .75 * s, 0)
    mk(g, new THREE.IcosahedronGeometry(1.15 * s, 0), k ? leaf2 : leaf1, 0, 2.1 * s, 0)
    mk(g, new THREE.IcosahedronGeometry(.8 * s, 0), k ? leaf1 : leaf2, .55 * s, 2.8 * s, .2 * s)
    scene.add(g); trees.push(g)
  })
  // little house
  const house = new THREE.Group(); house.position.set(3.4, 0, -1.6); scene.add(house)
  mk(house, new THREE.BoxGeometry(2, 1.4, 1.6), lam({ map: noiseTex('#f3e3c0', '#e0c997') }), 0, .7, 0)
  mk(house, new THREE.ConeGeometry(1.7, 1.1, 4), solid('#c0392b'), 0, 1.95, 0).rotation.y = Math.PI / 4
  mk(house, new THREE.BoxGeometry(.4, .75, .1), solid('#6b3e1c'), -.35, .38, .82)
  mk(house, new THREE.BoxGeometry(.4, .4, .1), solid('#9fd8ff', '#2a5a7a'), .5, .85, .82)
  mk(house, new THREE.BoxGeometry(.3, .7, .3), solid('#8a8f98'), .6, 2.2, -.2)
  // sun + clouds
  const sun = mk(scene, new THREE.IcosahedronGeometry(1.7, 0), solid('#fff1a0', '#c9a400'), 9, 9, -22)
  const cmat = solid('#ffffff', '#9fb4c8')
  const clouds = [[-8, 8.5, -16], [3, 9.5, -20], [-1, 7.2, -12], [10, 8, -14], [-14, 9.8, -22]].map(([x, y, z], i) => {
    const g = new THREE.Group(); g.position.set(x, y, z)
    mk(g, new THREE.IcosahedronGeometry(1.1, 0), cmat, 0, 0, 0); mk(g, new THREE.IcosahedronGeometry(.8, 0), cmat, 1.1, -.15, 0); mk(g, new THREE.IcosahedronGeometry(.75, 0), cmat, -1.05, -.2, .1)
    g.userData.sp = .15 + i * .04; scene.add(g); return g
  })
  // flowers + butterflies + drifting pollen
  const cols = ['#ff4d6d', '#ffd23f', '#ffffff', '#ff9ff3']
  cols.forEach(c => { const f = points(small ? 14 : 24, (i, a) => { a[i * 3] = rnd(-9, 9); a[i * 3 + 1] = .35; a[i * 3 + 2] = rnd(-6, 5) }, c, 3, 1, true); scene.add(f.pts) })
  const bf = points(5, (i, a) => { a[i * 3] = rnd(-4, 4); a[i * 3 + 1] = rnd(1, 2.5); a[i * 3 + 2] = rnd(-3, 2) }, '#ff9ff3', 4, 1, false); scene.add(bf.pts)
  const base = Array.from({ length: 5 }, (_, i) => [bf.attr.getX(i), bf.attr.getY(i), bf.attr.getZ(i)])
  const pick: THREE.Object3D[] = [house, sun]
  return {
    bg, fogBase, fog, pick,
    onPick: o => { let p: THREE.Object3D | null = o; while (p && p !== house && p !== sun) p = p.parent; if (p === sun) sun.scale.setScalar(1.5) },
    tick: (t, now, s) => {
      trees.forEach((tr, i) => { tr.rotation.z = Math.sin(t * .9 + i) * .02 })
      clouds.forEach(c => { c.position.x += c.userData.sp * .02 * (1 + s.pulse); if (c.position.x > 16) c.position.x = -16 })
      sun.rotation.y = t * .2; sun.scale.setScalar(sun.scale.x + (1 - sun.scale.x) * .05)
      house.position.y = Math.max(0, Math.sin(now * .02)) * s.hop * .5
      for (let i = 0; i < 5; i++) bf.attr.setXYZ(i, base[i][0] + Math.sin(t * .8 + i * 2) * 2.5, base[i][1] + Math.sin(t * 3 + i) * .35, base[i][2] + Math.cos(t * .6 + i) * 1.5)
      bf.attr.needsUpdate = true
      sunL.intensity = 1.1 + s.flash * .6
    }
  }
}

// =============== KAWAII PINK: candy land ===============
function kitty({ scene, small }: Ctx, d: { dispose(): void }[]): Built {
  const bg = new THREE.Color('#ffc2dd'), fogBase = new THREE.Color('#ffd9ea'), fog = new THREE.Fog('#ffd9ea', 10, 34)
  scene.add(new THREE.AmbientLight('#fff0f7', 1.05))
  const dl = new THREE.DirectionalLight('#ffffff', 1.0); dl.position.set(-5, 9, 6); scene.add(dl)
  scene.add(hills(44, .3, noiseTex('#ffe3ef', '#ffc2dd'), undefined))
  const pink = solid('#ff8fc0'), hot = solid('#ff5fa2'), white = solid('#ffffff', '#6a5a62'), cream = solid('#fff0c9'), red = solid('#ff3b5c')
  const lav = solid('#c9b2ff')
  // heart shape
  const sh = new THREE.Shape(); sh.moveTo(0, -.9); sh.bezierCurveTo(-1.4, .1, -.7, 1, 0, .4); sh.bezierCurveTo(.7, 1, 1.4, .1, 0, -.9)
  const heartG = new THREE.ExtrudeGeometry(sh, { depth: .35, bevelEnabled: false, curveSegments: 3 }); d.push(heartG)
  const hearts: THREE.Mesh[] = []
  ;([[-6, 4, -4, pink], [6.5, 5.5, -6, hot], [-2.5, 6.5, -9, white], [3, 3.2, -3, lav], [-9, 7.5, -12, hot], [9, 8, -13, pink], [0.5, 9, -16, white]] as [number, number, number, THREE.Material][]).forEach(([x, y, z, m], i) => {
    const h = new THREE.Mesh(heartG, m); h.position.set(x, y, z); h.scale.setScalar(.8 + (i % 3) * .3); h.userData.y = y; h.userData.i = i; scene.add(h); hearts.push(h)
  })
  // cotton-candy trees
  const trees: THREE.Group[] = []
  ;([[-7, -4, 1.2, pink], [7.5, -5, 1.4, lav], [-4.5, -9, 1.1, lav], [4, -8, 1, pink], [-11, -9, 1.5, pink], [11, -10, 1.3, lav], [-1.5, -13, 1.4, hot]] as [number, number, number, THREE.Material][]).forEach(([x, z, s, m]) => {
    const g = new THREE.Group(); g.position.set(x, 0, z)
    mk(g, new THREE.CylinderGeometry(.14 * s, .18 * s, 1.2 * s, 5), white, 0, .6 * s, 0)
    mk(g, new THREE.IcosahedronGeometry(1.0 * s, 0), m, 0, 1.9 * s, 0); mk(g, new THREE.IcosahedronGeometry(.62 * s, 0), white, .5 * s, 2.5 * s, .3 * s)
    scene.add(g); trees.push(g)
  })
  // cupcakes
  const cakes = [[2.5, -1, 1], [4, -.2, .8], [-3.4, .2, 1.1]].map(([x, z, s], i) => {
    const g = new THREE.Group(); g.position.set(x, .2, z); g.userData.y = .2
    mk(g, new THREE.CylinderGeometry(.7 * s, .5 * s, .6 * s, 6), i % 2 ? lav : cream, 0, .3 * s, 0)
    mk(g, new THREE.IcosahedronGeometry(.75 * s, 0), i % 2 ? white : pink, 0, .95 * s, 0)
    mk(g, new THREE.IcosahedronGeometry(.18 * s, 0), red, 0, 1.6 * s, 0)
    scene.add(g); return g
  })
  // bows
  const bows = [[-5.5, 1.1, -1.5, hot], [5.8, 1.3, -2.8, pink]].map(([x, y, z, m]) => {
    const g = new THREE.Group(); g.position.set(x as number, y as number, z as number)
    const a = mk(g, new THREE.ConeGeometry(.7, 1.2, 4), m as THREE.Material, -.7, 0, 0); a.rotation.z = Math.PI / 2
    const b = mk(g, new THREE.ConeGeometry(.7, 1.2, 4), m as THREE.Material, .7, 0, 0); b.rotation.z = -Math.PI / 2
    mk(g, new THREE.IcosahedronGeometry(.32, 0), white, 0, 0, 0); g.userData.y = y; scene.add(g); return g
  })
  const clouds = [[-8, 9, -16], [4, 10, -19], [10, 8, -13], [-2, 7.6, -11]].map(([x, y, z], i) => {
    const g = new THREE.Group(); g.position.set(x, y, z)
    mk(g, new THREE.IcosahedronGeometry(1.1, 0), white, 0, 0, 0); mk(g, new THREE.IcosahedronGeometry(.8, 0), pink, 1.1, -.15, 0); mk(g, new THREE.IcosahedronGeometry(.75, 0), white, -1.05, -.2, 0)
    g.userData.sp = .12 + i * .04; scene.add(g); return g
  })
  const sp = points(small ? 40 : 70, (i, a) => { a[i * 3] = rnd(-13, 13); a[i * 3 + 1] = rnd(.5, 11); a[i * 3 + 2] = rnd(-14, 4) }, '#ffffff', 3, 1, false); scene.add(sp.pts)
  const petals = points(small ? 40 : 70, (i, a) => { a[i * 3] = rnd(-14, 14); a[i * 3 + 1] = rnd(0, 12); a[i * 3 + 2] = rnd(-12, 4) }, '#ff7ab8', 3, 1, true); scene.add(petals.pts)
  const spMat = sp.pts.material as THREE.PointsMaterial
  const pick: THREE.Object3D[] = [...hearts, ...cakes, ...bows]
  const spin = new Map<THREE.Object3D, number>()
  return {
    bg, fogBase, fog, pick,
    onPick: o => { let p: THREE.Object3D | null = o; while (p && p.parent && p.parent !== scene) p = p.parent; if (p) spin.set(p, 1) },
    tick: (t, now, s) => {
      hearts.forEach(h => { h.position.y = h.userData.y + Math.sin(t * 1.2 + h.userData.i) * .35 + s.pulse * .1; h.rotation.y = t * .6 + h.userData.i + (spin.get(h) ?? 0) * 8; h.scale.setScalar((.8 + (h.userData.i % 3) * .3) * (1 + (spin.get(h) ?? 0) * .3)) })
      cakes.forEach((c, i) => { c.position.y = c.userData.y + Math.max(0, Math.sin(now * .02 + i * 2)) * s.hop * .5; c.rotation.y = (spin.get(c) ?? 0) * 8 })
      bows.forEach((b, i) => { b.position.y = b.userData.y + Math.sin(t + i * 2) * .15; b.rotation.y = Math.sin(t * .8 + i) * .4 + (spin.get(b) ?? 0) * 8 })
      spin.forEach((v, k) => { if (v < .02) spin.delete(k); else spin.set(k, v * .93) })
      trees.forEach((tr, i) => { tr.rotation.z = Math.sin(t * .8 + i) * .025 })
      clouds.forEach(c => { c.position.x += c.userData.sp * .02; if (c.position.x > 16) c.position.x = -16 })
      const pa = petals.attr
      for (let i = 0; i < pa.count; i++) { let y = pa.getY(i) - (.012 + Math.max(0, s.pulse) * .02) * (.6 + (i % 5) * .2); if (y < 0) y = 12; pa.setXYZ(i, pa.getX(i) + Math.sin(t + i) * .006, y, pa.getZ(i)) }
      pa.needsUpdate = true
      spMat.size = 2 + (Math.sin(t * 4) + 1) * 1.2 + s.flash * 2   // twinkle
    }
  }
}

// =============== NYC: gritty night street ===============
function nyc({ scene, small }: Ctx, d: { dispose(): void }[]): Built {
  const bg = new THREE.Color('#0b0b12'), fogBase = new THREE.Color('#14141c'), fog = new THREE.Fog('#14141c', 7, 30)
  scene.add(new THREE.AmbientLight('#6a6a9a', .8))
  const dl = new THREE.DirectionalLight('#8a8fc8', .55); dl.position.set(-4, 9, 5); scene.add(dl)
  const warm = new THREE.PointLight('#ff9f1c', 1.2, 16); warm.position.set(-2.5, 4, 0); scene.add(warm)
  // wet asphalt street
  const road = new THREE.Mesh(snapG(new THREE.PlaneGeometry(44, 44, 2, 2).rotateX(-Math.PI / 2)), lam({ map: noiseTex('#26262e', '#3a3a46', .2) })); scene.add(road)
  ;(road.material as THREE.MeshLambertMaterial).map!.repeat.set(8, 8)
  const dash = solid('#f2c230', '#6a5200')
  for (let z = 4; z > -30; z -= 3) mk(scene, new THREE.BoxGeometry(.18, .02, 1.3), dash, 0, .02, z)
  mk(scene, new THREE.BoxGeometry(2.4, .03, 7), solid('#e8e8e8'), 1.2, .03, -4.5)  // crosswalk block
  for (let i = 0; i < 6; i++) mk(scene, new THREE.BoxGeometry(2.6, .035, .3), solid('#f0f0f0'), 0, .035, -1.5 - i * .6)
  // buildings both sides + backdrop
  const facades = [facadeTex('#6b2f23', '#4a1f17', '#ffcf5a', 7), facadeTex('#45454f', '#2e2e36', '#ffe9a0', 13), facadeTex('#5a4636', '#3d2f23', '#ff9f4a', 29), facadeTex('#2f3a4a', '#1f2833', '#9fe8ff', 41)]
  facades.forEach(f => d.push(f))
  const fm = facades.map(f => lam({ map: f }))
  const addB = (x: number, z: number, w: number, h: number, dd: number, i: number) => {
    const m = fm[i % 4]
    mk(scene, new THREE.BoxGeometry(w, h, dd), m, x, h / 2, z)
    mk(scene, new THREE.BoxGeometry(w + .2, .25, dd + .2), solid('#1a1a20'), x, h + .12, z)  // roof lip
  }
  const lh = [6, 8.5, 5, 9.5, 7, 10, 6.5, 8]
  for (let k = 0; k < 8; k++) { addB(-7.2, 2 - k * 4, 4.4, lh[k], 3.8, k); addB(7.2, 2 - k * 4, 4.4, lh[(k + 3) % 8], 3.8, k + 1) }
  for (let k = 0; k < 6; k++) addB(-10 + k * 4, -30, 4, 8 + (k % 3) * 2.5, 3, k + 2)
  // water tower on a left roof
  const wt = new THREE.Group(); wt.position.set(-7.2, lh[1], -2); scene.add(wt)
  mk(wt, new THREE.CylinderGeometry(.9, .9, 1.4, 6), solid('#6a4a2c'), 0, 1.4, 0); mk(wt, new THREE.ConeGeometry(1.05, .6, 6), solid('#4a331e'), 0, 2.4, 0)
  ;[[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]].forEach(([x, z]) => mk(wt, new THREE.CylinderGeometry(.05, .05, 1, 4), solid('#222'), x, .5, z))
  // graffiti wall on the right building
  const gc = document.createElement('canvas'); gc.width = 128; gc.height = 64
  const gctx = gc.getContext('2d')!
  const gt = finishTex(new THREE.CanvasTexture(gc)); gt.wrapS = gt.wrapT = THREE.ClampToEdgeWrapping; d.push(gt)
  const paint = () => {
    gctx.clearRect(0, 0, 128, 64); gctx.font = '28px "Permanent Marker", Impact, sans-serif'; gctx.textAlign = 'center'
    gctx.fillStyle = '#ff2e63'; gctx.fillText('CHAT', 66, 30); gctx.fillStyle = '#37e1ff'; gctx.fillText('KARI', 64, 58)
    gctx.fillStyle = '#ffe14d'; gctx.fillText('CHAT', 62, 28); gctx.fillStyle = '#ffe14d'; gctx.fillRect(8, 6, 4, 4); gctx.fillRect(112, 50, 4, 4)
    gt.needsUpdate = true
  }
  paint(); void document.fonts?.load('28px "Permanent Marker"').then(paint)
  const gw = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: gt, transparent: true, fog: true })); gw.position.set(4.97, 2.2, -3); gw.rotation.y = -Math.PI / 2; scene.add(gw)
  // neon signs (blink) + street lamps
  const neonA = solid('#ff2e63', '#ff2e63'), neonB = solid('#37e1ff', '#37e1ff')
  const sA = mk(scene, new THREE.BoxGeometry(.15, .6, 2), neonA, -4.9, 3.4, -5); const sB = mk(scene, new THREE.BoxGeometry(.15, .5, 1.5), neonB, -4.9, 2.4, -9.5)
  const lamps = [[-3.6, -2], [3.6, -6], [-3.6, -11], [3.6, -15]].map(([x, z]) => {
    mk(scene, new THREE.CylinderGeometry(.07, .09, 3.6, 4), solid('#1e1e24'), x, 1.8, z)
    return mk(scene, new THREE.IcosahedronGeometry(.22, 0), solid('#ffe9a0', '#ffcf5a'), x, 3.7, z)
  })
  // taxi
  const taxi = new THREE.Group(); taxi.position.set(1.6, .3, 4); scene.add(taxi)
  mk(taxi, new THREE.BoxGeometry(1.1, .45, 2.2), solid('#f2c230'), 0, .25, 0); mk(taxi, new THREE.BoxGeometry(.95, .4, 1.1), solid('#f2c230'), 0, .65, -.1); mk(taxi, new THREE.BoxGeometry(.5, .14, .3), solid('#fff', '#ddd'), 0, .95, -.1)
  mk(taxi, new THREE.BoxGeometry(.9, .22, .05), solid('#222'), 0, .68, .46); mk(taxi, new THREE.BoxGeometry(.9, .1, .05), solid('#ffffcc', '#ffee99'), 0, .22, 1.12)
  // steam, rain
  const steam = points(small ? 12 : 20, (i, a) => { a[i * 3] = 1.8 + rnd(-.2, .2); a[i * 3 + 1] = rnd(0, 3); a[i * 3 + 2] = -2 + rnd(-.2, .2) }, '#aab0c0', 7, .35, true); scene.add(steam.pts)
  const rain = points(small ? 70 : 130, (i, a) => { a[i * 3] = rnd(-8, 8); a[i * 3 + 1] = rnd(0, 12); a[i * 3 + 2] = rnd(-16, 5) }, '#8fa0c8', 1.5, .6, true); scene.add(rain.pts)
  const pick: THREE.Object3D[] = [taxi, sA, sB, ...lamps]
  let honk = 0
  return {
    bg, fogBase, fog, pick,
    onPick: o => { let p: THREE.Object3D | null = o; while (p && p !== taxi && p.parent) p = p.parent; if (p === taxi) honk = 1 },
    tick: (t, now, s) => {
      honk *= .9
      taxi.position.z -= (.07 + s.pulse * .05 + honk * .05); if (taxi.position.z < -26) taxi.position.z = 6
      taxi.position.y = .3 + Math.abs(Math.sin(now * .05)) * honk * .12
      const on = Math.sin(t * 7) > -.6 || s.flash > .3
      neonA.emissive.set(on ? '#ff2e63' : '#3a0f1a'); neonB.emissive.set(Math.sin(t * 5 + 1) > -.8 ? '#37e1ff' : '#0d3a44')
      warm.intensity = 1.1 + Math.sin(t * 9) * .12 + s.flash * 1.2 + s.hop * .8
      lamps.forEach((l, i) => l.scale.setScalar(1 + (Math.sin(t * 2 + i) > .95 ? -.3 : 0)))
      const sa = steam.attr
      for (let i = 0; i < sa.count; i++) { let y = sa.getY(i) + .02 + (i % 4) * .004; if (y > 3.4) y = 0; sa.setXYZ(i, 1.8 + Math.sin(t + i) * (.1 + y * .12), y, -2 + Math.cos(t * .7 + i) * .1) }
      sa.needsUpdate = true
      const ra = rain.attr
      for (let i = 0; i < ra.count; i++) { let y = ra.getY(i) - (.28 + s.pulse * .05) * (.7 + (i % 4) * .15); if (y < 0) y = 12; ra.setXYZ(i, ra.getX(i), y, ra.getZ(i)) }
      ra.needsUpdate = true
    }
  }
}

// =============== HORROR: graveyard under a blood moon ===============
function horror({ scene, small }: Ctx, _d: { dispose(): void }[]): Built {
  const bg = new THREE.Color('#050308'), fogBase = new THREE.Color('#0d0709'), fog = new THREE.Fog('#0d0709', 3, 22)
  const amb = new THREE.AmbientLight('#4a3a5a', .55); scene.add(amb)
  const dl = new THREE.DirectionalLight('#b02a2a', .8); dl.position.set(-6, 9, -4); scene.add(dl)
  const win = new THREE.PointLight('#ffb347', 0, 9); win.position.set(1.5, 2, -8); scene.add(win)
  scene.add(hills(44, .3, noiseTex('#1a1d18', '#2a3026', .3), undefined))
  const bark = solid('#1b1410'), stone = lam({ map: noiseTex('#4a4c50', '#33353a', .35) }), stone2 = lam({ map: noiseTex('#3d3f43', '#2a2c30', .35) })
  // dead trees: tapered trunk + angled bare branches
  const trees: THREE.Group[] = []
  ;([[-7, -4, 1.3], [7.5, -5, 1.5], [-4.5, -9, 1.2], [4.5, -9.5, 1.1], [-11, -8, 1.6], [11, -9, 1.4], [-1.5, -14, 1.5], [-9.5, -1, 1.0]] as const).forEach(([x, z, s]) => {
    const g = new THREE.Group(); g.position.set(x, 0, z)
    mk(g, new THREE.CylinderGeometry(.1 * s, .3 * s, 3.4 * s, 5), bark, 0, 1.7 * s, 0)
    ;([[.9, 2.3, 1.1], [-.9, 2.8, -1.0], [.7, 3.1, .6]] as const).forEach(([rz, y, ry], i) => { const b = mk(g, new THREE.CylinderGeometry(.03 * s, .09 * s, 1.5 * s, 4), bark, (i % 2 ? -.5 : .5) * s, y * s, 0); b.rotation.z = (i % 2 ? 1 : -1) * rz; b.rotation.y = ry })
    scene.add(g); trees.push(g)
  })
  // tombstones + crosses
  const tombs: THREE.Mesh[] = []
  for (let i = 0; i < 11; i++) {
    const g = new THREE.Group(); g.position.set(rnd(-7, 7), 0, rnd(-8, 3)); g.rotation.y = rnd(-.4, .4); g.rotation.z = rnd(-.15, .15)
    const w = rnd(.5, .8), h = rnd(.8, 1.4)
    mk(g, new THREE.BoxGeometry(w, h, .22), i % 2 ? stone : stone2, 0, h / 2, 0)
    const top = mk(g, new THREE.CylinderGeometry(w / 2, w / 2, .22, 6), i % 2 ? stone : stone2, 0, h, 0); top.rotation.x = Math.PI / 2
    scene.add(g); tombs.push(top)
  }
  ;([[-2.6, -3], [3, -2], [0, -6]] as const).forEach(([x, z]) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.z = rnd(-.2, .2); mk(g, new THREE.BoxGeometry(.18, 1.6, .18), stone, 0, .8, 0); mk(g, new THREE.BoxGeometry(.9, .18, .18), stone, 0, 1.2, 0); scene.add(g) })
  // haunted house with one flickering window
  const house = new THREE.Group(); house.position.set(1.5, 0, -12); scene.add(house)
  const hm = solid('#120d12')
  mk(house, new THREE.BoxGeometry(3.4, 2.6, 2.2), hm, 0, 1.3, 0); mk(house, new THREE.ConeGeometry(2.6, 1.8, 4), hm, 0, 3.5, 0).rotation.y = Math.PI / 4
  mk(house, new THREE.BoxGeometry(.7, 3.6, .7), hm, 1.6, 2.6, 0); mk(house, new THREE.ConeGeometry(.6, .9, 4), hm, 1.6, 4.8, 0)
  const winM = solid('#ffb347', '#ff8a1f'); mk(house, new THREE.BoxGeometry(.45, .6, .1), winM, -.5, 1.6, 1.12); mk(house, new THREE.BoxGeometry(.45, .6, .1), solid('#2a1a10'), .7, 1.6, 1.12)
  // blood moon
  const moonM = solid('#c01818', '#6a0808')
  const moon = mk(scene, new THREE.IcosahedronGeometry(2.1, 0), moonM, -8, 8, -22)
  // fog wisps, eyes in the dark, falling ash
  const wisps = points(small ? 10 : 18, (i, a) => { a[i * 3] = rnd(-12, 12); a[i * 3 + 1] = rnd(.3, 1.4); a[i * 3 + 2] = rnd(-10, 3) }, '#6a6070', 14, .12, true); scene.add(wisps.pts)
  const eyes = points(6, (i, a) => { const k = i >> 1; const ex = [-5.5, 5.8, -2.2][k]; a[i * 3] = ex + (i % 2 ? .28 : 0); a[i * 3 + 1] = [1.1, 1.4, .9][k]; a[i * 3 + 2] = [-5, -7, -9][k] }, '#ff2a2a', 4, 1, false); scene.add(eyes.pts)
  const ash = points(small ? 40 : 70, (i, a) => { a[i * 3] = rnd(-12, 12); a[i * 3 + 1] = rnd(0, 12); a[i * 3 + 2] = rnd(-12, 4) }, '#8a8a8a', 2, .7, true); scene.add(ash.pts)
  const eyeMat = eyes.pts.material as THREE.PointsMaterial
  let lightning = 0, eyeT = 0
  const pick: THREE.Object3D[] = [moon, house, ...tombs]
  return {
    bg, fogBase, fog, pick,
    onPick: o => { if (o === moon) { lightning = 1; moon.scale.setScalar(1.5) } else lightning = .7 },
    tick: (t, now, s) => {
      lightning *= .86
      if (Math.random() < .0015) lightning = 1                       // random lightning
      trees.forEach((tr, i) => { tr.rotation.z = Math.sin(t * .7 + i) * .02 + Math.sin(now * .03 + i) * s.flash * .04 })
      moon.rotation.y = t * .04; moon.scale.setScalar(moon.scale.x + (1 - moon.scale.x) * .05 + Math.sin(t) * .001)
      moonM.emissive.setScalar(0); moonM.emissive.set(s.alert > 0 ? '#ff2a2a' : '#6a0808').multiplyScalar(.8 + Math.sin(t * 1.5) * .2)
      const flick = Math.sin(t * 13) * Math.sin(t * 5.3) > .55
      win.intensity = flick ? .2 : 1.2; winM.emissive.set(flick ? '#331a05' : '#ff8a1f')
      amb.intensity = .55 + lightning * 2.4 + s.flash * .3
      eyeT += .016; eyeMat.opacity = (Math.sin(eyeT * 2.3) > .88 || Math.sin(eyeT * .7 + 2) > .96) ? 0 : 1
      const wa = wisps.attr; for (let i = 0; i < wa.count; i++) { let x = wa.getX(i) + .004 + (i % 3) * .001; if (x > 13) x = -13; wa.setXYZ(i, x, wa.getY(i) + Math.sin(t + i) * .001, wa.getZ(i)) }
      wa.needsUpdate = true
      const aa = ash.attr; for (let i = 0; i < aa.count; i++) { let y = aa.getY(i) - (.01 + Math.max(0, s.pulse) * .015) * (.6 + (i % 5) * .2); if (y < 0) y = 12; aa.setXYZ(i, aa.getX(i) + Math.sin(t * .5 + i) * .004, y, aa.getZ(i)) }
      aa.needsUpdate = true
      bg.set(lightning > .25 ? '#2a1a2e' : '#050308')
    }
  }
}
