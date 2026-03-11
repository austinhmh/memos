import "styled-components";

declare module "styled-components" {
  export interface Colors {
    transparent: string;
    almostBlack: string;
    lightBlack: string;
    almostWhite: string;
    veryDarkBlue: string;
    slate: string;
    slateLight: string;
    slateDark: string;
    smoke: string;
    smokeLight: string;
    smokeDark: string;
    white: string;
    white05: string;
    white10: string;
    white50: string;
    white75: string;
    black: string;
    black05: string;
    black10: string;
    black50: string;
    black75: string;
    accent: string;
    yellow: string;
    warmGrey: string;
    danger: string;
    warning: string;
    success: string;
    info: string;
    brand: {
      red: string;
      pink: string;
      purple: string;
      blue: string;
      marine: string;
      dusk: string;
      green: string;
      yellow: string;
    };
  }

  export interface DefaultTheme extends Colors {
    isDark: boolean;
    fontFamily: string;
    fontFamilyMono: string;
    fontFamilyEmoji: string;
    fontWeightRegular: number;
    fontWeightMedium: number;
    fontWeightBold: number;

    background: string;
    backgroundSecondary: string;
    backgroundTertiary: string;
    backgroundQuaternary: string;

    link: string;
    cursor: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    textDiffInserted: string;
    textDiffInsertedBackground: string;
    textDiffDeleted: string;
    textDiffDeletedBackground: string;
    textHighlight: string;
    textHighlightForeground: string;

    placeholder: string;
    selected: string;
    accentText: string;
    commentMarkBackground: string;

    sidebarBackground: string;
    sidebarHoverBackground: string;
    sidebarActiveBackground: string;
    sidebarControlHoverBackground: string;
    sidebarDraftBorder: string;
    sidebarText: string;
    sidebarWidth: number;
    sidebarRightWidth: number;
    sidebarCollapsedWidth: number;
    sidebarMinWidth: number;
    sidebarMaxWidth: number;

    backdrop: string;
    shadow: string;
    modalBackdrop: string;
    modalBackground: string;
    modalShadow: string;

    menuItemSelected: string;
    menuBackground: string;
    menuShadow: string;

    divider: string;
    titleBarDivider: string;
    inputBorder: string;
    inputBorderFocused: string;

    listItemHoverBackground: string;
    mentionBackground: string;
    mentionHoverBackground: string;

    tableSelected: string;
    tableSelectedBackground: string;

    buttonNeutralBackground: string;
    buttonNeutralText: string;
    buttonNeutralBorder: string;

    tooltipBackground: string;
    tooltipText: string;
    toastBackground: string;
    toastText: string;

    quote: string;
    code: string;
    codeBackground: string;
    codeBorder: string;
    codeComment: string;
    codePunctuation: string;
    codeNumber: string;
    codeProperty: string;
    codeTag: string;
    codeClassName: string;
    codeString: string;
    codeSelector: string;
    codeAttrName: string;
    codeAttrValue: string;
    codeEntity: string;
    codeKeyword: string;
    codeFunction: string;
    codeStatement: string;
    codePlaceholder: string;
    codeInserted: string;
    codeImportant: string;
    codeConstant: string;
    codeParameter: string;
    codeOperator: string;

    noticeInfoBackground: string;
    noticeInfoText: string;
    noticeTipBackground: string;
    noticeTipText: string;
    noticeWarningBackground: string;
    noticeWarningText: string;
    noticeSuccessBackground: string;
    noticeSuccessText: string;

    embedBorder: string;
    horizontalRule: string;
    progressBarBackground: string;
    scrollbarBackground: string;
    scrollbarThumb: string;

    breakpoints: Record<string, number>;
  }
}
