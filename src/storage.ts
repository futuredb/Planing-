import { DEFAULT_AVATARS } from './Avatar'
import type { AppState, Criterion, Item, Member } from './types'
import { createEmpty, DEFAULT_CRITERIA, isLegacyCriteria, TEAM_MEMBERS } from './seed'
import { mondayOf } from './dates'
import type { RoleMap } from './roles'
import { defaultRoles } from './roles'

const ME_KEY = 'weekboard-me'

export function loadMe(): string | null {
  try {
    return localStorage.getItem(ME_KEY)
  } catch {
    return null
  }
}

export function saveMe(id: string) {
  try {
    localStorage.setItem(ME_KEY, id)
  } catch {
    /* private mode */
  }
}

function withPersona(state: AppState): AppState {
  const saved = loadMe()
  const id =
    saved && state.members.some((m) => m.id === saved)
      ? saved
      : (state.members[0]?.id ?? 'm1')
  return { ...state, currentMemberId: id }
}

export async function loadState(): Promise<AppState> {
  try {
    const res = await fetch('/api/state')
    if (res.ok) {
      const remote = await res.json()
      if (remote && Array.isArray(remote.items)) {
        return withPersona(migrate(remote as AppState))
      }
      return withPersona(createEmpty())
    }
  } catch {
    /* static host / offline */
  }

  try {
    const raw = localStorage.getItem('weekboard-state-v1')
    if (raw) return withPersona(migrate(JSON.parse(raw) as AppState))
  } catch {
    /* ignore */
  }

  return withPersona(createEmpty())
}

export async function saveState(state: AppState) {
  const { currentMemberId, ...board } = state
  const payload = JSON.stringify(board)
  void currentMemberId
  try {
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  } catch {
    /* offline / preview without API */
  }
}

function migrateMembers(state: AppState): Member[] {
  const byId = new Map((state.members ?? []).map((m) => [m.id, m]))
  const roster = TEAM_MEMBERS.map((preset) => {
    const existing = byId.get(preset.id)
    return {
      ...preset,
      name: existing?.name || preset.name,
      role: existing?.role ?? preset.role,
      avatar: existing?.avatar || DEFAULT_AVATARS[preset.id] || preset.avatar,
    }
  })
  const known = new Set(roster.map((m) => m.id))
  for (const m of state.members ?? []) {
    if (!known.has(m.id)) roster.push(m)
  }
  return roster
}

function pickRoles(state: AppState, memberIds: string[]): RoleMap {
  if (state.roles && Object.keys(state.roles).length) return state.roles
  const week = mondayOf()
  const fromWeek = state.sprints?.find((s) => s.id === week)?.roles
  if (fromWeek && Object.keys(fromWeek).length) return fromWeek
  const fromAny = state.sprints?.find((s) => s.roles && Object.keys(s.roles).length)?.roles
  if (fromAny) return fromAny
  return defaultRoles('crew', memberIds)
}

function migrate(state: AppState): AppState {
  const members = migrateMembers(state)
  const memberIds = members.map((m) => m.id)
  const withFaces: AppState = {
    ...state,
    members,
    roles: pickRoles(state, memberIds),
    items: (state.items ?? []).map((it) => {
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
      const lane = it.lane === 'archive' ? 'archive' : it.lane
      return {
        ...it,
        lane,
        authorId: it.authorId ?? null,
        relatedIds: it.relatedIds ?? [],
        stickers: it.stickers?.length ? it.stickers : fromOld,
        archivedAt:
          lane === 'archive' ? (it.archivedAt ?? it.createdAt ?? Date.now()) : (it.archivedAt ?? null),
      }
    }),
    sprints: state.sprints ?? [],
    comments: state.comments ?? [],
    criteria: isLegacyCriteria(state.criteria)
      ? DEFAULT_CRITERIA.map((c) => ({ ...c }))
      : state.criteria.map((c) => ({
          ...c,
          max: c.max ?? 5,
          step: c.step ?? 1,
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
      },
    ],
  }
}

export function itemScore(item: Item, criteria: Criterion[]): number | null {
  if (!criteria.length) return null
  let plus = 0
  let plusCount = 0
  let penalty = 1
  for (const c of criteria) {
    const raw = item.scores[c.id]
    if (raw == null) continue
    const max = c.max || 5
    const n = Math.min(max, Math.max(0, raw)) / max
    if (c.invert) {
      penalty *= 1 - n
    } else {
      plus += n
      plusCount += 1
    }
  }
  if (!plusCount) return null
  return Math.round((plus / plusCount) * penalty * 100) / 10
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
