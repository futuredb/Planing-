export function criteriaScore(scores: Record<string, number>, criteria: {id:string;max:number;invert:boolean}[]): number | null
export const REVIEW_PERIOD_MS: number
export function reviewDate(job: {status:string;completedAt?:number;createdAt:number} | null | undefined): number | null
export const REVIEW_GRACE_MS: number
export function backlogBucket(item: {priorityScore?:number;scores:Record<string,number>;matrixBucket?:string|null}, criteria: {id:string;max:number;invert:boolean}[]): string | null
export function priorityReviewState(item: {lane:string;createdAt:number;trendwatchDecision?:{confirmedAt:number};priorityReview?:{reviewedAt:number;returnedAt?:number;reason?:string;previousBucket?:string|null}}, firstReadyAt?:number, now?:number): {dueAt:number;needsDecision:boolean;returnAt:number;returnedAt:number|null;reason:string|null;previousBucket:string|null}
