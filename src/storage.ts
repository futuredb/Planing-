import { DEFAULT_AVATARS } from './member'
import type { AppState, Criterion, Item, Lane, Member } from './types'
import { createEmpty, DEFAULT_CRITERIA, isLegacyCriteria, TEAM_MEMBERS } from './seed'
import { mondayOf } from './dates'
import type { RoleMap } from './roles'
import { preserveRoles } from './roles'
import { fetchBoard } from './portal-session'

function withSession(state: AppState, response: Response): AppState {
  const id = response.headers.get('X-Funban-Actor-Id')
  const name = response.headers.get('X-Funban-Actor-Name')
  return { ...state, currentMemberId: id || state.currentMemberId || state.members[0]?.id || '',
    actors: id && name ? [...(state.actors ?? []).filter((actor) => actor.id !== id), { id, name: decodeURIComponent(name) }] : state.actors,
  }
}

export async function loadState(): Promise<AppState> {
  const res = await fetchBoard('/api/state')
  if (!res.ok) throw new Error('Не удалось загрузить доску')
  const remote = await res.json()
  if (remote === null) return withSession(createEmpty(), res)
  if (!remote || !Array.isArray(remote.items)) throw new Error('Сервер вернул некорректные данные')
  return withSession(migrate(remote as AppState), res)
}

export async function loadRemoteIfNewer(localUpdatedAt: number): Promise<AppState | null> {
  try {
    const res = await fetchBoard(`/api/state?since=${encodeURIComponent(localUpdatedAt)}`)
    if (res.status === 304) return null
    if (!res.ok) return null
    const remote = await res.json()
    if (!remote || !Array.isArray(remote.items)) return null
    if (!(Number(remote.updatedAt) > localUpdatedAt)) return null
    return withSession(migrate(remote as AppState), res)
  } catch {
    return null
  }
}

export type SaveStateResult = {
  ok: boolean
  updatedAt: number
  preservedIds: string[]
  conflict?: boolean
  error?: string
}

export async function saveState(
  state: AppState,
  baseUpdatedAt?: number,
  deletedRoots: string[] = [],
): Promise<SaveStateResult | null> {
  const { currentMemberId, ...board } = state
  const payload = JSON.stringify(board)
  void currentMemberId
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (Number.isFinite(baseUpdatedAt)) {
      headers['X-Funban-Base-Updated-At'] = String(baseUpdatedAt)
    }
    if (deletedRoots.length) headers['X-Funban-Deleted-Roots'] = JSON.stringify(deletedRoots)
    const response = await fetchBoard('/api/state', {
      method: 'PUT',
      headers,
      body: payload,
    })
    if (response.status === 409) {
      const result = (await response.json()) as { currentUpdatedAt?: number; error?: string }
      if (Number(result.currentUpdatedAt) === Number(baseUpdatedAt)) {
        return { ok: false, updatedAt: Number(result.currentUpdatedAt) || 0, preservedIds: [], error: result.error || 'Сервер отклонил сохранение' }
      }
      return {
        ok: false,
        conflict: true,
        updatedAt: Number(result.currentUpdatedAt) || 0,
        preservedIds: [],
      }
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) return null
      const details = await response.json().catch(() => ({})) as { error?: string }
      return { ok: false, updatedAt: 0, preservedIds: [], error: details.error || `Ошибка сохранения (${response.status})` }
    }
    const result = (await response.json()) as Partial<SaveStateResult>
    return {
      ok: result.ok === true,
      updatedAt: Number(result.updatedAt ?? state.updatedAt),
      preservedIds: Array.isArray(result.preservedIds) ? result.preservedIds : [],
    }
  } catch {
    /* offline / preview without API */
    return null
  }
}

export async function moveItemRemote(
  itemId: string,
  lane: Lane,
  sprintId?: string | null,
): Promise<{ ok: boolean; updatedAt: number } | null> {
  try {
    const response = await fetchBoard(`/api/items/${encodeURIComponent(itemId)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lane,
        ...(sprintId === undefined ? {} : { sprintId }),
        requestId: crypto.randomUUID(),
      }),
    })
    if (!response.ok) return null
    const result = (await response.json()) as { ok?: boolean; updatedAt?: number }
    return { ok: result.ok === true, updatedAt: Number(result.updatedAt) || 0 }
  } catch {
    return null
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
  if (state.roles && Object.keys(state.roles).length) return preserveRoles(state.roles, memberIds)
  const week = mondayOf()
  const fromWeek = state.sprints?.find((s) => s.id === week)?.roles
  if (fromWeek && Object.keys(fromWeek).length) return preserveRoles(fromWeek, memberIds)
  const fromAny = state.sprints?.find((s) => s.roles && Object.keys(s.roles).length)?.roles
  if (fromAny) return preserveRoles(fromAny, memberIds)
  return {}
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
    sprints: (state.sprints ?? []).map((sprint) =>
      sprint.roles ? { ...sprint, roles: preserveRoles(sprint.roles, memberIds) } : sprint,
    ),
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

export function isInlineImage(mime: string) {
  return /^(image\/(png|jpeg|webp|gif))$/i.test(mime)
}

export function isInlineVideo(mime: string) {
  return /^(video\/(mp4|webm|ogg))$/i.test(mime)
}

export function filesToAttachments(files: FileList | File[]) {
  return Promise.all(
    [...files].map(
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
