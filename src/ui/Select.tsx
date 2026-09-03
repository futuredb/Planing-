import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className = '',
}: {
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const firstEnabledIndex = options.findIndex((option) => !option.disabled)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : firstEnabledIndex,
  )
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setKeyboardOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function openMenu(fromKeyboard: boolean) {
    if (disabled) return
    setKeyboardOpen(fromKeyboard)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex)
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
    setKeyboardOpen(false)
  }

  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value)
    closeMenu()
    triggerRef.current?.focus()
  }

  function moveActive(direction: -1 | 1) {
    if (!options.length) return
    let next = activeIndex
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length
      if (!options[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu(true)
        return
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) openMenu(true)
      const ordered = event.key === 'Home' ? options : [...options].reverse()
      const option = ordered.find((entry) => !entry.disabled)
      if (option) setActiveIndex(options.indexOf(option))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else openMenu(true)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (event.key === 'Tab') closeMenu()
  }

  return (
    <div
      ref={rootRef}
      className={`select-control${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
      data-keyboard={keyboardOpen ? 'true' : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu(false))}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? 'Не выбрано'}</span>
        <Icon name="down" size={16} className="select-chevron" />
      </button>
      <div
        id={listboxId}
        className="select-popover"
        role="listbox"
        aria-label={ariaLabel}
        aria-hidden={!open}
      >
        {options.map((option, index) => {
          const isSelected = option.value === value
          return (
            <button
              key={option.value}
              id={`${listboxId}-${index}`}
              type="button"
              className="select-option"
              role="option"
              aria-selected={isSelected}
              disabled={option.disabled}
              data-active={activeIndex === index ? 'true' : undefined}
              tabIndex={-1}
              onPointerEnter={() => !option.disabled && setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {isSelected ? <Icon name="check" size={15} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
