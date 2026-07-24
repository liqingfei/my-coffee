import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useRole } from "../hooks/useRole";

// useRole 以 URL search params 为唯一事实源，测试用 MemoryRouter 提供路由上下文，
// 通过 initialEntries 注入初始 ?role=&person=。
function wrapperAt(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

describe("useRole", () => {
  it("无参数：默认 admin，person 为空", () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapperAt("/") });
    expect(result.current.role).toBe("admin");
    expect(result.current.person).toBe("");
  });

  it("从 URL 读取 role/person", () => {
    const { result } = renderHook(() => useRole(), {
      wrapper: wrapperAt("/?role=courier&person=张三"),
    });
    expect(result.current.role).toBe("courier");
    expect(result.current.person).toBe("张三");
  });

  it("非法 role 回退到 admin", () => {
    const { result } = renderHook(() => useRole(), {
      wrapper: wrapperAt("/?role=hacker"),
    });
    expect(result.current.role).toBe("admin");
  });

  it("setRole 切换角色：切到非 courier 时清掉 person", () => {
    const { result } = renderHook(() => useRole(), {
      wrapper: wrapperAt("/?role=courier&person=张三"),
    });
    act(() => result.current.setRole("customer"));
    expect(result.current.role).toBe("customer");
    expect(result.current.person).toBe("");
  });

  it("setPerson 设置姓名（隐含 courier）：空串移除 person", () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapperAt("/") });
    act(() => result.current.setPerson("李四"));
    expect(result.current.role).toBe("courier");
    expect(result.current.person).toBe("李四");

    act(() => result.current.setPerson(""));
    expect(result.current.role).toBe("courier");
    expect(result.current.person).toBe("");
  });
});
