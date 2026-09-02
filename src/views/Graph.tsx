import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store-context'
import type { Item } from '../types'
import { Icon } from '../ui/Icon'

type Node = { id: string; title: string; x: number; y: number }
type Camera = { x: number; y: number; k: number }

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

function clusters(items: Item[]): Item[][] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const adjacent = new Map(items.map((item) => [item.id, new Set<string>()]))
  const link = (a: string, b: string) => {
    if (a === b || !adjacent.has(a) || !adjacent.has(b)) return
    adjacent.get(a)!.add(b)
    adjacent.get(b)!.add(a)
  }
  for (const item of items) {
    if (item.parentId) link(item.id, item.parentId)
    for (const relatedId of item.relatedIds ?? []) link(item.id, relatedId)
  }
  const seen = new Set<string>()
  const groups: Item[][] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    const stack = [item.id]
    const group: Item[] = []
    seen.add(item.id)
    while (stack.length) {
      const id = stack.pop()!
      const node = byId.get(id)
      if (node) group.push(node)
      for (const next of adjacent.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    groups.push(group)
  }
  groups.sort((a, b) => b.length - a.length || a[0].title.localeCompare(b[0].title, 'ru'))
  return groups
}

function layout(items: Item[]): { nodes: Node[]; edges: { a: string; b: string }[] } {
  const groups = clusters(items)
  const nodes: Node[] = []
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)))
  groups.forEach((group, groupIndex) => {
    const cx = (groupIndex % columns) * 560 + 280
    const cy = Math.floor(groupIndex / columns) * 460 + 200
    if (group.length === 1) {
      nodes.push({ id: group[0].id, title: group[0].title, x: cx, y: cy })
      return
    }
    const radius = 90 + group.length * 16
    group.forEach((item, index) => {
      const angle = (index / group.length) * Math.PI * 2 - Math.PI / 2
      nodes.push({
        id: item.id,
        title: item.title,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      })
    })
  })

  const index = new Map(nodes.map((node) => [node.id, node]))
  const edges: { a: string; b: string }[] = []
  const seen = new Set<string>()
  const addEdge = (a: string, b: string) => {
    if (a === b || !index.has(a) || !index.has(b)) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ a, b })
  }
  for (const item of items) {
    if (item.parentId) addEdge(item.parentId, item.id)
    for (const relatedId of item.relatedIds ?? []) addEdge(item.id, relatedId)
  }

  for (let step = 0; step < 80; step++) {
    const cool = 1 - step / 80
    for (let aIndex = 0; aIndex < nodes.length; aIndex++) {
      for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex++) {
        const a = nodes[aIndex]
        const b = nodes[bIndex]
        let dx = b.x - a.x
        let dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 1
        dx /= distance
        dy /= distance
        if (distance < MIN) {
          const push = ((MIN - distance) / 2) * (0.55 + cool)
          a.x -= dx * push
          a.y -= dy * push
          b.x += dx * push
          b.y += dy * push
        } else {
          const force = (900 * cool) / (distance * distance)
          a.x -= dx * force
          a.y -= dy * force
          b.x += dx * force
          b.y += dy * force
        }
      }
    }
    for (const edge of edges) {
      const a = index.get(edge.a)
      const b = index.get(edge.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.hypot(dx, dy) || 1
      if (distance < MIN + 20) continue
      const pull = (distance - (MIN + 40)) * 0.012
      a.x += (dx / distance) * pull
      a.y += (dy / distance) * pull
      b.x -= (dx / distance) * pull
      b.y -= (dy / distance) * pull
    }
  }
  return { nodes, edges }
}

export function Graph({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useStore()
  const { nodes, edges } = useMemo(
    () => layout(state.items.filter((item) => item.lane !== 'archive')),
    [state.items],
  )
  const at = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const stage = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const pinch = useRef<{ dist: number; k: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  const apply = useCallback((next: Camera) => {
    cameraRef.current = next
    setCamera(next)
  }, [])

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const element = stage.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const { x, y, k } = cameraRef.current
    const wx = (mx - x) / k
    const wy = (my - y) / k
    const nextK = Math.min(4, Math.max(0.2, k * factor))
    apply({ k: nextK, x: mx - wx * nextK, y: my - wy * nextK })
  }, [apply])

  const fit = useCallback(() => {
    const element = stage.current
    if (!element || !nodes.length) return
    const padding = 80
    const minX = Math.min(...nodes.map((node) => node.x)) - padding
    const maxX = Math.max(...nodes.map((node) => node.x)) + padding
    const minY = Math.min(...nodes.map((node) => node.y)) - padding
    const maxY = Math.max(...nodes.map((node) => node.y)) + padding
    const width = Math.max(400, maxX - minX)
    const height = Math.max(300, maxY - minY)
    const k = Math.min(element.clientWidth / width, element.clientHeight / height, 1.4) * 0.92
    apply({
      k,
      x: (element.clientWidth - width * k) / 2 - minX * k,
      y: (element.clientHeight - height * k) / 2 - minY * k,
    })
  }, [apply, nodes])

  useEffect(() => {
    fit()
  }, [fit])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0018))
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.current) return
      event.preventDefault()
      const distance = Math.hypot(
        event.touches[1].clientX - event.touches[0].clientX,
        event.touches[1].clientY - event.touches[0].clientY,
      )
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2
      const rect = element.getBoundingClientRect()
      const mx = midX - rect.left
      const my = midY - rect.top
      const nextK = Math.min(4, Math.max(0.2, pinch.current.k * (distance / pinch.current.dist)))
      apply({
        k: nextK,
        x: mx - pinch.current.x * nextK,
        y: my - pinch.current.y * nextK,
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('touchmove', onTouchMove)
    }
  }, [apply, zoomAt])

  function zoom(factor: number) {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  return (
    <section className="page graph-page">
      <div className="page-head">
        <span className="eyebrow">Карта контекста</span>
        <h1>Граф задач</h1>
        <p>Связи и декомпозиция без списков. Нажмите на узел, чтобы открыть задачу.</p>
      </div>
      <div className="graph-shell">
        <div className="graph-toolbar">
          <button type="button" className="icon-button" onClick={() => zoom(1.25)} aria-label="Приблизить"><Icon name="zoom-in" /></button>
          <button type="button" className="icon-button" onClick={() => zoom(0.8)} aria-label="Отдалить"><Icon name="zoom-out" /></button>
          <button type="button" className="icon-button" onClick={fit} aria-label="Показать всё"><Icon name="reset" /></button>
        </div>
        <div
          ref={stage}
          className="graph-canvas"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('.graph-hit')) return
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              cx: cameraRef.current.x,
              cy: cameraRef.current.y,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!drag.current) return
            apply({
              ...cameraRef.current,
              x: drag.current.cx + (event.clientX - drag.current.x),
              y: drag.current.cy + (event.clientY - drag.current.y),
            })
          }}
          onPointerUp={() => { drag.current = null }}
          onTouchStart={(event) => {
            if (event.touches.length !== 2 || !stage.current) return
            drag.current = null
            const distance = Math.hypot(
              event.touches[1].clientX - event.touches[0].clientX,
              event.touches[1].clientY - event.touches[0].clientY,
            )
            const rect = stage.current.getBoundingClientRect()
            const mx = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left
            const my = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top
            pinch.current = {
              dist: distance,
              k: cameraRef.current.k,
              x: (mx - cameraRef.current.x) / cameraRef.current.k,
              y: (my - cameraRef.current.y) / cameraRef.current.k,
            }
          }}
          onTouchEnd={() => { pinch.current = null }}
        >
          {nodes.length ? (
            <svg className="graph-svg">
              <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
                {edges.map((edge) => {
                  const a = at.get(edge.a)
                  const b = at.get(edge.b)
                  if (!a || !b) return null
                  return <line key={`${edge.a}-${edge.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                })}
                {nodes.map((node) => (
                  <g key={node.id} className="graph-hit" transform={`translate(${node.x} ${node.y})`}>
                    <circle
                      r={focus === node.id ? 12 : 9}
                      className={focus === node.id ? 'focused' : ''}
                      onClick={() => {
                        setFocus(node.id)
                        onOpen(node.id)
                      }}
                    />
                    <text y="29" textAnchor="middle">
                      {wrapTitle(node.title).map((line, index) => (
                        <tspan key={line} x="0" dy={index === 0 ? 0 : 16}>{line}</tspan>
                      ))}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          ) : (
            <div className="empty-state">
              <span><Icon name="graph" /></span>
              <h2>Связей пока нет</h2>
              <p>Они появятся после связывания или декомпозиции задач.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
