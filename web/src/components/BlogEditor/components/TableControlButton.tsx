import type { CSSProperties, ReactNode } from "react";

type Props = {
  className: string;
  label: string;
  style: CSSProperties;
  children?: ReactNode;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

export const TableControlButton = ({ className, label, style, children, onPointerDown }: Props) => {
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      title={label}
      tabIndex={-1}
      contentEditable={false}
      onPointerDown={onPointerDown}
      onPointerUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </button>
  );
};
