export function TaskNumber({ number }: { number?: number }) {
  return (
    <span
      className="task-number"
      aria-label={
        number
          ? `Номер задачи: #${number}`
          : 'Номер будет присвоен после сохранения'
      }
      title="Номер задачи для команд агенту"
    >
      {number ? `#${number}` : 'Сохраняется…'}
    </span>
  )
}
