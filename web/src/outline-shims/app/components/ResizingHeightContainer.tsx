import * as React from "react";

export function ResizingHeightContainer({ children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) {
  return <div {...rest}>{children}</div>;
}
