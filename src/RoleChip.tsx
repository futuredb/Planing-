import { chipStickerPose, roleById, type RoleId } from './roles'

export function RoleChip({
  roleId,
  empty = 'роль',
  sticker,
}: {
  roleId?: RoleId | string | null
  empty?: string
  sticker?: string
}) {
  const role = roleById(roleId)
  const pose = sticker ? chipStickerPose(sticker) : null
  const className = `role-chip${role ? ` role-${role.id}` : ' empty'}${sticker ? ' on-face' : ''}`

  return (
    <span
      className={className}
      title={role ? `${role.name}: ${role.hint}` : undefined}
      style={
        pose
          ? {
              top: pose.top ? '-5px' : 'auto',
              bottom: pose.top ? 'auto' : '-5px',
              left: '50%',
              transform: `translateX(calc(-50% + ${pose.shift}px)) rotate(${pose.rot}deg)`,
            }
          : undefined
      }
    >
      {role ? role.tag : empty}
    </span>
  )
}
