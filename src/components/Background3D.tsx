import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { onWorld, emitWorld } from '../lib/bus'
import { play } from '../lib/sfx'

// CHRISTMAS EDITION. ~300-triangle low-poly winter night: rolling snow, pine trees, gifts, a snowman, a star on the big tree,
// a moon, blinking fairy lights and falling snow. Renders at 480x270 (320x180 on small screens), CSS-upscaled with no smoothing.
// Flat shading, 64px procedural dithered textures (NearestFilter), vertices snapped to a grid in the shader,
// Bayer-dithered output colour. Reacts to mouse, scroll, navigation, rooms, sends, alerts and easter eggs.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
type Kind = 'noise' | 'pine' | 'gift'

function tex(base: string, accent: string, kind: Kind, ribbon = '#ffd21f'): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = base; g.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = BAYER[(y & 3) * 4 + (x & 3)] / 16
    if (kind === 'gift') {
      const onRibbon = (x > 27 && x < 37) || (y > 27 && y < 37)
      if (onRibbon) { g.fillStyle = ribbon; g.fillRect(x, y, 1, 1) }
      else if ((Math.sin(x * .5) * Math.cos(y * .5) + 1) / 5 > t) { g.fillStyle = accent; g.fillRect(x, y, 1, 1) }
      continue
    }
    const v = kind === 'pine' ? (1 - y / 64) * .85 : (Math.sin(x * .6) * Math.cos(y * .5) + 1) / 3
    if (v > t) { g.fillStyle = accent; g.fillRect(x, y, 1, 1) }
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

const BULBS = ['#ff3b3b', '#ffd21f', '#3ddc7a', '#5ee7ff']

export default function Background3D() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const small = window.matchMedia('(max-width: 768px)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const W = small ? 320 : 480, H = small ? 180 : 270
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' }) }
    catch { canvas.style.background = 'linear-gradient(#0a1430,#1a3a6e)'; return }   // no WebGL => static fallback, app still works
    renderer.setPixelRatio(1); renderer.setSize(W, H, false)

    const SKY = '#0a1430'
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog('#0c1a3e', 8, 30)
    const cam = new THREE.PerspectiveCamera(55, W / H, .1, 70); cam.position.set(0, 3.2, 9)
    scene.add(new THREE.AmbientLight('#7fa6ff', .95))
    const moonLight = new THREE.DirectionalLight('#dbe8ff', 1.25); moonLight.position.set(-6, 9, 4); scene.add(moonLight)
    const warm = new THREE.PointLight('#ffb347', 0, 14); warm.position.set(2.5, 2, 1.5); scene.add(warm)   // glows when gifts are poked

    const mats = {
      snow: retro(new THREE.MeshLambertMaterial({ map: tex('#dcebff', '#9dbbe8', 'noise'), flatShading: true })),
      pine: retro(new THREE.MeshLambertMaterial({ map: tex('#1d6b45', '#eef6ff', 'pine'), flatShading: true })),
      pine2: retro(new THREE.MeshLambertMaterial({ map: tex('#176040', '#eef6ff', 'pine'), flatShading: true })),
      giftR: retro(new THREE.MeshLambertMaterial({ map: tex('#d62839', '#8f1d2c', 'gift', '#ffd21f'), flatShading: true })),
      giftG: retro(new THREE.MeshLambertMaterial({ map: tex('#1f9d55', '#136b3a', 'gift', '#ff4d4d'), flatShading: true })),
      giftB: retro(new THREE.MeshLambertMaterial({ map: tex('#3a6fe0', '#254aa8', 'gift', '#ffffff'), flatShading: true })),
      body: retro(new THREE.MeshLambertMaterial({ map: tex('#f4f9ff', '#bcd4f2', 'noise'), flatShading: true })),
      scarf: retro(new THREE.MeshLambertMaterial({ color: '#d62839', flatShading: true })),
      carrot: retro(new THREE.MeshLambertMaterial({ color: '#ff8a1f', flatShading: true })),
      star: retro(new THREE.MeshLambertMaterial({ color: '#ffd21f', emissive: new THREE.Color('#aa7700'), flatShading: true })),
      moon: retro(new THREE.MeshLambertMaterial({ map: tex('#fff6cf', '#ffe48a', 'noise'), flatShading: true, emissive: new THREE.Color('#665a22') }))
    }
    const snapG = <T extends THREE.BufferGeometry>(g: T, n = 4) => { // snap vertices to a grid
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) p.setXYZ(i, Math.round(p.getX(i) * n) / n, Math.round(p.getY(i) * n) / n, Math.round(p.getZ(i) * n) / n)
      g.computeVertexNormals(); return g
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
      const o = new THREE.Mesh(snapG(g), m); o.position.set(x, y, z); parent.add(o); return o
    }

    // Triangle budget (~300): ground 72, 9 trees x15 = 135, 3 gifts x12 = 36, snowman ~44, moon 20, star 8 => ~315
    const gg = new THREE.PlaneGeometry(44, 44, 6, 6).rotateX(-Math.PI / 2)
    { const p = gg.attributes.position as THREE.BufferAttribute   // rolling snow drifts
      for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * .5) * .32 + Math.cos(p.getZ(i) * .45) * .28) }
    const ground = add(gg, mats.snow, 0, 0, 0)
    ;(mats.snow.map as THREE.Texture).repeat.set(6, 6)

    const trees: THREE.Group[] = []
    const mkTree = (x: number, z: number, s: number, m: THREE.Material) => {
      const t = new THREE.Group(); t.position.set(x, 0, z)
      add(new THREE.ConeGeometry(1.25 * s, 1.7 * s, 5, 1, true), m, 0, .85 * s, 0, t)
      add(new THREE.ConeGeometry(.95 * s, 1.5 * s, 5, 1, true), m, 0, 1.95 * s, 0, t)
      add(new THREE.ConeGeometry(.65 * s, 1.3 * s, 5, 1, true), m, 0, 2.95 * s, 0, t)
      t.userData.s = s; scene.add(t); trees.push(t); return t
    }
    mkTree(-7, -4, 1.3, mats.pine); mkTree(7.5, -5, 1.5, mats.pine2); mkTree(-4.5, -9, 1.2, mats.pine2); mkTree(4, -8, 1.0, mats.pine)
    mkTree(-11, -9, 1.6, mats.pine); mkTree(11, -10, 1.4, mats.pine2); mkTree(-1.5, -14, 1.5, mats.pine2); mkTree(-9, -1, 1.0, mats.pine2)
    const big = mkTree(0.5, -11, 2.3, mats.pine)
    const star = add(new THREE.OctahedronGeometry(.45), mats.star, 0, 2.95 * 2.3 + 1.3, 0, big)

    const gifts = [
      add(new THREE.BoxGeometry(1.1, .9, 1.1), mats.giftR, 2.4, .5, -1.2),
      add(new THREE.BoxGeometry(.8, .7, .8), mats.giftG, 3.7, .38, -.5),
      add(new THREE.BoxGeometry(.9, 1.2, .9), mats.giftB, 3.1, .6, -2.3)
    ]
    gifts.forEach((g, i) => { g.userData.y = g.position.y; g.rotation.y = .3 * (i - 1) })

    const sn = new THREE.Group(); sn.position.set(-3.4, 0, .2); scene.add(sn)
    const sBody = add(new THREE.IcosahedronGeometry(.9, 0), mats.body, 0, .9, 0, sn)
    const sHead = add(new THREE.IcosahedronGeometry(.6, 0), mats.body, 0, 2.05, 0, sn)
    add(new THREE.BoxGeometry(1.0, .18, 1.0), mats.scarf, 0, 1.55, 0, sn)
    const nose = add(new THREE.ConeGeometry(.12, .55, 4, 1, true), mats.carrot, 0, 2.05, .75, sn); nose.rotation.x = Math.PI / 2
    const moon = add(new THREE.IcosahedronGeometry(1.8, 0), mats.moon, -9, 9, -22)

    // falling snow (points are not triangles)
    const N = small ? 70 : 120
    const sp = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { sp[i * 3] = (Math.random() - .5) * 28; sp[i * 3 + 1] = Math.random() * 12; sp[i * 3 + 2] = (Math.random() - .5) * 24 - 2 }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    const snowPts = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false }))
    scene.add(snowPts)

    // blinking fairy lights draped across the back
    const LN = 20, lp = new Float32Array(LN * 3), lc = new Float32Array(LN * 3)
    for (let i = 0; i < LN; i++) { const u = i / (LN - 1); lp[i * 3] = -13 + u * 26; lp[i * 3 + 1] = 7.2 - Math.sin(u * Math.PI) * 1.4; lp[i * 3 + 2] = -7 }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3))
    const lights = new THREE.Points(lg, new THREE.PointsMaterial({ vertexColors: true, size: 3, sizeAttenuation: false, fog: false }))
    scene.add(lights)
    const tmpC = new THREE.Color()
    const paintLights = (phase: number, flash: number) => {
      for (let i = 0; i < LN; i++) {
        tmpC.set(BULBS[(i + phase) % 4]); const on = (i + phase) % 2 === 0 || flash > .2 ? 1 : .35
        lc[i * 3] = tmpC.r * on; lc[i * 3 + 1] = tmpC.g * on; lc[i * 3 + 2] = tmpC.b * on
      }
      lg.attributes.color.needsUpdate = true
    }
    paintLights(0, 0)

    // state driven by events
    let tx = 0, ty = 0, scroll = 0, pulse = 0, zoom = 0, party = 0, shake = 0, flash = 0, hue = 0, redAlert = 0, hop = 0, glow = 0
    const onMove = (e: PointerEvent) => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5 }
    const onScroll = (e: Event) => { const t = e.target as HTMLElement; scroll = Math.min(1, (t.scrollTop ?? 0) / 800) }
    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('scroll', onScroll, { capture: true, passive: true })

    const off = onWorld(e => {
      if (e === 'nav') shake = 1
      if (e === 'open') zoom = 1
      if (e === 'close') zoom = -.6
      if (e === 'send') { hop = 1; pulse = .5 }
      if (e === 'receive') { flash = 1; pulse = .3 }
      if (e === 'alert') { redAlert = 2; pulse = 2; party = 2 }
      if (e === 'secret') party = 6
      if (e === 'error') pulse = -.5
    })

    // Easter eggs: poke the gifts (7 pokes = party), tickle the snowman (5 = party), moon, Konami, typed cheat words
    const ray = new THREE.Raycaster(), v2 = new THREE.Vector2()
    let giftHits = 0, snowHits = 0, headSpin = 0
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('button,a,input,textarea,select,[role=dialog],.panel,.logo')) return
      const r = canvas.getBoundingClientRect()
      v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(v2, cam)
      if (ray.intersectObjects(gifts).length) { giftHits++; hop = 1.4; glow = 1; play('notify'); if (giftHits >= 7) { giftHits = 0; play('secret'); party = 6; emitWorld('secret') } }
      else if (ray.intersectObjects([sBody, sHead]).length) { snowHits++; headSpin = 1; play('open'); if (snowHits >= 5) { snowHits = 0; play('secret'); party = 5 } }
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
        if (typed.endsWith('iddqd')) { play('secret'); mats.star.emissive.set('#ffcc33'); glow = 3; typed = '' }
        if (typed.endsWith('hohoho')) { play('secret'); redAlert = 3; party = 3; typed = '' }
      }
    }
    addEventListener('keydown', onKey)

    let raf = 0, last = 0, running = true, bulbPhase = 0, bulbT = 0
    const clock = new THREE.Clock()
    const fpsGap = small ? 1000 / 30 : 1000 / 45
    const col = new THREE.Color(), skyBase = new THREE.Color(SKY), fogBase = new THREE.Color('#0c1a3e'), red = new THREE.Color('#5a0f1a')
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!running || now - last < fpsGap) return
      last = now
      const t = clock.getElapsedTime() * (reduce ? 0 : 1)
      const dt = .05
      pulse *= .92; zoom *= .93; shake *= .9; flash *= .9; hop *= .9; glow *= .95; headSpin *= .93
      party = Math.max(0, party - .03); redAlert = Math.max(0, redAlert - .03)
      cam.position.x += ((tx * 2.2) - cam.position.x) * dt * 2
      cam.position.y += ((3.2 - ty * 1.2 - scroll * 1.2 - zoom * .6) - cam.position.y) * dt * 2
      cam.position.z += ((9 - scroll * 3 - zoom * 1.6 - pulse * .3) - cam.position.z) * dt * 2
      cam.rotation.z = shake * .04 * Math.sin(now * .02)
      cam.lookAt(tx * 1.5, 2 - scroll, -6)
      trees.forEach((tr, i) => { tr.rotation.z = Math.sin(t * .8 + i) * .012 + shake * .05 * Math.sin(now * .03 + i); tr.rotation.x = Math.cos(t * .6 + i) * .008 })
      gifts.forEach((g, i) => { g.position.y = g.userData.y + Math.max(0, Math.sin(now * .02 + i * 2)) * hop * .5 })
      warm.intensity = glow * 1.8
      star.rotation.y = t * 1.4; star.scale.setScalar(1 + Math.sin(t * 3) * .12 + glow * .3)
      sHead.rotation.y = headSpin * 8 + Math.sin(t) * .2
      moon.rotation.y = t * .05; moon.scale.setScalar(moon.scale.x + (1 - moon.scale.x) * .05)
      // snow
      const fall = (.022 + Math.max(0, pulse) * .02 + party * .004) * (reduce ? 0 : 1)
      const pa = sg.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < N; i++) {
        let y = pa.getY(i) - fall * (.6 + (i % 5) * .2); if (y < 0) y = 12
        pa.setXYZ(i, pa.getX(i) + Math.sin(t + i) * .004, y, pa.getZ(i))
      }
      pa.needsUpdate = true
      // lights
      bulbT += 1; if (bulbT > (party > 0 ? 4 : 18)) { bulbT = 0; bulbPhase = (bulbPhase + 1) % 4; paintLights(bulbPhase, flash) }
      // sky: party = rainbow, alert = red
      if (party > 0) { hue = (hue + .02) % 1; col.setHSL(hue, .6, .2) } else col.copy(skyBase)
      if (redAlert > 0) col.lerp(red, Math.min(1, redAlert))
      scene.background = col; (scene.fog as THREE.Fog).color.copy(party > 0 || redAlert > 0 ? col : fogBase)
      ground.position.z = 0
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
      sg.dispose(); lg.dispose(); (snowPts.material as THREE.Material).dispose(); (lights.material as THREE.Material).dispose()
      Object.values(mats).forEach(m => { m.map?.dispose(); m.dispose() })
      renderer.dispose()
    }
  }, [])

  return <canvas id="bg3d" ref={ref} aria-hidden="true" />
}
