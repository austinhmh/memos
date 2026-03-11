import * as React from "react";
import { createPortal } from "react-dom";

export const PortalContext = React.createContext<HTMLElement | undefined>(undefined);

export function usePortalContext() {
  return React.useContext(PortalContext);
}

export function Portal({ children }: { children: React.ReactNode }) {
  const portal = React.useContext(PortalContext);
  return createPortal(children, portal || document.body);
}

export default Portal;
