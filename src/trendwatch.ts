import { fetchBoard } from './portal-session'
import type { Criterion, Item, MatrixBucket } from './types'

export type ResearchContext = { audience: string; goal: string; geography: string; horizon: string }
export type ResearchJob = {
  failure?: {code:string;phase?:string;elapsedMs?:number;httpStatus?:number;responseStatus?:string;incompleteReason?:string;networkCode?:string;validationCode?:string;assessmentKind?:string;selectedKind?:string;searchOutcome?:string;webCalls?:number;webQueries?:number;sourceCount?:number;citationUrlCount?:number;searchResultUrlCount?:number;verifiedUrlCount?:number;sourceIssues?:{index:number;reason:string}[];routingIssues?:string[];regionalIssues?:string[];outputTokens?:number;answerFormat?:string;parseIssue?:string;reasoningTokens?:number;outputItems?:number;assistantMessages?:number;textParts?:number;answerBytes?:number;schemaIssueCount?:number;schemaIssues?:{field:string;code:string}[]} | null
  priorityPolicy?:'concept-mvp-v1'|'business-v2'|'business-v3'|'criteria-v1'|'criteria-v2'
  comparisonCurrent?:boolean
  evidencePolicy?:'adaptive-signals-v4'|'adaptive-signals-v3'|'adaptive-signals-v2'|'adaptive-signals-v1'|'idea-relevance-v1'|'independent-signals-v1'|'regional-signals-v1'|'regional-signals-v2'|'regional-signals-v3'|'regional-signals-v4'
  webSearch?:boolean; searchOutcome?:'found'|'insufficient'|'not_needed'; webUsage?:{calls:number;queries:number}
  id: string; automatic?: boolean; status: 'waiting' | 'queued' | 'running' | 'awaiting_review' | 'ready' | 'insufficient' | 'failed' | 'cancelled' | 'interrupted'
  format?: 'quick-v1'; boardContext?: {total:number;items:{id:string;title:string;body:string;lane:Item['lane']}[]}
  mode?: 'runtime' | 'assisted' | 'codex' | 'openrouter'; packetHash?: string; sourceJobId?: string; sourceCount?: number; sourceMessage?: string | null
  commentContext?:{items:{text:string;createdAt:number}[];total:number;truncated:boolean;fingerprint:string}
  reviewAt?:number|null; reviewDue?:boolean
  stage: string; createdAt: number; completedAt?: number; context: ResearchContext; stale: boolean; message: string | null
  snapshot: { title: string; body: string; scores: Record<string, number>; criteria: Criterion[] }
  recommendation: null | {summary:string;verdict:'recommend'|'clarify'|'defer';score:number|null;matrixBucket?:MatrixBucket|null;assessmentKind?:'bug'|'internal_improvement'|'market_idea'|'approach_research';preliminary?:boolean;decisionValue?:string;comparison?:{status:'advantage'|'equal'|'behind'|'insufficient';itemIds:string[];reason:string};rationale?:string;regionalApplicability?:{status:'supported'|'conditional'|'unknown';summary:string;sourceUrls:string[]};limitations?:string;evidenceStrength?:'limited'|'moderate'|'strong';scores?:{criterionId:string;value:number|null;reason:string;assumed?:boolean;basis?:{kind:string;ref:string;quote:string}[]}[];relatedTasks:{itemId:string;reason:string}[]} | {
    potential: 'high' | 'medium' | 'low' | 'unknown'; confidence: 'strong' | 'moderate' | 'weak'
    summary: string; timing: string; nextStep: string; limitations: string[]
    reasons: { text: string; evidenceIds: string[] }[]
    scores: { criterionId: string; value: number | null; reason: string }[]
    matrixBucket: MatrixBucket
  }
  evidence: { origin?:string;relevance?:'direct'|'analogy';limitation?:string;applicability?:string; signalType?:string; id: string; quote: string; observation: string; title: string; url: string; retrievedAt: string | null; publishedAt: string | null }[]
  decision: Item['trendwatchDecision'] | null
}
export type PriorityReview = {dueAt:number;needsDecision:boolean;returnAt:number;returnedAt:number|null;reason:string|null;previousBucket:MatrixBucket|null}
export type ResearchState = { offline?: boolean; review?:PriorityReview; available: boolean; automatic?: boolean; mode: 'runtime' | 'assisted' | 'codex' | 'openrouter'; configurationMessage: string | null; job: ResearchJob | null }
export async function researchRequest<T>(itemId: string, action = '', init?: RequestInit): Promise<T> {
  const response = await fetchBoard(`/api/items/${encodeURIComponent(itemId)}/trendwatch${action}`, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Не удалось получить состояние исследования. Задача сохранена.')
  return data as T
}
export const matrixOptions = [
  {value:'research-next',label:'Что исследовать дальше'}, {value:'take-next',label:'Берём следующим'},
  {value:'need-finish',label:'Нужно закончить'}, {value:'automate',label:'Что стоит автоматизировать'},
  {value:'need-clarify',label:'Нужно прояснить'},
]
