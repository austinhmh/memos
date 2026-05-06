import { useRef } from "react";
import { useMemoViewContext, useMemoViewDerived } from "@/components/MemoView/MemoViewContext";
import { Checkbox } from "@/components/ui/checkbox";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { toggleTaskAtIndex } from "@/utils/markdown-manipulation";

interface CheckboxRendererProps {
  checked: boolean;
  taskIndex: number;
  children: React.ReactNode;
}

export const CheckboxRenderer: React.FC<CheckboxRendererProps> = ({ checked, taskIndex, children }) => {
  const { memo } = useMemoViewContext();
  const { readonly } = useMemoViewDerived();
  const checkboxRef = useRef<HTMLButtonElement>(null);
  const { mutate: updateMemo } = useUpdateMemo();

  const handleChange = async (newChecked: boolean) => {
    if (readonly || !memo) return;

    const newContent = toggleTaskAtIndex(memo.content, taskIndex, newChecked);
    updateMemo({
      update: { name: memo.name, content: newContent },
      updateMask: ["content"],
    });
  };

  return (
    <li className={`task-list-item ${checked ? "checked" : ""}`} data-task-index={taskIndex}>
      <Checkbox ref={checkboxRef} checked={checked} disabled={readonly} onCheckedChange={handleChange} />
      <span className={checked ? "line-through opacity-60" : ""}>{children}</span>
    </li>
  );
};
