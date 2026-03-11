import * as React from "react";

export function Drawer({ children }: any) {
  return <>{children}</>;
}

export function DrawerContent({ children }: any) {
  return <div>{children}</div>;
}

export function DrawerTrigger({ children }: any) {
  return <>{children}</>;
}

export function DrawerTitle({ children }: any) {
  return <div>{children}</div>;
}

export function useDrawerState(opts?: any) {
  return { visible: false, hide: () => {}, show: () => {}, toggle: () => {} };
}
