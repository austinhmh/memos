import * as React from "react";

export function Popover({ children }: any) {
  return <>{children}</>;
}

export function PopoverTrigger({ children }: any) {
  return <>{children}</>;
}

export function PopoverContent({ children }: any) {
  return <div>{children}</div>;
}

export function PopoverDisclosure({ children }: any) {
  return <>{children}</>;
}

export function usePopoverState(opts?: any) {
  return { visible: false, hide: () => {}, show: () => {}, toggle: () => {} };
}
