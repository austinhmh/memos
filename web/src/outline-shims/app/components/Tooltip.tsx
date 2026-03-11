import * as React from "react";

export type Props = {
  children: React.ReactNode;
  content?: React.ReactNode;
  tooltip?: React.ReactNode;
  shortcut?: string;
  delay?: number;
  placement?: string;
};

function Tooltip({ children, content, tooltip, ...rest }: Props) {
  return <>{children}</>;
}

export default Tooltip;
