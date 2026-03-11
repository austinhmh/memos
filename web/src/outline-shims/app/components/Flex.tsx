import * as React from "react";
import styled from "styled-components";

type Props = {
  column?: boolean;
  align?: string;
  justify?: string;
  wrap?: boolean;
  shrink?: boolean;
  gap?: number;
  auto?: boolean;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: (ev: React.MouseEvent) => void;
};

const Flex = React.forwardRef<HTMLDivElement, Props>(function Flex(
  { column, align, justify, wrap, shrink, gap, auto, children, ...rest },
  ref
) {
  return (
    <Container
      ref={ref}
      $column={column}
      $align={align}
      $justify={justify}
      $wrap={wrap}
      $shrink={shrink}
      $gap={gap}
      $auto={auto}
      {...rest}
    >
      {children}
    </Container>
  );
});

const Container = styled.div<{
  $column?: boolean;
  $align?: string;
  $justify?: string;
  $wrap?: boolean;
  $shrink?: boolean;
  $gap?: number;
  $auto?: boolean;
}>`
  display: flex;
  flex-direction: ${(p) => (p.$column ? "column" : "row")};
  align-items: ${(p) => p.$align || "stretch"};
  justify-content: ${(p) => p.$justify || "flex-start"};
  flex-wrap: ${(p) => (p.$wrap ? "wrap" : "nowrap")};
  flex-shrink: ${(p) => (p.$shrink === false ? 0 : undefined)};
  gap: ${(p) => (p.$gap ? `${p.$gap}px` : undefined)};
  min-height: 0;
  min-width: 0;
  ${(p) => p.$auto && "flex: 1 1 auto;"}
`;

export default Flex;
