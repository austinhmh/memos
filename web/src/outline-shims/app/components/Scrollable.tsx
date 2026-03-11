import * as React from "react";
import styled from "styled-components";

type Props = {
  children: React.ReactNode;
  flex?: boolean;
  shadow?: boolean;
  hiddenScrollbars?: boolean;
  topShadow?: boolean;
  bottomShadow?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

function Scrollable({ children, ...rest }: Props) {
  return <Wrapper {...rest}>{children}</Wrapper>;
}

const Wrapper = styled.div`
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;

export default Scrollable;
