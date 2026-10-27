export const portalLoginUrl = 'https://future-db.ru/login?next=%2Fopen%2Ffunban'
let actorId: string | null = null

export async function fetchBoard(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, redirect: 'manual' })
  const nextActor = response.headers.get('X-Funban-Actor-Id')
  if (response.status === 401 || response.type === 'opaqueredirect' ||
      (actorId && nextActor && actorId !== nextActor)) {
    window.dispatchEvent(new Event('funban-auth-required'))
    throw new Error('Сессия портала завершилась. Войдите снова.')
  }
  if (nextActor) actorId = nextActor
  return response
}
