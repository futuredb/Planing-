import { memberAvatar } from '../member'
import { RoleChip } from '../RoleChip'
import { roleById } from '../roles'
import { useStore } from '../store-context'
import { Icon } from '../ui/Icon'

export function Team({ onShuffle }: { onShuffle: () => void }) {
  const { state, patchMember } = useStore()

  function setPhoto(id: string, file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => patchMember(id, { avatar: String(reader.result) })
    reader.readAsDataURL(file)
  }

  return (
    <section className="page">
      <div className="page-head page-head-actions">
        <div>
          <span className="eyebrow">Состав и роли</span>
          <h1>Команда</h1>
          <p>
            {state.members.length} человек · роли распределяются на планировании во вторник
            и остаются закреплёнными на всю неделю.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onShuffle}>
          <Icon name="dice" />
          Перемешать роли…
        </button>
      </div>

      <ul className="team-list">
        {state.members.map((member) => {
          const role = roleById(state.roles?.[member.id])
          return (
            <li key={member.id}>
              <label className="photo-swap" title="Заменить фото">
                <img src={memberAvatar(member)} alt="" />
                <span><Icon name="image" size={16} /></span>
                <input type="file" accept="image/*" onChange={(event) => setPhoto(member.id, event.target.files?.[0])} />
              </label>
              <div className="member-fields">
                <label>
                  <span className="field-label">Имя</span>
                  <input value={member.name} onChange={(event) => patchMember(member.id, { name: event.target.value })} />
                </label>
                <div className="role-assignment">
                  <RoleChip roleId={state.roles?.[member.id]} />
                  <p className="role-description">{role?.hint ?? 'Роль пока не распределена.'}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
