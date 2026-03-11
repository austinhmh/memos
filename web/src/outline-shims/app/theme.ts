import { buildLightTheme, buildDarkTheme } from "@shared/styles/theme";
import type { DefaultTheme } from "styled-components";

export function createEditorTheme(isDark: boolean): DefaultTheme {
  return isDark ? buildDarkTheme({}) : buildLightTheme({});
}

export const lightTheme = buildLightTheme({});
export const darkTheme = buildDarkTheme({});
