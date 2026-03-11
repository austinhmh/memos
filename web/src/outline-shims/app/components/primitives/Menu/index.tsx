import * as React from "react";

export function Menu({ children, ...rest }: any) {
  return <div {...rest}>{children}</div>;
}

export function MenuTrigger({ children }: any) {
  return <>{children}</>;
}

export function MenuContent({ children }: any) {
  return <div>{children}</div>;
}
