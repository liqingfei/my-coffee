import { useRole } from "../hooks/useRole";
import type { Role } from "../types";
import { ROLE_LABEL } from "../types";

const ROLES: Role[] = ["admin", "courier", "customer"];

// 全局角色切换器（UI 角色模拟，本期无真实认证）。状态写 URL（useRole）。
// courier 模式额外渲染姓名输入框（写 ?person=），作为配送员身份来源。
// data-testid 契约：容器 role-switcher / 按钮 role-{admin|courier|customer} / 输入框 delivery-person-input。
export function RoleSwitcher() {
  const { role, person, setRole, setPerson } = useRole();
  return (
    <div className="role-switcher" data-testid="role-switcher">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          data-testid={`role-${r}`}
          className={role === r ? "chip active" : "chip"}
          onClick={() => setRole(r)}
        >
          {ROLE_LABEL[r]}
        </button>
      ))}
      {role === "courier" && (
        <input
          className="person-input"
          data-testid="delivery-person-input"
          aria-label="配送员姓名"
          placeholder="配送员姓名"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
      )}
    </div>
  );
}
