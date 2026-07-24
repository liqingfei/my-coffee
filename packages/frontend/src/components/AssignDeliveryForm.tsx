import { useState } from "react";
import { useDeliveryAssign } from "../hooks/useDeliveryAssign";

// 分配配送员表单（共享组件）：收编 assignName 状态 + 输入框 + 提交 + 错误提示。
// DeliveryPage / OrderDetailPage 共用（Scene 6 审查 B：消除逐字复制的 ~20 行重复 UI）。
// data-testid 契约保持不变（delivery-assign-input / delivery-assign-submit），QA E2E 零调整。
export function AssignDeliveryForm({
  deliveryId,
  onChanged,
}: {
  deliveryId: number;
  onChanged: () => void;
}) {
  const [assignName, setAssignName] = useState("");
  const { assign, assigning, error: assignError } = useDeliveryAssign(onChanged);

  return (
    <div className="form-block">
      {assignError && <p className="error">{assignError}</p>}
      <input
        className="person-input"
        data-testid="delivery-assign-input"
        aria-label="分配配送员姓名"
        placeholder="分配配送员姓名"
        value={assignName}
        onChange={(e) => setAssignName(e.target.value)}
      />{" "}
      <button
        type="button"
        className="btn"
        data-testid="delivery-assign-submit"
        disabled={assigning || !assignName.trim()}
        onClick={() => {
          assign(deliveryId, assignName);
          setAssignName("");
        }}
      >
        {assigning ? "分配中…" : "分配配送员"}
      </button>
    </div>
  );
}
