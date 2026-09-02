import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { mondayOf, nextMonday, shiftMonday, uid } from './dates'
import { itemScore, loadRemoteIfNewer, loadState, saveMe, saveState } from './storage'
import type { AppState, Attachment, Criterion, Item, Lane } from './types'
import type { StickerId } from './stickers'
import { defaultRoles, rollRoles } from './roles'
import { StoreContext } from './store-context'

export type Store = {
  state: AppState
  weekId: string
  liveWeek: boolean
  shiftWeek: (dir: -1 | 1) => void
  goThisWeek: () => void
  setCurrentMember: (id: string) => void
  patchMember: (id: string, patch: { name?: string; role?: string; avatar?: string }) => void
  assignItem: (itemId: string, memberId: string | null, fromItemId?: string | null) => void
  setGoal: (text: string) => void
  toggleGoalClosed: () => void
  addIdea: (input: { title: string; body: string; attachments: Attachment[] }) => void
  updateItem: (id: string, patch: Partial<Item>) => void
  removeItem: (id: string) => void
  moveItem: (id: string, lane: Lane, sprintId?: string | null) => void
  pullToSprint: (id: string) => void
  carryOver: (id: string) => void
  decompose: (id: string, titles: string[]) => void
  linkTasks: (id: string, titles: string[]) => void
  unlinkTask: (id: string, otherId: string) => void
  setScore: (itemId: string, criterionId: string, value: number | null) => void
  addComment: (itemId: string, text: string) => void
  addCriterion: () => void
  updateCriterion: (id: string, patch: Partial<Criterion>) => void
  removeCriterion: (id: string) => void
  closeSprint: () => void
  rollWeekRoles: () => void
  stickSticker: (
    itemId: string,
    sticker: StickerId,
    place: { x: number; y: number; rot: number; scale: number },
    from?: { itemId: string; placedId: string; rot: number; scale: number },
  ) => void
  peelSticker: (itemId: string, placedId: string) => void
  toggleReaction: (itemId: string, sticker: StickerId) => void
  scoreOf: (item: Item) => number | null
}

function bump(state: AppState): AppState {
  return { ...state, updatedAt: Date.now() }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const skipSave = useRef(true)
  const remoteVersion = useRef(0)

  useEffect(() => {
    loadState().then((next) => {
      remoteVersion.current = Number(next.updatedAt) || 0
      setMe(next.currentMemberId)
      setState(next)
    })
  }, [])

  useEffect(() => {
    if (!state) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    const t = setTimeout(() => {
      const submittedAt = state.updatedAt
      void saveState(state, remoteVersion.current).then(async (result) => {
        if (!result) return
        if (result.updatedAt) {
          remoteVersion.current = Math.max(remoteVersion.current, result.updatedAt)
        }
        if (!result.preservedIds.length) return

        const remote = await loadRemoteIfNewer(-1)
        if (!remote) return
        remoteVersion.current = Math.max(remoteVersion.current, Number(remote.updatedAt) || 0)
        const protectedIds = new Set(result.preservedIds)

        setState((current) => {
          if (!current) return current
          if (current.updatedAt === submittedAt) {
            skipSave.current = true
            return remote
          }

          const remoteById = new Map(remote.items.map((item) => [item.id, item]))
          const currentIds = new Set(current.items.map((item) => item.id))
          const replaced = current.items.map((item) =>
            protectedIds.has(item.id) ? (remoteById.get(item.id) ?? item) : item,
          )
          const restored = remote.items.filter(
            (item) => protectedIds.has(item.id) && !currentIds.has(item.id),
          )
          const sprintIds = new Set(current.sprints.map((sprint) => sprint.id))
          const restoredSprints = remote.sprints.filter(
            (sprint) => !sprintIds.has(sprint.id) &&
              [...protectedIds].some(
                (id) => remoteById.get(id)?.sprintId === sprint.id,
              ),
          )
          return {
            ...current,
            items: [...restored, ...replaced],
            sprints: [...current.sprints, ...restoredSprints],
          }
        })
      })
    }, 250)
    return () => clearTimeout(t)
  }, [state])

  useEffect(() => {
    const t = setInterval(() => {
      void loadRemoteIfNewer(state?.updatedAt ?? 0).then((remote) => {
        if (!remote) return
        remoteVersion.current = Math.max(remoteVersion.current, Number(remote.updatedAt) || 0)
        skipSave.current = true
        setMe(remote.currentMemberId)
        setState(remote)
      })
    }, 4000)
    return () => clearInterval(t)
  }, [state?.updatedAt])

  const mutate = useCallback((fn: (prev: AppState) => AppState) => {
    setState((prev) => (prev ? bump(fn(prev)) : prev))
  }, [])

  const [weekId, setWeekId] = useState(mondayOf)
  const liveWeek = weekId === mondayOf()

  const api = useMemo<Store | null>(() => {
    if (!state || !me) return null
    const sprintRoles = state.sprints.find((sprint) => sprint.id === weekId)?.roles
    const rolesForWeek =
      sprintRoles && Object.keys(sprintRoles).length
        ? sprintRoles
        : liveWeek && Object.keys(state.roles ?? {}).length
          ? state.roles
          : defaultRoles(weekId, state.members.map((member) => member.id))
    const view: AppState = { ...state, currentMemberId: me, roles: rolesForWeek }

    const withWeek = (prev: AppState, id: string) => {
      if (prev.sprints.some((s) => s.id === id)) return prev
      return {
        ...prev,
        sprints: [
          ...prev.sprints,
          {
            id,
            weekStart: id,
            goal: '',
            goalClosed: false,
            closed: false,
          },
        ],
      }
    }

    const ensureNext = (prev: AppState) => withWeek(prev, nextMonday(weekId))

    return {
      state: view,
      weekId,
      liveWeek,
      shiftWeek: (dir) => {
        const next = shiftMonday(weekId, dir)
        setWeekId(next)
        setState((prev) => {
          if (!prev) return prev
          const updated = withWeek(prev, next)
          return updated === prev ? prev : bump(updated)
        })
      },
      goThisWeek: () => {
        const now = mondayOf()
        setWeekId(now)
        setState((prev) => {
          if (!prev) return prev
          const updated = withWeek(prev, now)
          return updated === prev ? prev : bump(updated)
        })
      },
      setCurrentMember: (id) => {
        saveMe(id)
        setMe(id)
      },
      patchMember: (id, patch) =>
        mutate((s) => ({
          ...s,
          members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      assignItem: (itemId, memberId, fromItemId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id === itemId) return { ...it, assigneeId: memberId }
            if (fromItemId && it.id === fromItemId && fromItemId !== itemId) {
              return { ...it, assigneeId: null }
            }
            return it
          }),
        })),
      setGoal: (text) =>
        mutate((s) => ({
          ...s,
          sprints: s.sprints.map((sp) => (sp.id === weekId ? { ...sp, goal: text } : sp)),
        })),
      toggleGoalClosed: () =>
        mutate((s) => ({
          ...s,
          sprints: s.sprints.map((sp) =>
            sp.id === weekId ? { ...sp, goalClosed: !sp.goalClosed } : sp,
          ),
        })),
      addIdea: ({ title, body, attachments }) =>
        mutate((s) => ({
          ...s,
          items: [
            {
              id: uid(),
              title: title.trim() || 'Без названия',
              body,
              lane: 'inbox',
              sprintId: null,
              parentId: null,
              assigneeId: null,
              authorId: me,
              scores: {},
              attachments,
              stickers: [],
              relatedIds: [],
              createdAt: Date.now(),
              archivedAt: null,
            },
            ...s.items,
          ],
        })),
      updateItem: (id, patch) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        })),
      removeItem: (id) =>
        mutate((s) => ({
          ...s,
          items: s.items
            .filter((it) => it.id !== id && it.parentId !== id)
            .map((it) => ({
              ...it,
              relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== id),
            })),
          comments: s.comments.filter((c) => c.itemId !== id),
        })),
      moveItem: (id, lane, sprintId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === id
              ? {
                  ...it,
                  lane,
                  sprintId: sprintId === undefined ? it.sprintId : sprintId,
                  archivedAt: lane === 'archive' ? Date.now() : null,
                }
              : it,
          ),
        })),
      pullToSprint: (id) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === id ? { ...it, lane: 'todo', sprintId: weekId, archivedAt: null } : it,
          ),
        })),
      carryOver: (id) =>
        mutate((s) => {
          const next = nextMonday(weekId)
          const withSprint = ensureNext(s)
          return {
            ...withSprint,
            items: withSprint.items.map((it) =>
              it.id === id ? { ...it, lane: 'todo', sprintId: next, archivedAt: null } : it,
            ),
          }
        }),
      decompose: (id, titles) =>
        mutate((s) => {
          const parent = s.items.find((it) => it.id === id)
          if (!parent) return s
          const children: Item[] = titles
            .map((t) => t.trim())
            .filter(Boolean)
            .map((title) => ({
              id: uid(),
              title,
              body: `Часть задачи: ${parent.title}`,
              lane: 'todo',
              sprintId: parent.sprintId ?? weekId,
              parentId: parent.id,
              assigneeId: null,
              authorId: me,
              scores: { ...parent.scores },
              attachments: [],
              stickers: [],
              relatedIds: [],
              createdAt: Date.now(),
              archivedAt: null,
            }))
          return {
            ...s,
            items: s.items.map((it) =>
              it.id === id
                ? { ...it, lane: it.lane === 'inbox' ? 'backlog' : it.lane }
                : it,
            ).concat(children),
          }
        }),
      linkTasks: (id, titles) =>
        mutate((s) => {
          const origin = s.items.find((it) => it.id === id)
          if (!origin) return s
          let items = s.items.map((it) => ({
            ...it,
            relatedIds: it.relatedIds ?? [],
          }))
          for (const raw of titles) {
            const title = raw.trim()
            if (!title) continue
            let other = items.find(
              (it) => it.id !== id && it.title.toLowerCase() === title.toLowerCase(),
            )
            if (!other) {
              other = {
                id: uid(),
                title,
                body: '',
                lane: origin.lane === 'inbox' ? 'backlog' : origin.lane,
                sprintId: origin.sprintId,
                parentId: null,
                relatedIds: [],
                assigneeId: null,
                authorId: me,
                scores: {},
                attachments: [],
                stickers: [],
                createdAt: Date.now(),
                archivedAt: null,
              }
              items = [...items, other]
            }
            const otherId = other.id
            items = items.map((it) => {
              if (it.id === id && !it.relatedIds.includes(otherId)) {
                return { ...it, relatedIds: [...it.relatedIds, otherId] }
              }
              if (it.id === otherId && !it.relatedIds.includes(id)) {
                return { ...it, relatedIds: [...it.relatedIds, id] }
              }
              return it
            })
          }
          return { ...s, items }
        }),
      unlinkTask: (id, otherId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id === id) {
              return { ...it, relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== otherId) }
            }
            if (it.id === otherId) {
              return { ...it, relatedIds: (it.relatedIds ?? []).filter((rid) => rid !== id) }
            }
            return it
          }),
        })),
      setScore: (itemId, criterionId, value) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id !== itemId) return it
            const scores = { ...it.scores }
            if (value == null) delete scores[criterionId]
            else scores[criterionId] = value
            return { ...it, scores }
          }),
        })),
      addComment: (itemId, text) =>
        mutate((s) => ({
          ...s,
          comments: [
            ...s.comments,
            {
              id: uid(),
              itemId,
              authorId: me,
              text: text.trim(),
              createdAt: Date.now(),
            },
          ],
        })),
      addCriterion: () =>
        mutate((s) => ({
          ...s,
          criteria: [
            ...s.criteria,
            {
              id: uid(),
              name: 'Новый критерий',
              weight: 1,
              invert: false,
              hint: '',
              max: 3,
              step: 0.5,
            },
          ],
        })),
      updateCriterion: (id, patch) =>
        mutate((s) => ({
          ...s,
          criteria: s.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeCriterion: (id) =>
        mutate((s) => ({
          ...s,
          criteria: s.criteria.filter((c) => c.id !== id),
        })),
      closeSprint: () =>
        mutate((s) => {
          const next = nextMonday(weekId)
          const withSprint = ensureNext(s)
          return {
            ...withSprint,
            sprints: withSprint.sprints.map((sp) =>
              sp.id === weekId ? { ...sp, closed: true } : sp,
            ),
            items: withSprint.items.map((it) => {
              if (it.sprintId !== weekId || it.lane === 'archive') return it
              if (it.lane === 'done') {
                return { ...it, lane: 'archive' as const, archivedAt: Date.now() }
              }
              return { ...it, lane: 'todo' as const, sprintId: next, archivedAt: null }
            }),
          }
        }),
      rollWeekRoles: () =>
        mutate((s) => {
          const roles = rollRoles(s.members.map((member) => member.id))
          const withCurrentWeek = withWeek(s, weekId)
          return {
            ...withCurrentWeek,
            roles: liveWeek ? roles : withCurrentWeek.roles,
            sprints: withCurrentWeek.sprints.map((sprint) =>
              sprint.id === weekId ? { ...sprint, roles } : sprint,
            ),
          }
        }),
      stickSticker: (itemId, sticker, place, from) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            let stickers = [...(it.stickers ?? [])]
            if (from && it.id === from.itemId) {
              stickers = stickers.filter((st) => st.id !== from.placedId)
            }
            if (it.id === itemId) {
              stickers = [
                ...stickers.filter((st) => st.id !== from?.placedId),
                {
                  id: from?.placedId ?? uid(),
                  sticker,
                  by: me,
                  x: place.x,
                  y: place.y,
                  rot: from?.rot ?? place.rot,
                  scale: from?.scale ?? place.scale,
                },
              ]
            }
            return { ...it, stickers }
          }),
        })),
      peelSticker: (itemId, placedId) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === itemId
              ? { ...it, stickers: (it.stickers ?? []).filter((st) => st.id !== placedId) }
              : it,
          ),
        })),
      toggleReaction: (itemId, sticker) =>
        mutate((s) => ({
          ...s,
          items: s.items.map((it) => {
            if (it.id !== itemId) return it
            const existing = (it.stickers ?? []).find(
              (placed) => placed.sticker === sticker && placed.by === me,
            )
            return {
              ...it,
              stickers: existing
                ? it.stickers.filter((placed) => placed.id !== existing.id)
                : [
                    ...(it.stickers ?? []),
                    { id: uid(), sticker, by: me, x: 50, y: 50, rot: 0, scale: 1 },
                  ],
            }
          }),
        })),
      scoreOf: (item) => itemScore(item, view.criteria),
    }
  }, [mutate, state, me, weekId, liveWeek])

  if (!api) {
    return <div className="boot">Собираем доску…</div>
  }

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}
