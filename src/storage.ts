import { DEFAULT_AVATARS } from './Avatar'
import type { AppState, Criterion, Item } from './types'
import { createSeed, TEAM_MEMBERS } from './seed'
import { mondayOf } from './dates'
import { defaultRoles } from './roles'

const LS_KEY = 'weekboard-state-v1'

export async function loadState(): Promise<AppState> {
  try {
    const res = await fetch('/api/state')
    if (res.ok) {
      const remote = await res.json()
      if (remote && remote.items) return migrate(remote as AppState)
    }
  } catch {
    /* local fallback */
  }

  const raw = localStorage.getItem(LS_KEY)
  if (raw) {
    try {
      return migrate(JSON.parse(raw) as AppState)
    } catch {
      /* seed */
    }
  }
  return createSeed()
}

export async function saveState(state: AppState) {
  const payload = JSON.stringify(state)
  localStorage.setItem(LS_KEY, payload)
  try {
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  } catch {
    /* offline / preview */
  }
}

function migrate(state: AppState): AppState {
  const members = TEAM_MEMBERS.map((preset) => {
    const existing = state.members.find((m) => m.id === preset.id)
    return {
      ...preset,
      name: existing?.name || preset.name,
      avatar: DEFAULT_AVATARS[preset.id] || preset.avatar,
    }
  })
  const memberIds = members.map((m) => m.id)
  const withFaces: AppState = {
    ...state,
    members,
    items: state.items.map((it) => {
      const legacy = (
        it as Item & { reactions?: { sticker: Item['stickers'][number]['sticker']; by: string }[] }
      ).reactions
      const fromOld = (legacy ?? []).map((r) => ({
        id: crypto.randomUUID(),
        sticker: r.sticker,
        by: r.by,
        x: 8 + Math.random() * 70,
        y: 8 + Math.random() * 55,
        rot: Math.random() * 40 - 20,
        scale: 0.85 + Math.random() * 0.35,
      }))
      return {
        ...it,
        authorId: it.authorId ?? null,
        stickers: it.stickers?.length ? it.stickers : fromOld,
      }
    }),
    sprints: state.sprints.map((sp) => ({
      ...sp,
      roles:
        sp.roles && Object.keys(sp.roles).length
          ? sp.roles
          : defaultRoles(sp.id, memberIds),
    })),
  }
  const week = mondayOf()
  if (withFaces.sprints.some((s) => s.id === week)) return withFaces
  return {
    ...withFaces,
    sprints: [
      ...withFaces.sprints,
      {
        id: week,
        weekStart: week,
        goal: '',
        goalClosed: false,
        closed: false,
        roles: defaultRoles(week, memberIds),
      },
    ],
  }
}

export function itemScore(item: Item, criteria: Criterion[]) {
  if (!criteria.length) return 0
  let weighted = 0
  let weights = 0
  for (const c of criteria) {
    const raw = item.scores[c.id]
    if (raw == null) continue
    const value = c.invert ? 6 - raw : raw
    weighted += value * c.weight
    weights += c.weight
  }
  if (!weights) return 0
  return Math.round((weighted / weights) * 10) / 10
}

export function filesToAttachments(files: FileList | File[]) {
  return Promise.all(
    [...files].filter((f) => f.type.startsWith('image/')).map(
      (file) =>
        new Promise<{ id: string; name: string; mime: string; dataUrl: string }>(
          (resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                mime: file.type,
                dataUrl: String(reader.result),
              })
            reader.onerror = reject
            reader.readAsDataURL(file)
          },
        ),
    ),
  )
}
