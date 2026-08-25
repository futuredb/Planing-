import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Item } from '../types'

type Node = { id: string; title: string; x: number; y: number }

const MIN = 190

function wrapTitle(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['Без названия']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > 18 && line) {
      lines.push(line)
      line = word
      if (lines.length === 2) break
    } else {
      line = next
    }
  }
  if (lines.length < 2 && line) lines.push(line)
  if (lines.length === 2 && lines[1].length > 20) lines[1] = `${lines[1].slice(0, 18)}…`
  return lines.slice(0, 2)
}

function layout(items: Item[]): { nodes: Node[]; edges: { a: string; b: string }[] } {
  const ids = new Set(items.map((it) => it.id))
  const kids = new Map<string, Item[]>()
  const roots: Item[] = []
  for (const it of items) {
    if (it.parentId && ids.has(it.parentId)) {
      const list = kids.get(it.parentId) ?? []
      list.push(it)
      kids.set(it.parentId, list)
    } else {
      roots.push(it)
    }
  }

  const nodes: Node[] = []
  const cols = Math.max(1, Math.ceil(Math.sqrt(roots.length)))
  roots.forEach((root, ri) => {
    const gx = (ri % cols) * 420 + 220
    const gy = Math.floor(ri / cols) * 360 + 140
    const walk = (item: Item, x: number, y: number) => {
      nodes.push({ id: item.id, title: item.title, x, y })
      const children = kids.get(item.id) ?? []
      children.forEach((child, i) => {
        const ang = (i - (children.length - 1) / 2) * 0.85
        walk(child, x + Math.sin(ang) * 210, y + 160)
      })
    }
    walk(root, gx, gy)
  })

  const index = new Map(nodes.map((n) => [n.id, n]))
  const edges: { a: string; b: string }[] = []
  const seen = new Set<string>()
  const addEdge = (a: string, b: string) => {
    if (a === b || !index.has(a) || !index.has(b)) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ a, b })
  }
  for (const it of items) {
    if (it.parentId) addEdge(it.parentId, it.id)
    for (const rid of it.relatedIds ?? []) addEdge(it.id, rid)
  }

  for (let step = 0; step < 80; step++) {
    const cool = 1 - step / 80
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 1
        dx /= dist
        dy /= dist
        if (dist < MIN) {
          const push = ((MIN - dist) / 2) * (0.55 + cool)
          a.x -= dx * push
          a.y -= dy * push
          b.x += dx * push
          b.y += dy * push
        } else {
          const force = (900 * cool) / (dist * dist)
          a.x -= dx * force
          a.y -= dy * force
          b.x += dx * force
          b.y += dy * force
        }
      }
    }
    for (const e of edges) {
      const a = index.get(e.a)
      const b = index.get(e.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      if (dist < MIN + 20) continue
      const pull = (dist - (MIN + 40)) * 0.012
      a.x += (dx / dist) * pull
      a.y += (dy / dist) * pull
      b.x -= (dx / dist) * pull
      b.y -= (dy / dist) * pull
    }
  }

  return { nodes, edges }
}

export function Graph({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useStore()
  const { nodes, edges } = useMemo(() => layout(state.items), [state.items])
  const at = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const stage = useRef<HTMLDivElement>(null)
  const cam = useRef({ x: 0, y: 0, k: 1 })
  const [, render] = useState(0)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const pinch = useRef<{ dist: number; k: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  function apply(next: { x: number; y: number; k: number }) {
    cam.current = next
    render((n) => n + 1)
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const el = stage.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const { x, y, k } = cam.current
    const wx = (mx - x) / k
    const wy = (my - y) / k
    const nextK = Math.min(4, Math.max(0.2, k * factor))
    apply({ k: nextK, x: mx - wx * nextK, y: my - wy * nextK })
  }

  function fit() {
    const el = stage.current
    if (!el || !nodes.length) return
    const pad = 80
    const minX = Math.min(...nodes.map((n) => n.x)) - pad
    const maxX = Math.max(...nodes.map((n) => n.x)) + pad
    const minY = Math.min(...nodes.map((n) => n.y)) - pad
    const maxY = Math.max(...nodes.map((n) => n.y)) + pad
    const w = Math.max(400, maxX - minX)
    const h = Math.max(300, maxY - minY)
    const k = Math.min(el.clientWidth / w, el.clientHeight / h, 1.4) * 0.92
    apply({
      k,
      x: (el.clientWidth - w * k) / 2 - minX * k,
      y: (el.clientHeight - h * k) / 2 - minY * k,
    })
  }

  useEffect(() => {
    fit()
  }, [nodes])

  useEffect(() => {
    const el = stage.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0018)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return
      e.preventDefault()
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      )
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const rect = el.getBoundingClientRect()
      const mx = midX - rect.left
      const my = midY - rect.top
      const nextK = Math.min(4, Math.max(0.2, pinch.current.k * (dist / pinch.current.dist)))
      apply({
        k: nextK,
        x: mx - pinch.current.x * nextK,
        y: my - pinch.current.y * nextK,
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  return (
    <section className="graph-page">
      <div
        ref={stage}
        className="graph-canvas"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.graph-hit')) return
          drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          apply({
            ...cam.current,
            x: drag.current.cx + (e.clientX - drag.current.x),
            y: drag.current.cy + (e.clientY - drag.current.y),
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onTouchStart={(e) => {
          if (e.touches.length !== 2 || !stage.current) return
          drag.current = null
          const dist = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY,
          )
          const rect = stage.current.getBoundingClientRect()
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
          pinch.current = {
            dist,
            k: cam.current.k,
            x: (mx - cam.current.x) / cam.current.k,
            y: (my - cam.current.y) / cam.current.k,
          }
        }}
        onTouchEnd={() => {
          pinch.current = null
        }}
      >
        <svg className="graph-svg">
          <g transform={`translate(${cam.current.x} ${cam.current.y}) scale(${cam.current.k})`}>
            {edges.map((e) => {
              const a = at.get(e.a)
              const b = at.get(e.b)
              if (!a || !b) return null
              return (
                <line
                  key={`${e.a}-${e.b}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#d5d8de"
                  strokeWidth="1.2"
                />
              )
            })}
            {nodes.map((n) => {
              const lines = wrapTitle(n.title)
              return (
                <g key={n.id} className="graph-hit" transform={`translate(${n.x} ${n.y})`}>
                  <circle
                    r={focus === n.id ? 11 : 9}
                    fill="#b5b9c0"
                    stroke={focus === n.id ? '#4c8bf5' : 'none'}
                    strokeWidth="2"
                    onClick={() => {
                      setFocus(n.id)
                      onOpen(n.id)
                    }}
                  />
                  <text y="28" textAnchor="middle">
                    {lines.map((line, i) => (
                      <tspan key={i} x="0" dy={i === 0 ? 0 : 16}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </section>
  )
}
