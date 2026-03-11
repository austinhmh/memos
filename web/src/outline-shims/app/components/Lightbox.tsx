import * as React from "react";

type Props = {
  src?: string;
  onClose?: () => void;
};

export default function Lightbox({ src, onClose }: Props) {
  if (!src) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <img src={src} style={{ maxWidth: "90vw", maxHeight: "90vh" }} />
    </div>
  );
}
