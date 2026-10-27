import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { mondayOf, nextMonday, shiftMonday, uid } from './dates'
import { itemScore, loadRemoteIfNewer, loadState, moveItemRemote, saveMe, saveState } from './storage'
import type { AppState, Attachment, Criterion, Item, Lane } from './types'
import type { StickerId } from './stickers'
import { preserveRoles, rollRoles } from './roles'
import { conflictDetails, mergeBoards } from './merge-state'
import { clearDraft, readDraft, saveDraft } from './draft-storage'
import { StoreContext } from './store-context'

export type Store = {
  state: AppState
  syncStatus: 'saved' | 'saving' | 'retry' | 'error' | 'conflict'
  syncError: string | null
  retrySave: () => void
  weekId: string
  liveWeek: boolean
  shiftWeek: (dir: -1 | 1) => void
  goThisWeek: () => void
  setCurrentMember: (id: string) => void
  patchMember: (id: string, patch: { name?: string; role?: string; avatar?: string }) => void
  assignItem: (itemId: string, memberId: string | null, fromItemId?: string | null) => void
  setGoal: (text: string) => void
  toggleGoalClosed: () => void
  addIdea: (input: {
    title: string
    body: string
    attachments: Attachment[]
    authorId: string | null
  }) => void
  updateItem: (id: string, patch: Partial<Item>) => void
  removeItem: (id: string) => void
  moveItem: (id: string, lane: Lane, sprintId?: string | null) => void
  pullToSprint: (id: string) => void
  carryOver: (id: string) => void
  decompose: (id: string, titles: string[]) => void
  linkTasks: (id: string, titles: string[]) => void
  linkExistingTask: (id: string, otherId: string) => void
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
  return { ...state, updatedAt: Math.max(Date.now(), Number(state.updatedAt) + 1) }
}

type PendingMove = {
  lane: Lane
  sprintId: string | null | undefined
  archivedAt: number | null
  sequence: number
}

class MoveTracker {
  readonly pending = new Map<string, PendingMove>()
  private readonly queues = new Map<string, Promise<void>>()
  private sequence = 0

  enqueue(id: string, operation: () => Promise<void>) {
    const run = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.queues.set(id, run)
    void run.finally(() => { if (this.queues.get(id) === run) this.queues.delete(id) }).catch(() => {})
    return run
  }

  track(id: string, lane: Lane, sprintId?: string | null) {
    const move = {
      lane,
      sprintId,
      archivedAt: lane === 'archive' ? Date.now() : null,
      sequence: ++this.sequence,
    }
    this.pending.set(id, move)
    return move
  }

  acknowledge(id: string, sequence: number) {
    if (this.pending.get(id)?.sequence === sequence) this.pending.delete(id)
  }

  clearApplied(state: AppState) {
    for (const [itemId, move] of this.pending) {
      if (moveMatches(state.items.find((item) => item.id === itemId), move)) {
        this.pending.delete(itemId)
      }
    }
  }
}

function moveMatches(item: Item | undefined, move: PendingMove) {
  if (!item || item.lane !== move.lane) return false
  return move.sprintId === undefined || item.sprintId === move.sprintId
}

function reapplyPendingMoves(state: AppState, moves: Map<string, PendingMove>) {
  let changed = false
  const items = state.items.map((item) => {
    const move = moves.get(item.id)
    if (!move || moveMatches(item, move)) return item
    changed = true
    return {
      ...item,
      lane: move.lane,
      sprintId: move.sprintId === undefined ? item.sprintId : move.sprintId,
      archivedAt: move.archivedAt,
    }
  })
  if (!changed) return state
  return {
    ...state,
    items,
    updatedAt: Math.max(Date.now(), Number(state.updatedAt) + 1),
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [syncStatus, setSyncStatus] = useState<Store['syncStatus']>('saved')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncConflict, setSyncConflict] = useState<{ base: AppState; local: AppState; remote: AppState } | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const saveInFlight = useRef(false)
  const retryCount = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conflictButton = useRef<HTMLButtonElement>(null)
  const latestState = useRef<AppState | null>(null)
  const serverBase = useRef<AppState | null>(null)
  const skipSaveVersion = useRef<number | null>(null)
  const remoteVersion = useRef(0)
  const fullSavePending = useRef(false)
  const fullSaveSequence = useRef(0)
  const pendingDeletedRoots = useRef(new Set<string>())
  const moveTracker = useMemo(() => new MoveTracker(), [])

  useEffect(() => {
    let active = true
    Promise.all([loadState(), readDraft()]).then(([next, draft]) => {
      if (!active) return
      serverBase.current = next
      remoteVersion.current = Number(next.updatedAt) || 0
      setMe(next.currentMemberId)
      if (draft?.base && draft.state) {
        pendingDeletedRoots.current = new Set(draft.deletedRoots ?? [])
        const local = { ...draft.state, currentMemberId: next.currentMemberId }
        const merged = mergeBoards(draft.base, local, next)
        fullSavePending.current = true
        fullSaveSequence.current += 1
        if (merged.conflicts.length) {
          setSyncConflict({ base: draft.base, local, remote: next })
          setSyncStatus('conflict')
          setState(local)
        } else {
          setState(bump(merged.state))
          setSyncStatus('saving')
        }
      } else {
        skipSaveVersion.current = Number(next.updatedAt) || 0
        setState(next)
      }
    }).catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => { latestState.current = state }, [state])

  useEffect(() => { if (syncConflict) conflictButton.current?.focus() }, [syncConflict])

  useEffect(() => {
    if (state && (fullSavePending.current || moveTracker.pending.size) && serverBase.current) saveDraft({ base: serverBase.current, state, deletedRoots: [...pendingDeletedRoots.current] })
  }, [state, moveTracker])

  useEffect(() => {
    function online() {
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = null
      if (fullSavePending.current) setRetryTick((tick) => tick + 1)
    }
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('online', online)
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!state || syncConflict || saveInFlight.current) return
    if (skipSaveVersion.current === Number(state.updatedAt)) {
      skipSaveVersion.current = null
      return
    }
    const timer = setTimeout(() => {
      const submittedAt = state.updatedAt
      const submittedSequence = fullSaveSequence.current
      const base = serverBase.current
      const submittedMoves = new Map(
        [...moveTracker.pending].filter(([itemId, move]) =>
          moveMatches(state.items.find((item) => item.id === itemId), move),
        ),
      )
      saveInFlight.current = true
      setSyncStatus('saving')
      void (async () => {
        let shouldRetry = false
        try {
          const result = await saveState(state, remoteVersion.current, [...pendingDeletedRoots.current])
          if (!result) {
            setSyncStatus('retry')
            shouldRetry = true
            return
          }
          if (result.conflict) {
            const remote = await loadRemoteIfNewer(-1)
            const local = latestState.current
            if (!remote || !local || !base) {
              setSyncStatus('retry')
              shouldRetry = true
              return
            }
            const merged = mergeBoards(base, local, remote)
            if (merged.conflicts.length) {
              setSyncStatus('conflict')
              setSyncConflict({ base, local, remote })
              return
            }
            serverBase.current = remote
            remoteVersion.current = Number(remote.updatedAt) || 0
            fullSavePending.current = true
            setState(bump(reapplyPendingMoves(merged.state, moveTracker.pending)))
            setSyncStatus('saving')
            return
          }
          if (!result.ok) {
            setSyncError(result.error || 'Сервер отклонил сохранение')
            setSyncStatus('error')
            return
          }
          if (result.updatedAt) remoteVersion.current = result.updatedAt
          retryCount.current = 0
          serverBase.current = { ...state, updatedAt: result.updatedAt }
          if (fullSaveSequence.current === submittedSequence) {
            fullSavePending.current = false
            pendingDeletedRoots.current.clear()
            clearDraft()
          }
          for (const [itemId, move] of submittedMoves) moveTracker.acknowledge(itemId, move.sequence)
          if (latestState.current?.updatedAt === submittedAt) setSyncStatus('saved')
          else {
            setSyncStatus('saving')
            shouldRetry = true
          }
        } catch {
          setSyncStatus('retry')
          shouldRetry = true
        } finally {
          saveInFlight.current = false
          if (shouldRetry) {
            const delay = Math.min(30000, 2000 * 2 ** Math.min(retryCount.current++, 4))
            if (retryTimer.current) clearTimeout(retryTimer.current)
            retryTimer.current = setTimeout(() => { retryTimer.current = null; setRetryTick((tick) => tick + 1) }, delay)
          }
        }
      })()
    }, 250)
    return () => clearTimeout(timer)
  }, [state, moveTracker, retryTick, syncConflict])

  useEffect(() => {
    const t = setInterval(() => {
      if (fullSavePending.current) return
      void loadRemoteIfNewer(remoteVersion.current).then((remote) => {
        if (!remote) return
        if (fullSavePending.current) return
        if (Number(remote.updatedAt) < remoteVersion.current) return
        remoteVersion.current = Math.max(remoteVersion.current, Number(remote.updatedAt) || 0)
        serverBase.current = remote
        setMe(remote.currentMemberId)
        const rebased = reapplyPendingMoves(remote, moveTracker.pending)
        skipSaveVersion.current = Number(rebased.updatedAt) || 0
        setState(rebased)
      })
    }, 4000)
    return () => clearInterval(t)
  }, [state?.updatedAt, moveTracker])

  const mutate = useCallback((fn: (prev: AppState) => AppState) => {
    fullSavePending.current = true
    fullSaveSequence.current += 1
    setSyncStatus('saving')
    setSyncError(null)
    setState((prev) => (prev ? bump(fn(prev)) : prev))
  }, [])

  const mutateMove = useCallback((fn: (prev: AppState) => AppState) => {
    const atomicOnly = !fullSavePending.current
    setSyncStatus('saving')
    setState((prev) => {
      if (!prev) return prev
      const next = bump(fn(prev))
      if (atomicOnly) skipSaveVersion.current = next.updatedAt
      return next
    })
    return atomicOnly
  }, [])

  const persistMove = useCallback(
    (
      id: string,
      lane: Lane,
      sprintId: string | null | undefined,
      sequence: number,
      atomicOnly: boolean,
    ) => {
      if (!atomicOnly) return
      void moveTracker.enqueue(id, async () => {
        // Skip queued moves already superseded or saved by the full-state path.
        if (moveTracker.pending.get(id)?.sequence !== sequence) return
        const result = await moveItemRemote(id, lane, sprintId)
        if (!result?.ok) {
          fullSavePending.current = true
          fullSaveSequence.current += 1
          setState((current) => (current ? bump(current) : current))
          return
        }
        moveTracker.acknowledge(id, sequence)
        if (!fullSavePending.current && !moveTracker.pending.size) setSyncStatus('saved')
        const remote = await loadRemoteIfNewer(-1)
        if (!remote || fullSavePending.current) return
        if (Number(remote.updatedAt) < remoteVersion.current) return
        remoteVersion.current = Math.max(remoteVersion.current, Number(remote.updatedAt) || 0)
        serverBase.current = remote
        moveTracker.clearApplied(remote)
        if (!fullSavePending.current && !moveTracker.pending.size) clearDraft()
        const rebased = reapplyPendingMoves(remote, moveTracker.pending)
        skipSaveVersion.current = Number(rebased.updatedAt) || 0
        setMe(remote.currentMemberId)
        setState(rebased)
      })
    },
    [moveTracker],
  )

  const [weekId, setWeekId] = useState(mondayOf)
  const liveWeek = weekId === mondayOf()

  const api = useMemo<Store | null>(() => {
    if (!state || !me) return null
    const memberIds = state.members.map((member) => member.id)
    const sprintRoles = state.sprints.find((sprint) => sprint.id === weekId)?.roles
    const rolesForWeek = preserveRoles(
      sprintRoles && Object.keys(sprintRoles).length
        ? sprintRoles
        : liveWeek && Object.keys(state.roles ?? {}).length
          ? state.roles
          : {},
      memberIds,
    )
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
      syncStatus,
      syncError,
      retrySave: () => { setSyncError(null); setSyncStatus('saving'); setRetryTick((tick) => tick + 1) },
      weekId,
      liveWeek,
      shiftWeek: (dir) => {
        const next = shiftMonday(weekId, dir)
        setWeekId(next)
        if (!state.sprints.some((sprint) => sprint.id === next)) mutate((prev) => withWeek(prev, next))
      },
      goThisWeek: () => {
        const now = mondayOf()
        setWeekId(now)
        if (!state.sprints.some((sprint) => sprint.id === now)) mutate((prev) => withWeek(prev, now))
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
      addIdea: ({ title, body, attachments, authorId }) =>
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
              authorId,
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
      removeItem: (id) => {
        pendingDeletedRoots.current.add(id)
        mutate((s) => {
          const removed = new Set([id])
          let size = 0
          while (size !== removed.size) {
            size = removed.size
            for (const item of s.items) if (item.parentId && removed.has(item.parentId)) removed.add(item.id)
          }
          for (const itemId of removed) moveTracker.pending.delete(itemId)
          return {
            ...s,
            items: s.items.filter((it) => !removed.has(it.id)).map((it) => ({
              ...it, relatedIds: (it.relatedIds ?? []).filter((rid) => !removed.has(rid)),
            })),
            comments: s.comments.filter((c) => !removed.has(c.itemId)),
          }
        })
      },
      moveItem: (id, lane, sprintId) => {
        const move = moveTracker.track(id, lane, sprintId)
        const atomicOnly = mutateMove((s) => ({
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
        }))
        persistMove(id, lane, sprintId, move.sequence, atomicOnly)
      },
      pullToSprint: (id) => {
        const move = moveTracker.track(id, 'todo', weekId)
        const atomicOnly = mutateMove((s) => ({
          ...s,
          items: s.items.map((it) =>
            it.id === id ? { ...it, lane: 'todo', sprintId: weekId, archivedAt: null } : it,
          ),
        }))
        persistMove(id, 'todo', weekId, move.sequence, atomicOnly)
      },
      carryOver: (id) => {
        const next = nextMonday(weekId)
        const move = moveTracker.track(id, 'todo', next)
        const atomicOnly = mutateMove((s) => {
          const withSprint = ensureNext(s)
          return {
            ...withSprint,
            items: withSprint.items.map((it) =>
              it.id === id ? { ...it, lane: 'todo', sprintId: next, archivedAt: null } : it,
            ),
          }
        })
        persistMove(id, 'todo', next, move.sequence, atomicOnly)
      },
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
      linkExistingTask: (id, otherId) =>
        mutate((s) => {
          if (id === otherId || !s.items.some((item) => item.id === id) || !s.items.some((item) => item.id === otherId)) return s
          return { ...s, items: s.items.map((item) => {
            if (item.id === id) return { ...item, relatedIds: [...new Set([...(item.relatedIds ?? []), otherId])] }
            if (item.id === otherId) return { ...item, relatedIds: [...new Set([...(item.relatedIds ?? []), id])] }
            return item
          }) }
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
  }, [mutate, mutateMove, persistMove, state, me, weekId, liveWeek, moveTracker, syncStatus, syncError])

  if (loadError && !state) return <div className="boot"><div className="persona-picker">
    <h1>Не удалось загрузить доску</h1>
    <p>Проверьте соединение и попробуйте снова.</p>
    <button type="button" className="secondary-button" onClick={() => { setLoadError(false); setLoadAttempt((attempt) => attempt + 1) }}>Повторить</button>
  </div></div>
  if (state && !me) {
    return <div className="boot"><div className="persona-picker">
      <h1>Кто вы в команде?</h1>
      <p>Ваше имя будет указано в комментариях и реакциях.</p>
      <div>{state.members.map((member) => <button className="secondary-button" key={member.id} type="button" onClick={() => { saveMe(member.id); setMe(member.id) }}>{member.name}</button>)}</div>
    </div></div>
  }
  // Store callbacks touch synchronization refs only when invoked by an event.
  // oxlint-disable-next-line react/refs
  if (!api) {
    return <div className="boot">Собираем доску…</div>
  }

  function resolveConflict(choice: 'local' | 'remote') {
    if (!syncConflict) return
    const merged = mergeBoards(syncConflict.base, latestState.current ?? syncConflict.local, syncConflict.remote, choice)
    serverBase.current = syncConflict.remote
    remoteVersion.current = Number(syncConflict.remote.updatedAt) || 0
    fullSavePending.current = true
    fullSaveSequence.current += 1
    moveTracker.pending.clear()
    setState(bump(merged.state))
    setSyncConflict(null)
    setSyncStatus('saving')
  }

  return <StoreContext.Provider value={api}>
    {children}
    {syncConflict ? <div className="confirm-backdrop"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-conflict-title">
      <h2 id="sync-conflict-title">Изменения пересеклись</h2>
      <p>Кто-то изменил те же данные. Выберите, какую версию сохранить. Остальные изменения будут объединены.</p>
      <div className="conflict-details">
        {conflictDetails(syncConflict.base, syncConflict.local, syncConflict.remote).slice(0, 5).map((item) => <div key={item.path}>
          <strong>{item.label}</strong>
          <p><b>У вас:</b> {item.local}</p>
          <p><b>У команды:</b> {item.remote}</p>
        </div>)}
      </div>
      <div className="dialog-actions">
        <button ref={conflictButton} type="button" className="secondary-button" onClick={() => resolveConflict('remote')}>Версия команды</button>
        <button type="button" className="primary-button" onClick={() => resolveConflict('local')}>Моя версия</button>
      </div>
    </div></div> : null}
  </StoreContext.Provider>
}
