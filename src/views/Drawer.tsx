import { useEffect, useState, type FormEvent } from 'react'
import { Avatar, memberDropBind } from '../Avatar'
import { CardStickers } from '../StickerBar'
import { filesToAttachments } from '../storage'
import { stickerDropBind } from '../stickers'
import { useStore } from '../store'
import type { Attachment, Item, Lane } from '../types'

export function Drawer({
  item,
  onOpen,
  onClose,
}: {
  item: Item
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const {
    state,
    updateItem,
    removeItem,
    pullToSprint,
    carryOver,
    moveItem,
    decompose,
    linkTasks,
    unlinkTask,
    setScore,
    addComment,
    scoreOf,
    assignItem,
    stickSticker,
  } = useStore()
  const [parts, setParts] = useState('')
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<Attachment | null>(null)
  const children = state.items.filter((it) => it.parentId === item.id)
  const peers = (item.relatedIds ?? [])
    .map((id) => state.items.find((it) => it.id === id))
    .filter((it): it is Item => Boolean(it))
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

  function connect() {
    const titles = parts.split('\n')
    if (!titles.some((t) => t.trim())) return
    linkTasks(item.id, titles)
    setParts('')
  }

  async function addImages(list: FileList | File[]) {
    const next = await filesToAttachments(list)
    if (!next.length) return
    updateItem(item.id, { attachments: [...item.attachments, ...next] })
  }

  function removeImage(id: string) {
    updateItem(item.id, {
      attachments: item.attachments.filter((a) => a.id !== id),
    })
  }

  const memberDrop = memberDropBind((id, from) => assignItem(item.id, id, from))
  const stickerDrop = stickerDropBind((sticker, place, from) =>
    stickSticker(item.id, sticker, place, from),
  )

  useEffect(() => {
    setPreview(null)
  }, [item.id])

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  return (
    <>
    <div className="drawer-bg" onClick={onClose}>
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          stickerDrop.onDragOver(e)
          memberDrop.onDragOver(e)
        }}
        onDrop={async (e) => {
          stickerDrop.onDrop(e)
          if (e.defaultPrevented) return
          memberDrop.onDrop(e)
          if (e.defaultPrevented) return
          if (e.dataTransfer.files.length) {
            e.preventDefault()
            await addImages(e.dataTransfer.files)
          }
        }}
      >
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

        {item.stickers?.length ? (
          <div className="drawer-art">
            <CardStickers item={item} />
          </div>
        ) : null}

        <section className="drawer-block">
          <input
            className="title"
            value={item.title}
            onChange={(e) => updateItem(item.id, { title: e.target.value })}
          />
          {parent ? (
            <p className="hint">
              Часть:{' '}
              <button type="button" className="link" onClick={() => onOpen(parent.id)}>
                {parent.title}
              </button>
            </p>
          ) : null}
          <textarea
            rows={5}
            value={item.body}
            onChange={(e) => updateItem(item.id, { body: e.target.value })}
            placeholder="Описание"
          />
          {item.attachments.length ? (
            <div className="thumbs">
              {item.attachments.map((a) => (
                <figure key={a.id} className="thumb-item">
                  <button
                    type="button"
                    className="thumb-open"
                    onClick={() => setPreview(a)}
                  >
                    <img src={a.dataUrl} alt={a.name} />
                  </button>
                  <button
                    type="button"
                    className="thumb-x"
                    onClick={() => {
                      if (preview?.id === a.id) setPreview(null)
                      removeImage(a.id)
                    }}
                    aria-label="Удалить картинку"
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
          <label className="file ghost">
            Добавить картинку
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) void addImages(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </section>

        <section className="drawer-block">
          <div className="drawer-meta">
            <div>
              <span className="field-label">Кто делает</span>
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
            </div>
            <label className="field">
              <span className="field-label">Колонка</span>
              <select
                value={item.lane}
                onChange={(e) => moveItem(item.id, e.target.value as Lane, item.sprintId)}
              >
                <option value="inbox">Входящие</option>
                <option value="backlog">Бэклог</option>
                <option value="todo">Спринт</option>
                <option value="doing">В работе</option>
                <option value="done">Готово</option>
                <option value="archive">Архив</option>
              </select>
            </label>
          </div>
          <div className="row">
            {item.lane === 'archive' ? (
              <button type="button" className="primary" onClick={() => moveItem(item.id, 'backlog', null)}>
                Вернуть в бэклог
              </button>
            ) : (
              <>
                <button type="button" className="primary" onClick={() => pullToSprint(item.id)}>
                  В этот спринт
                </button>
                <button type="button" className="ghost" onClick={() => carryOver(item.id)}>
                  В следующую неделю
                </button>
              </>
            )}
          </div>
        </section>

        <section className="drawer-block">
          <h3>Оценка · {scoreOf(item) ?? 'нет балла'}</h3>
          {state.criteria.map((c) => (
            <label key={c.id} className="score-row">
              <span>{c.name}</span>
              <input
                type="range"
                min={0}
                max={c.max}
                step={c.step}
                value={item.scores[c.id] ?? 0}
                onChange={(e) => setScore(item.id, c.id, Number(e.target.value))}
              />
              <b>{item.scores[c.id] ?? '—'}</b>
            </label>
          ))}
        </section>

        <section className="drawer-block">
          <h3>Связи</h3>
          <textarea
            rows={3}
            value={parts}
            onChange={(e) => setParts(e.target.value)}
            placeholder={'Название задачи, по одной в строке'}
          />
          <select
            defaultValue=""
            onChange={(e) => {
              const title = e.target.value
              if (!title) return
              linkTasks(item.id, [title])
              e.target.value = ''
            }}
          >
            <option value="">Связать с существующей…</option>
            {state.items
              .filter(
                (it) =>
                  it.lane !== 'archive' &&
                  it.id !== item.id &&
                  !(item.relatedIds ?? []).includes(it.id) &&
                  it.parentId !== item.id,
              )
              .map((it) => (
                <option key={it.id} value={it.title}>
                  {it.title}
                </option>
              ))}
          </select>
          <div className="row">
            <button type="button" className="ghost" onClick={connect}>
              Связать
            </button>
            <button type="button" className="ghost" onClick={split}>
              Создать части
            </button>
          </div>
          {peers.length ? (
            <ul className="parts">
              {peers.map((peer) => (
                <li key={peer.id} className="link-row">
                  <button type="button" className="link" onClick={() => onOpen(peer.id)}>
                    {peer.title}
                  </button>
                  <button type="button" className="ghost" onClick={() => unlinkTask(item.id, peer.id)}>
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {children.length ? (
            <ul className="parts">
              {children.map((ch) => (
                <li key={ch.id}>
                  <button type="button" className="link" onClick={() => onOpen(ch.id)}>
                    {ch.title}
                  </button>
                  <span> · часть · {laneName(ch.lane)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="drawer-block">
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
            <button type="submit" className="ghost">
              Написать
            </button>
          </form>
        </section>
      </aside>
    </div>
    {preview ? (
      <div className="img-preview" onClick={() => setPreview(null)}>
        <button
          type="button"
          className="thumb-x img-preview-x"
          onClick={() => setPreview(null)}
          aria-label="Закрыть превью"
        >
          ×
        </button>
        <img
          src={preview.dataUrl}
          alt={preview.name}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    ) : null}
    </>
  )
}

function laneName(lane: Lane) {
  return {
    inbox: 'входящие',
    backlog: 'бэклог',
    todo: 'спринт',
    doing: 'в работе',
    done: 'готово',
    archive: 'архив',
  }[lane]
}
