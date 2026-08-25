import { roleById, type RoleId } from './roles'

export function RoleChip({
  roleId,
  empty = 'роль',
}: {
  roleId?: RoleId | string | null
  empty?: string
}) {
  const role = roleById(roleId)
  if (!role) {
    return <span className="role-chip empty">{empty}</span>
  }
  return (
    <span className={`role-chip role-${role.id}`} title={role.name}>
      #{role.tag}
    </span>
  )
}
