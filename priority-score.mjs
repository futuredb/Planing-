/** Existing backlog formula; shared by the server and browser. */
export function criteriaScore(scores, criteria) {
  let plus = 0, count = 0, penalty = 1
  for (const c of criteria) {
    const raw = scores[c.id]
    if (raw == null) continue
    const n = Math.min(c.max || 5, Math.max(0, raw)) / (c.max || 5)
    if (c.invert) penalty *= 1 - n
    else { plus += n; count++ }
  }
  return count ? Math.round(plus / count * penalty * 100) / 10 : null
}
export const REVIEW_PERIOD_MS = 30 * 24 * 60 * 60 * 1000
export const reviewDate = job => job?.status === 'ready' ? (job.completedAt ?? job.createdAt) + REVIEW_PERIOD_MS : null

export const REVIEW_GRACE_MS = 14 * 24 * 60 * 60 * 1000
export function backlogBucket(item, criteria) {
  const score = item.priorityScore ?? criteriaScore(item.scores, criteria)
  return score == null || score <= 0 ? null : item.matrixBucket ?? null
}
export function priorityReviewState(item, firstReadyAt, now = Date.now()) {
  const reviewedAt = item.priorityReview?.reviewedAt ?? item.trendwatchDecision?.confirmedAt ?? firstReadyAt ?? item.createdAt
  const dueAt = reviewedAt + REVIEW_PERIOD_MS
  return { dueAt, needsDecision: item.lane === 'backlog' && now >= dueAt,
    returnAt: dueAt + REVIEW_GRACE_MS, returnedAt: item.priorityReview?.returnedAt ?? null,
    reason: item.priorityReview?.reason ?? null, previousBucket: item.priorityReview?.previousBucket ?? null }
}
