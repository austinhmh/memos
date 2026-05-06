declare module "fuzzy-search";
declare module "natural-sort";
declare module "copy-to-clipboard";
declare module "markdown-it/lib/token.mjs" {
  export default class Token {
    constructor(type: string, tag: string, nesting: number);

    type: string;
    tag: string;
    attrs: [string, string][] | null;
    map: [number, number] | null;
    nesting: -1 | 0 | 1;
    level: number;
    children: Token[] | null;
    content: string;
    markup: string;
    info: string;
    meta: unknown;
    block: boolean;
    hidden: boolean;

    attrGet(name: string): string | null;
    attrSet(name: string, value: string): void;
  }
}

declare module "unist" {
  interface Data {
    sourceLine?: number;
  }
}
