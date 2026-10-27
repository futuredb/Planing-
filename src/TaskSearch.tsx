import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Item, Lane, Member } from './types'
import { Icon } from './ui/Icon'

const laneNames: Record<Lane, string> = {
  inbox: 'Входящие', backlog: 'Бэклог', todo: 'Спринт',
  doing: 'В работе', done: 'Готово', archive: 'Архив',
}

function normalize(value: string) {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim()
}

export function TaskSearch({ items, members, onOpen }: {
  items: Item[]
  members: Member[]
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const matches = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    return items.filter((item) => {
      const content = normalize(`${item.title} ${item.body}`)
      return terms.every((term) => content.includes(term))
    }).sort((a, b) => {
      const aTitle = terms.every((term) => normalize(a.title).includes(term))
      const bTitle = terms.every((term) => normalize(b.title).includes(term))
      return Number(bTitle) - Number(aTitle) || b.createdAt - a.createdAt
    })
  }, [items, query])
  const hasQuery = Boolean(normalize(query))

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="header-search" ref={root}>
      <button ref={trigger} type="button" className="icon-button search-trigger" aria-label="Поиск задач"
        aria-expanded={open} aria-controls={panelId} title="Поиск задач" onClick={() => setOpen((value) => !value)}>
        <Icon name="search" size={20} />
      </button>
      {open ? (
        <section id={panelId} className="search-panel" aria-label="Поиск по задачам">
          <div className="search-field">
            <Icon name="search" size={19} />
            <input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Название или описание" aria-label="Найти задачу" />
          </div>
          {!hasQuery ? (
            <p className="search-hint">Ищем во всех задачах, включая архив</p>
          ) : matches.length ? (
            <>
              <p className="search-hint" aria-live="polite">Найдено: {matches.length}</p>
              <ul className="search-results">
                {matches.slice(0, 30).map((item) => {
                  const assignee = members.find((member) => member.id === item.assigneeId)
                  return (
                    <li key={item.id}>
                      <button type="button" onClick={() => { setOpen(false); setQuery(''); onOpen(item.id) }}>
                        <strong>{item.title || 'Без названия'}</strong>
                        <span>{laneNames[item.lane]}{assignee ? ` · ${assignee.name}` : ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {matches.length > 30 ? <p className="search-hint">Показаны первые 30. Уточните запрос.</p> : null}
            </>
          ) : <p className="search-hint" aria-live="polite">Ничего не найдено. Попробуйте другие слова.</p>}
        </section>
      ) : null}
    </div>
  )
}
