import { forwardRef, type SelectHTMLAttributes } from 'react'
import { Icon } from './Icon'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <span className="select-control">
        <select
          ref={ref}
          className={className}
          {...props}
        />
        <Icon name="down" size={16} className="select-control-icon" />
      </span>
    )
  },
)
