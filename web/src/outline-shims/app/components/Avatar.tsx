import * as React from "react";
import styled from "styled-components";

export enum AvatarSize {
  Small = 16,
  Toast = 20,
  Medium = 24,
  Large = 32,
  XLarge = 48,
}

export function Avatar({ src, size = AvatarSize.Medium }: { src?: string; size?: number; model?: any; alt?: string }) {
  return <Img src={src || ""} style={{ width: size, height: size, borderRadius: "50%" }} />;
}

export function GroupAvatar(_props: any) {
  return null;
}

const Img = styled.img``;
export default Avatar;
