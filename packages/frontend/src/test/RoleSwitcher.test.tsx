import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RoleSwitcher } from "../components/RoleSwitcher";
import { useRole } from "../hooks/useRole";

// 探针：把当前 role/person 渲染出来，便于断言 RoleSwitcher 写 URL 的副作用
function Probe() {
  const { role, person } = useRole();
  return <div data-testid="probe">{`${role}:${person}`}</div>;
}

function renderAt(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <RoleSwitcher />
      <Probe />
    </MemoryRouter>,
  );
}

function setupRouter(children: ReactNode, entry = "/") {
  return render(<MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>);
}

describe("RoleSwitcher", () => {
  it("渲染容器与三个角色按钮（data-testid 契约）", () => {
    setupRouter(<RoleSwitcher />);
    expect(screen.getByTestId("role-switcher")).toBeInTheDocument();
    expect(screen.getByTestId("role-admin")).toBeInTheDocument();
    expect(screen.getByTestId("role-courier")).toBeInTheDocument();
    expect(screen.getByTestId("role-customer")).toBeInTheDocument();
  });

  it("默认 admin 高亮，无姓名输入框", () => {
    renderAt("/");
    expect(screen.getByTestId("role-admin")).toHaveClass("active");
    expect(screen.getByTestId("probe")).toHaveTextContent("admin:");
    expect(screen.queryByTestId("delivery-person-input")).not.toBeInTheDocument();
  });

  it("切到 courier：出现姓名输入框，输入写入 ?person=", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(screen.getByTestId("role-courier"));
    expect(screen.getByTestId("probe")).toHaveTextContent("courier:");

    const input = screen.getByTestId("delivery-person-input");
    await user.type(input, "张三");
    expect(screen.getByTestId("probe")).toHaveTextContent("courier:张三");
  });

  it("从 courier 切到 customer：person 被清空、输入框消失", async () => {
    const user = userEvent.setup();
    renderAt("/?role=courier&person=张三");
    expect(screen.getByTestId("probe")).toHaveTextContent("courier:张三");

    await user.click(screen.getByTestId("role-customer"));
    expect(screen.getByTestId("probe")).toHaveTextContent("customer:");
    expect(screen.queryByTestId("delivery-person-input")).not.toBeInTheDocument();
  });
});
