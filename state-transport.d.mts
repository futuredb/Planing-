import type { Board } from './state-repository.mjs'
type Attachment = { id: string; name: string; mime: string; dataUrl: string }
export function stateForClient(state: Board | null): Board | null
export function findAttachment(state: Board | null, id: string): Attachment | null
export function decodeImageDataUrl(dataUrl: string): { mime: string; body: Buffer; inline: boolean } | null
