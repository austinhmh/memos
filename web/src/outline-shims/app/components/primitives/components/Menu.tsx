import * as React from "react";
import styled from "styled-components";

export function MenuHeader({ children }: { children?: React.ReactNode }) {
  return <Header>{children}</Header>;
}

export function MenuItem({ children, onClick, icon, selected, ...rest }: any) {
  return (
    <Item onClick={onClick} $selected={selected} {...rest}>
      {icon}
      {children}
    </Item>
  );
}

export function MenuButton({ children, onClick, ...rest }: any) {
  return (
    <Item onClick={onClick} {...rest}>
      {children}
    </Item>
  );
}

export function MenuIconWrapper({ children }: any) {
  return <IconWrap>{children}</IconWrap>;
}

export function MenuLabel({ children }: any) {
  return <Label>{children}</Label>;
}

const Header = styled.div`
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #999;
`;

const IconWrap = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`;

const Label = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Item = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  background: ${(p) => (p.$selected ? "#f0f0f0" : "transparent")};
  &:hover {
    background: #f0f0f0;
  }
`;
