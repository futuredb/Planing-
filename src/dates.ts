export function uid() {
  return crypto.randomUUID()
}

export function mondayOf(date = new Date()) {
  const x = new Date(date)
  const day = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return isoDate(x)
}

export function nextMonday(weekStart: string) {
  return shiftMonday(weekStart, 1)
}

export function shiftMonday(weekStart: string, weeks: number) {
  const x = new Date(`${weekStart}T00:00:00`)
  x.setDate(x.getDate() + weeks * 7)
  return isoDate(x)
}

export function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekLabel(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return `${fmt(start)} — ${fmt(end)}`
}

const SPRINT_SWEETS = [
  'Тирамису',
  'Наполеон',
  'Эклер',
  'Медовик',
  'Чизкейк',
  'Панна-котта',
  'Макарон',
  'Безе',
  'Зефир',
  'Пастила',
  'Пряник',
  'Штрудель',
  'Круассан',
  'Профитроль',
  'Трюфель',
  'Пралине',
  'Ирис',
  'Халва',
  'Мармелад',
  'Карамель',
  'Козинак',
  'Чуррос',
  'Брауни',
  'Фондан',
  'Крем-брюле',
  'Суфле',
  'Павлова',
  'Чурчхела',
  'Ватрушка',
  'Пончик',
  'Капкейк',
  'Маффин',
  'Тарт',
  'Меренга',
  'Пломбир',
  'Сорбе',
  'Канноли',
  'Баба',
  'Птичье молоко',
  'Мусс',
  'Парфе',
  'Корзиночка',
  'Чак-чак',
  'Баклава',
  'Кнафе',
  'Шарлотка',
  'Коврижка',
  'Трубочка',
  'Картошка',
  'Анна Павлова',
  'Прага',
  'Киевский',
  'Эскимо',
  'Рахат-лукум',
  'Щербет',
  'Леденец',
  'Вафля',
  'Сырники',
  'Белевская пастила',
]

export function sprintName(weekStart: string) {
  let h = 2166136261
  for (let i = 0; i < weekStart.length; i++) {
    h ^= weekStart.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return SPRINT_SWEETS[(h >>> 0) % SPRINT_SWEETS.length]
}
