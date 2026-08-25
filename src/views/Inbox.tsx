import { useCallback, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { AssignedFace } from '../AssignedFace'
import { memberDropBind, readMemberDrop } from '../Avatar'
import { RoleChip } from '../RoleChip'
import { CardStickers } from '../StickerBar'
import { stickerDropBind } from '../stickers'
import { filesToAttachments } from '../storage'
import { useStore } from '../store'
import type { Attachment } from '../types'

export function Inbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { state, weekId, addIdea, pullToSprint, moveItem, assignItem, stickSticker } = useStore()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [over, setOver] = useState(false)

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const next = await filesToAttachments(list)
    setFiles((prev) => [...prev, ...next])
  }, [])

  async function onPaste(e: ClipboardEvent) {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (images.length) {
      e.preventDefault()
      await addFiles(images)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() && !body.trim() && !files.length) return
    addIdea({ title, body, attachments: files })
    setTitle('')
    setBody('')
    setFiles([])
  }

  const ideas = state.items.filter((it) => it.lane === 'inbox' && !it.parentId)
  const sprint = state.sprints.find((s) => s.id === weekId)

  return (
    <section className="page">
      <div className="page-head">
        <h2>Собрать идею</h2>
        <p>Текст, вставка скрина Cmd+V, перетаскивание картинки. Без формы на три экрана.</p>
      </div>

      <form
        className={over ? 'capture over' : 'capture'}
        onSubmit={submit}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e: DragEvent) => {
          e.preventDefault()
          setOver(false)
          if (readMemberDrop(e)) return
          if (e.dataTransfer.files.length) await addFiles(e.dataTransfer.files)
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что случилось или что хотим"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Контекст, ссылка, цитата из чата"
        />
        {files.length ? (
          <div className="thumbs">
            {files.map((f) => (
              <img key={f.id} src={f.dataUrl} alt={f.name} />
            ))}
          </div>
        ) : (
          <p className="hint">Можно бросить сюда скриншот или выбрать файл.</p>
        )}
        <div className="row">
          <label className="file">
            Картинка
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>
          <button type="submit" className="primary">
            В входящие
          </button>
        </div>
      </form>

      <ul className="idea-list">
        {ideas.map((it) => {
          const owner = state.members.find((m) => m.id === it.assigneeId)
          const author = state.members.find((m) => m.id === it.authorId)
          const authorRole = author ? sprint?.roles?.[author.id] : undefined
          const memberDrop = memberDropBind((id, from) => assignItem(it.id, id, from))
          const stickerDrop = stickerDropBind((sticker, place, from) =>
            stickSticker(it.id, sticker, place, from),
          )
          return (
            <li
              key={it.id}
              className="idea-card"
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
              <CardStickers item={it} />
              <div className="idea-row">
                {owner ? <AssignedFace itemId={it.id} member={owner} /> : <span className="face empty sm" />}
                <button className="idea" onClick={() => onOpen(it.id)}>
                  <strong>{it.title}</strong>
                  {author ? (
                    <span className="idea-author">
                      {author.name}
                      <RoleChip roleId={authorRole} />
                    </span>
                  ) : null}
                  {it.body ? <span>{it.body}</span> : null}
                  {it.attachments.length ? (
                    <em>{it.attachments.length} изобр.</em>
                  ) : null}
                </button>
              </div>
              <div className="row tight">
                <button type="button" onClick={() => moveItem(it.id, 'backlog', null)}>
                  В бэклог
                </button>
                <button type="button" onClick={() => pullToSprint(it.id)}>
                  В спринт
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
