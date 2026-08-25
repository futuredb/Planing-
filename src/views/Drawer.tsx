import { useState, type FormEvent } from 'react'
import { Avatar, memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'
import type { Item, Lane } from '../types'

export function Drawer({ item, onClose }: { item: Item; onClose: () => void }) {
  const {
    state,
    updateItem,
    removeItem,
    pullToSprint,
    carryOver,
    moveItem,
    decompose,
    setScore,
    addComment,
    scoreOf,
    assignItem,
    stickSticker,
  } = useStore()
  const [parts, setParts] = useState('')
  const [comment, setComment] = useState('')
  const children = state.items.filter((it) => it.parentId === item.id)
  const thread = state.comments.filter((c) => c.itemId === item.id)
  const parent = state.items.find((it) => it.id === item.parentId)

  function sendComment(e: FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    addComment(item.id, comment)
    setComment('')
  }

  function split() {
    const titles = parts.split('\n')
    if (!titles.some((t) => t.trim())) return
    decompose(item.id, titles)
    setParts('')
  }

  const memberDrop = memberDropBind((id, from) => assignItem(item.id, id, from))
  const stickerDrop = stickerDropBind((sticker, place, from) =>
    stickSticker(item.id, sticker, place, from),
  )

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          stickerDrop.onDragOver(e)
          memberDrop.onDragOver(e)
        }}
        onDrop={(e) => {
          stickerDrop.onDrop(e)
          if (e.defaultPrevented) return
          memberDrop.onDrop(e)
        }}
      >
        <CardStickers item={item} />
        <header>
          <button type="button" className="ghost" onClick={onClose}>
            Закрыть
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              removeItem(item.id)
              onClose()
            }}
          >
            Удалить
          </button>
        </header>

        <input
          className="title"
          value={item.title}
          onChange={(e) => updateItem(item.id, { title: e.target.value })}
        />
        {parent ? <p className="hint">Часть: {parent.title}</p> : null}

        <textarea
          rows={5}
          value={item.body}
          onChange={(e) => updateItem(item.id, { body: e.target.value })}
          placeholder="Описание"
        />

        {item.attachments.length ? (
          <div className="thumbs large">
            {item.attachments.map((a) => (
              <img key={a.id} src={a.dataUrl} alt={a.name} />
            ))}
          </div>
        ) : null}

        <div className="assignee">
          {state.members.map((m) => (
            <Avatar
              key={m.id}
              member={m}
              current={item.assigneeId === m.id}
              onPick={() => assignItem(item.id, m.id)}
            />
          ))}
        </div>

        <label>
          Колонка
          <select
            value={item.lane}
            onChange={(e) => moveItem(item.id, e.target.value as Lane, item.sprintId)}
          >
            <option value="inbox">Входящие</option>
            <option value="backlog">Бэклог</option>
            <option value="todo">Спринт</option>
            <option value="doing">В работе</option>
            <option value="done">Готово</option>
          </select>
        </label>

        <div className="row">
          <button type="button" onClick={() => pullToSprint(item.id)}>
            В этот спринт
          </button>
          <button type="button" onClick={() => carryOver(item.id)}>
            В следующую неделю
          </button>
        </div>

        <h3>Оценка · {scoreOf(item) || 'нет балла'}</h3>
        {state.criteria.map((c) => (
          <label key={c.id} className="score-row">
            <span>
              {c.name}
              {c.hint ? <i>{c.hint}</i> : null}
            </span>
            <input
              type="range"
              min={1}
              max={5}
              value={item.scores[c.id] ?? 3}
              onChange={(e) => setScore(item.id, c.id, Number(e.target.value))}
            />
            <b>{item.scores[c.id] ?? '—'}</b>
          </label>
        ))}

        <h3>Разложить</h3>
        <p className="hint">Каждая строка — отдельная задача. Исходная остаётся родителем.</p>
        <textarea
          rows={3}
          value={parts}
          onChange={(e) => setParts(e.target.value)}
          placeholder={'Проверить шаблон\nПочинить вёрстку\nОтдать на тест'}
        />
        <button type="button" onClick={split}>
          Создать части
        </button>
        {children.length ? (
          <ul className="parts">
            {children.map((ch) => (
              <li key={ch.id}>
                {ch.title} · {laneName(ch.lane)}
              </li>
            ))}
          </ul>
        ) : null}

        <h3>Комментарии</h3>
        <ul className="comments">
          {thread.map((c) => {
            const who = state.members.find((m) => m.id === c.authorId)
            return (
              <li key={c.id}>
                <b>{who?.name ?? '—'}</b>
                <time>
                  {new Date(c.createdAt).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <p>{c.text}</p>
              </li>
            )
          })}
        </ul>
        <form onSubmit={sendComment} className="comment-form">
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Заметка команде"
          />
          <button type="submit" className="primary">
            Написать
          </button>
        </form>
      </aside>
    </div>
  )
}

function laneName(lane: Lane) {
  return {
    inbox: 'входящие',
    backlog: 'бэклог',
    todo: 'спринт',
    doing: 'в работе',
    done: 'готово',
  }[lane]
}
