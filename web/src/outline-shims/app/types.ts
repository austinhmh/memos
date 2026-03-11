export type MenuItem = {
  type?: string;
  title?: string;
  label?: string;
  shortcut?: string;
  keywords?: string;
  icon?: any;
  iconColor?: string;
  dangerous?: boolean;
  selected?: boolean;
  disabled?: boolean;
  visible?: boolean;
  items?: MenuItem[];
  onClick?: () => void;
};

export type Properties = Record<string, any>;
