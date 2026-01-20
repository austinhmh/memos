import { MasonryItemProps } from "./types";

export function MasonryItem({ memo, renderer, renderContext }: MasonryItemProps) {
  // No need for height measurement with fixed-height cards
  return <div>{renderer(memo, renderContext)}</div>;
}
