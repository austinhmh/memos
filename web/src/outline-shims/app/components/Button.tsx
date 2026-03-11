import * as React from "react";
import styled from "styled-components";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  neutral?: boolean;
  danger?: boolean;
  fullwidth?: boolean;
  icon?: React.ReactNode;
};

const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { children, icon, neutral, danger, fullwidth, ...rest },
  ref
) {
  return (
    <StyledButton ref={ref} {...rest}>
      {icon}
      {children}
    </StyledButton>
  );
});

const StyledButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  &:hover {
    background: #f0f0f0;
  }
`;

export default Button;
