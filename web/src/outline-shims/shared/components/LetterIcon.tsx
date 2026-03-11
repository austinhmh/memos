import * as React from "react";

interface LetterIconProps {
  letter: string;
  color?: string;
  size?: number;
}

function LetterIcon({ letter, color = "#999", size = 24 }: LetterIconProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        color: "#fff",
        fontSize: size * 0.5,
        fontWeight: 600,
        textTransform: "uppercase",
      }}
    >
      {letter.charAt(0)}
    </span>
  );
}

export default LetterIcon;
