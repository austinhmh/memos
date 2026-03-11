import * as React from "react";

const MenuContext = React.createContext<any>({});

export function MenuProvider({ children }: { children: React.ReactNode }) {
  return <MenuContext.Provider value={{}}>{children}</MenuContext.Provider>;
}

export default MenuContext;
