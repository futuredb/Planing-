const identityUrl = process.env.FUNBAN_PORTAL_IDENTITY_URL || 'http://team-portal:3000/api/access/identity'
export const portalRequired = process.env.NODE_ENV === 'production' || Boolean(process.env.FUNBAN_PORTAL_IDENTITY_URL)
export const portalLoginUrl = process.env.FUNBAN_PORTAL_LOGIN_URL || 'https://future-db.ru/login?next=%2Fopen%2Ffunban'

export async function portalActor(req) {
  if (!portalRequired) return null
  const cookie = String(req.headers.cookie || '')
  if (!cookie) return null
  const response = await fetch(identityUrl, {
    headers: { Cookie: cookie }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Портал авторизации временно недоступен')
  const user = await response.json()
  if (!user || typeof user.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(user.id) ||
      typeof user.name !== 'string' || !user.name.trim() || user.name.length > 200) {
    throw new Error('Портал вернул некорректную учётную запись')
  }
  return { id: `portal:${user.id}`, name: user.name.trim() }
}

export function withActor(actors = [], actor) {
  return actor ? [...actors.filter((entry) => entry.id !== actor.id), actor] : actors
}

// Runs under the repository's write lock. Client-selected identities are ignored.
export function attributeChanges(previous, incoming, actor) {
  if (!actor) return incoming
  const items = new Map((previous?.items ?? []).map((item) => [item.id, item]))
  const comments = new Map((previous?.comments ?? []).map((comment) => [comment.id, comment]))
  const immutableAuthor = (old, entry, field) => {
    if (old && (old[field] ?? null) !== (entry[field] ?? null)) throw new Error('Нельзя менять автора существующей записи')
    return old ? old[field] : actor.id
  }
  return {
    ...incoming,
    currentMemberId: actor.id,
    actors: withActor(previous?.actors, actor),
    items: incoming.items.map((item) => ({
      ...item, authorId: immutableAuthor(items.get(item.id), item, 'authorId'),
      stickers: item.stickers.map((sticker) => ({ ...sticker,
        by: immutableAuthor(items.get(item.id)?.stickers.find((old) => old.id === sticker.id), sticker, 'by'),
      })),
    })),
    comments: incoming.comments.map((comment) => {
      const old = comments.get(comment.id)
      if (old && (old.text !== comment.text || old.itemId !== comment.itemId || old.createdAt !== comment.createdAt)) {
        throw new Error('Нельзя переписывать существующий комментарий от чужого имени')
      }
      return { ...comment, authorId: immutableAuthor(old, comment, 'authorId') }
    }),
  }
}
