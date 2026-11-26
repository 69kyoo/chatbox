import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { onWorld, emitWorld } from '../lib/bus'
import { play } from '../lib/sfx'

// ~300-triangle low-poly arcade world. Renders at 480x270 (320x180 on small screens), CSS-upscaled with no smoothing.
// Flat shading, 64px procedural dithered textures (NearestFilter), vertices snapped to a grid in the shader,
// ordered (Bayer) dithering on output colour. Reacts to mouse, scroll, navigation, rooms, sends, alerts and easter eggs.

const PALETTE = ['#0b0620', '#2a1a6e', '#5b3fd6', '#ffd21f', '#ff7ab8', '#5ee7ff', '#3ddc97', '#8a4b00']
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function tex(base: string, accent: string, kind: 'grid' | 'brick' | 'noise' | 'stripe'): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = base; g.fillRect(0, 0, 64, 64); g.fillStyle = accent
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = BAYER[(y & 3) * 4 + (x & 3)] / 16
    let v = 0
    if (kind === 'grid') v = (x % 16 === 0 || y % 16 === 0) ? .9 : .12 * ((x + y) & 1)
    else if (kind === 'brick') v = (y % 16 === 0 || (x + ((y >> 4) & 1) * 16) % 32 === 0) ? .8 : .18
    else if (kind === 'stripe') v = (((x + y) >> 3) & 1) ? .65 : .1
    else v = (Math.sin(x * .6) * Math.cos(y * .5) + 1) / 4
    if (v > t) g.fillRect(x, y, 1, 1)
  }
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
  return t
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

export default function Background3D() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const small = window.matchMedia('(max-width: 768px)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const W = small ? 320 : 480, H = small ? 180 : 270
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' }) }
    catch { canvas.style.background = 'linear-gradient(#0b0620,#2a1a6e)'; return }   // no WebGL => static fallback, app still works
    renderer.setPixelRatio(1); renderer.setSize(W, H, false)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#150a3a'); scene.fog = new THREE.Fog('#150a3a', 9, 26)
    const cam = new THREE.PerspectiveCamera(55, W / H, .1, 60); cam.position.set(0, 3.2, 9)
    scene.add(new THREE.AmbientLight('#8a7cff', .9))
    const sun = new THREE.DirectionalLight('#fff1b0', 1.4); sun.position.set(4, 8, 5); scene.add(sun)

    const mats = {
      floor: retro(new THREE.MeshLambertMaterial({ map: tex('#2a1a6e', '#5ee7ff', 'grid'), flatShading: true })),
      brick: retro(new THREE.MeshLambertMaterial({ map: tex('#5b3fd6', '#2a1a6e', 'brick'), flatShading: true })),
      gold: retro(new THREE.MeshLambertMaterial({ map: tex('#ffd21f', '#8a4b00', 'stripe'), flatShading: true })),
      pink: retro(new THREE.MeshLambertMaterial({ map: tex('#ff7ab8', '#5b3fd6', 'noise'), flatShading: true })),
      green: retro(new THREE.MeshLambertMaterial({ map: tex('#3ddc97', '#0b0620', 'stripe'), flatShading: true })),
      moon: retro(new THREE.MeshLambertMaterial({ map: tex('#fff3a6', '#ffd21f', 'noise'), flatShading: true, emissive: new THREE.Color('#554400') }))
    }
    const snapG = <T extends THREE.BufferGeometry>(g: T, n = 4) => { // snap vertices to a grid
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) p.setXYZ(i, Math.round(p.getX(i) * n) / n, Math.round(p.getY(i) * n) / n, Math.round(p.getZ(i) * n) / n)
      g.computeVertexNormals(); return g
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(snapG(g), m); o.position.set(x, y, z); scene.add(o); return o
    }

    // Triangle budget (~300): floor 8x8 = 128, 5 pillars 60, 4 pyramids 24, 3 coins 24, moon 20, cabinet 24 + 2 cubes = ~304
    const floor = add(new THREE.PlaneGeometry(40, 40, 8, 8).rotateX(-Math.PI / 2), mats.floor, 0, 0, 0)
    ;(mats.floor.map as THREE.Texture).repeat.set(8, 8)
    const pillars: THREE.Mesh[] = [[-7, 1.5, -4], [7, 2.2, -6], [-4, .9, -9], [4, 1.2, -3], [0, 2.6, -13]].map(([x, h, z], i) =>
      add(new THREE.BoxGeometry(1.4, h * 2, 1.4), i % 2 ? mats.brick : mats.pink, x, h, z))
    const pyr = [[-10, -8], [10, -9], [-12, -14], [12, -15]].map(([x, z]) => add(new THREE.ConeGeometry(2.2, 3.6, 4), mats.green, x, 1.8, z))
    const coins = [[-2.5, 1.6, 2], [3, 2.2, -1], [0, 3.4, -6]].map(([x, y, z]) => {
      const c = add(new THREE.OctahedronGeometry(.55), mats.gold, x, y, z); c.userData.base = y; return c
    })
    const moon = add(new THREE.IcosahedronGeometry(1.8, 0), mats.moon, -9, 9, -22)
    const cab = add(new THREE.BoxGeometry(1.6, 2.4, 1.2), mats.brick, 2.2, 1.2, -1.5)
    const cabScreen = add(new THREE.BoxGeometry(1, .8, .1), mats.gold, 2.2, 1.8, -.88)
    cab.rotation.y = -.35; cabScreen.rotation.y = -.35; cabScreen.position.set(2.2 - .25, 1.8, -.95)

    // state driven by events
    let tx = 0, ty = 0, scroll = 0, pulse = 0, zoom = 0, party = 0, tilt = 0, hue = 0
    const onMove = (e: PointerEvent) => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5 }
    const onScroll = (e: Event) => { const t = e.target as HTMLElement; scroll = Math.min(1, (t.scrollTop ?? 0) / 800) }
    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('scroll', onScroll, { capture: true, passive: true })

    const off = onWorld(e => {
      if (e === 'nav') tilt = 1
      if (e === 'open') zoom = 1
      if (e === 'close') zoom = -.6
      if (e === 'send') pulse = .6
      if (e === 'receive') pulse = .3
      if (e === 'alert') { pulse = 2; party = 2 }
      if (e === 'secret') party = 6
      if (e === 'error') pulse = -.5
    })

    // Easter eggs: clicking a coin in the world, Konami code, typed cheat words
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2()
    let coinHits = 0
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('button,a,input,textarea,select,[role=dialog],.panel,.logo')) return
      const r = canvas.getBoundingClientRect()
      v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(v2, cam)
      if (ray.intersectObjects(coins).length) { coinHits++; play('notify'); pulse = 1; if (coinHits >= 5) { coinHits = 0; play('secret'); party = 5; emitWorld('secret') } }
      else if (ray.intersectObject(cabScreen).length) { play('open'); party = 3 }
      else if (ray.intersectObject(moon).length) { play('secret'); moon.scale.setScalar(1.6) }
    }
    addEventListener('click', onClick)
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
    let kpos = 0, typed = ''
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      kpos = k === KONAMI[kpos] ? kpos + 1 : (k === KONAMI[0] ? 1 : 0)
      if (kpos === KONAMI.length) { kpos = 0; play('secret'); party = 8; emitWorld('secret') }
      const t = e.target as HTMLElement
      if (!/INPUT|TEXTAREA|SELECT/.test(t.tagName) && e.key.length === 1) {
        typed = (typed + k).slice(-8)
        if (typed.endsWith('xyzzy')) { play('secret'); party = 4; typed = '' }
        if (typed.endsWith('iddqd')) { play('secret'); mats.gold.emissive.set('#ffaa00'); typed = '' }
      }
    }
    addEventListener('keydown', onKey)

    let raf = 0, last = 0, running = true
    const clock = new THREE.Clock()
    const fpsGap = small ? 1000 / 30 : 1000 / 45
    const col = new THREE.Color()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!running || now - last < fpsGap) return
      last = now
      const t = clock.getElapsedTime() * (reduce ? 0 : 1)
      const dt = .05
      pulse *= .92; zoom *= .93; tilt *= .9; party = Math.max(0, party - .03)
      cam.position.x += ((tx * 2.2) - cam.position.x) * dt * 2
      cam.position.y += ((3.2 - ty * 1.2 - scroll * 1.2 - zoom * .6) - cam.position.y) * dt * 2
      cam.position.z += ((9 - scroll * 3 - zoom * 1.6 - pulse * .3) - cam.position.z) * dt * 2
      cam.rotation.z = tilt * .05 * Math.sin(now * .02)
      cam.lookAt(tx * 1.5, 2 - scroll, -6)
      coins.forEach((c, i) => { c.rotation.y = t * 1.6 + i; c.position.y = c.userData.base + Math.sin(t * 2 + i) * .25 + pulse * .2 + party * Math.sin(t * 12 + i) * .15 })
      pillars.forEach((p, i) => { p.scale.y = 1 + Math.max(0, pulse) * .08 * (i % 2 ? 1 : -1) })
      pyr.forEach((p, i) => { p.rotation.y = t * .1 * (i % 2 ? 1 : -1) })
      moon.rotation.y = t * .05; moon.scale.setScalar(moon.scale.x + (1 - moon.scale.x) * .05)
      cabScreen.visible = reduce || Math.floor(t * 3) % 6 !== 0
      if (party > 0) { hue = (hue + .02) % 1; col.setHSL(hue, .7, .22); scene.background = col; (scene.fog as THREE.Fog).color.copy(col) }
      else { (scene.background as THREE.Color).set('#150a3a'); (scene.fog as THREE.Fog).color.set('#150a3a') }
      floor.position.z = ((t * .4) % 1) * (reduce ? 0 : 1)   // gentle scrolling floor
      renderer.render(scene, cam)
    }
    const vis = () => { running = !document.hidden }
    document.addEventListener('visibilitychange', vis)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf); off()
      removeEventListener('pointermove', onMove); removeEventListener('scroll', onScroll, true)
      removeEventListener('click', onClick); removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', vis)
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
      Object.values(mats).forEach(m => { (m.map as THREE.Texture).dispose(); m.dispose() })
      renderer.dispose()
    }
  }, [])

  return <canvas id="bg3d" ref={ref} aria-hidden="true" />
}
void PALETTE
