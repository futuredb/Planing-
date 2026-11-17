import { createHash } from 'node:crypto'
import { z } from 'zod'

export const buckets = ['take-next', 'need-finish', 'research-next', 'automate', 'need-clarify']
export function researchStopMessage(reason) {
  if (reason === 'planning_token_budget') return 'Достигнут лимит подготовки плана. Анализ источников не выполнен, рекомендация не сформирована. Материалы сохранены; можно разобрать их в чате или оценить задачу вручную.'
  if (['token_budget','analysis_token_budget','validation_token_budget','model_budget','time_budget','OPENROUTER_ATTEMPT_BUDGET'].includes(reason)) return 'Исследование остановлено по лимиту. Проверенных оснований для рекомендации пока нет. Материалы сохранены; доступна ручная оценка.'
  return null
}
const text = (max = 1600) => z.string().trim().min(1).max(max)
export const contextSchema = z.object({
  audience: text(500), goal: text(1000), geography: text(300),
  horizon: z.enum(['1–3 месяца', '3–6 месяцев', '6–12 месяцев']),
}).strict()
export const startSchema = z.object({
  requestId: z.uuid(), title: z.string().min(1).max(500), body: z.string().max(12000), context: contextSchema.default({audience:"Из описания задачи",goal:"Оценить перспективу и ближайший шаг",geography:"Не задана",horizon:"3–6 месяцев"}),
}).strict()
export const confirmationSchema = z.object({
  requestId: z.uuid(), jobId: z.uuid(), scores: z.record(z.string(), z.number().finite()),
  matrixBucket: z.enum(buckets), comment: z.string().trim().max(2000),
}).strict()
export const recommendationSchema = z.object({
  potential: z.enum(['high', 'medium', 'low', 'unknown']),
  confidence: z.enum(['strong', 'moderate', 'weak']),
  summary: text(), timing: text(), nextStep: text(),
  reasons: z.array(z.object({ text: text(), evidenceIds: z.array(text(100)).min(1).max(8) }).strict()).min(1).max(5),
  limitations: z.array(text()).min(1).max(8),
  scores: z.array(z.object({ criterionId: text(200), value: z.number().finite().nullable(), reason: text() }).strict()).max(30),
  matrixBucket: z.enum(buckets),
}).strict()

export function snapshot(item, criteria) {
  return { title: item.title, body: item.body, ...(item.priorityScore !== undefined ? {priorityScore:item.priorityScore} : {}), scores: item.scores, matrixBucket: item.matrixBucket ?? null,
    criteria: criteria.map(({ id, name, max, step, invert, hint, weight }) => ({ id, name, max, step, invert, hint, weight })) }
}
export function fingerprint(value) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function validScore(value, criterion) {
  return Number.isFinite(value) && value >= 0 && value <= criterion.max &&
    Math.abs(value / criterion.step - Math.round(value / criterion.step)) < 1e-7
}
export function validatedRecommendation(raw, criteria, evidence) {
  const result = recommendationSchema.parse(raw)
  const ids = new Set(evidence.map(row => row.id))
  if (result.reasons.some(reason => reason.evidenceIds.some(id => !ids.has(id)))) throw new Error('UNSUPPORTED_RECOMMENDATION')
  const seen = new Set()
  for (const entry of result.scores) {
    const criterion = criteria.find(c => c.id === entry.criterionId)
    if (!criterion || seen.has(entry.criterionId) || (entry.value !== null && (!validScore(entry.value, criterion) || criterion.invert))) {
      throw new Error('INVALID_RECOMMENDATION_SCORES')
    }
    seen.add(entry.criterionId)
  }
  return result
}

export function evidencePacket(run) {
  const claims = (run.sections ?? []).filter(s => s.analysisStatus === 'complete').flatMap(s => s.claims ?? []).slice(0,20)
  const cited = new Set(claims.flatMap(c => c.evidenceIds ?? []))
  const sources = new Map((run.sources ?? []).map(s => [s.id, s]))
  const evidence = (run.evidence ?? []).filter(e => cited.has(e.id) && sources.has(e.sourceId)).slice(0,24).flatMap(e => {
    const source = sources.get(e.sourceId)
    let url
    try { url = new URL(source.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [] } catch { return [] }
    return [{ id: e.id, quote: String(e.quote ?? '').slice(0,1000), observation: String(e.observation ?? '').slice(0,1200),
      title: String(source.title || url.hostname).slice(0,500), url: url.href,
      retrievedAt: source.retrievedAt ?? null, publishedAt: source.publishedAt ?? source.publishedHint ?? null,
      dataPeriod: e.metadata?.dataPeriod ?? null }]
  })
  const allowed = new Set(evidence.map(e => e.id))
  return { claims: claims.filter(c => c.evidenceIds?.length && c.evidenceIds.every(id => allowed.has(id))), evidence }
}
