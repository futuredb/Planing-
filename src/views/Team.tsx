import { memberAvatar } from '../Avatar'
import { RoleChip } from '../RoleChip'
import { WEEK_ROLES } from '../roles'
import { useStore } from '../store'

export function Team() {
  const { state, patchMember } = useStore()

  function setPhoto(id: string, file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => patchMember(id, { avatar: String(reader.result) })
    reader.readAsDataURL(file)
  }

  return (
    <section className="page">
      <div className="page-head">
        <h2>Команда · 5 человек</h2>
        <p>
          Роли недели общие для всех: кубик в шапке раскидывает их заново. Имена
          и фото — здесь. Клик по фото в шапке — «я пишу от этого человека».
        </p>
      </div>

      <ul className="role-guide">
        {WEEK_ROLES.map((role) => (
          <li key={role.id}>
            <RoleChip roleId={role.id} />
            <div>
              <strong>{role.name}</strong>
              <p>{role.hint}</p>
            </div>
          </li>
        ))}
      </ul>

      <ul className="team">
        {state.members.map((m) => (
          <li key={m.id}>
            <label className="photo-swap">
              <img src={memberAvatar(m)} alt="" />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPhoto(m.id, e.target.files?.[0])}
              />
            </label>
            <input
              value={m.name}
              onChange={(e) => patchMember(m.id, { name: e.target.value })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
