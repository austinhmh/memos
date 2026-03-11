import * as React from "react";
import styled from "styled-components";

export const NativeInput = styled.input``;
export const Outline = styled.div``;

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  labelHidden?: boolean;
  short?: boolean;
  margin?: string | number;
  onRequestSubmit?: (ev: any) => void;
  $error?: boolean;
  children?: React.ReactNode;
};

const Input = React.forwardRef<HTMLInputElement, Props>(function Input(
  { label, short, margin, children, onRequestSubmit, $error, className, ...rest },
  ref
) {
  const handleKeyDown = React.useCallback(
    (ev: React.KeyboardEvent<HTMLInputElement>) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && onRequestSubmit) {
        onRequestSubmit(ev);
      }
      rest.onKeyDown?.(ev);
    },
    [onRequestSubmit, rest.onKeyDown]
  );

  if (children) {
    return (
      <Wrapper className={className}>
        <NativeInput ref={ref} {...rest} onKeyDown={handleKeyDown} />
        {children}
      </Wrapper>
    );
  }

  return <NativeInput ref={ref} className={className} {...rest} onKeyDown={handleKeyDown} />;
});

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0 4px;

  ${NativeInput} {
    border: none;
    outline: none;
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
  }
`;

export default Input;
