import * as React from "react";
import styled from "styled-components";

export const HStack = styled.div<{ gap?: number }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: ${(p) => (p.gap ? `${p.gap}px` : "8px")};
`;
