const attachmentPathPrefix = '/api/attachments/'

function attachmentUrl(id) {
  return `${attachmentPathPrefix}${encodeURIComponent(id)}`
}

export function stateForClient(state) {
  if (!state?.items) return state
  return {
    ...state,
    items: state.items.map((item) => ({
      ...item,
      attachments: (item.attachments ?? []).map((attachment) => ({
        ...attachment,
        dataUrl: attachmentUrl(attachment.id),
      })),
    })),
  }
}

export function restoreAttachmentData(previous, incoming) {
  if (!previous?.items || !incoming?.items) return incoming
  const stored = new Map()
  for (const item of previous.items) {
    for (const attachment of item.attachments ?? []) {
      if (attachment?.id && typeof attachment.dataUrl === 'string') {
        stored.set(attachment.id, attachment.dataUrl)
      }
    }
  }

  return {
    ...incoming,
    items: incoming.items.map((item) => ({
      ...item,
      attachments: (item.attachments ?? []).map((attachment) => {
        if (
          typeof attachment.dataUrl === 'string' &&
          attachment.dataUrl.startsWith(attachmentPathPrefix)
        ) {
          const dataUrl = stored.get(attachment.id)
          if (!dataUrl) throw new Error(`Вложение ${attachment.id} не найдено на сервере`)
          return { ...attachment, dataUrl }
        }
        return attachment
      }),
    })),
  }
}

export function findAttachment(state, id) {
  for (const item of state?.items ?? []) {
    const attachment = (item.attachments ?? []).find((candidate) => candidate.id === id)
    if (attachment) return attachment
  }
  return null
}

export function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!match) return null
  return { mime: match[1], body: Buffer.from(match[2], 'base64') }
}
