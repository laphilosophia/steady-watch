import chalk from 'chalk';
import { ThemeName } from './types.js';

export type ChalkStyle = (s: string) => string;

export interface Theme {
  blue: ChalkStyle;
  green: ChalkStyle;
  yellow: ChalkStyle;
  red: ChalkStyle;
  cyan: ChalkStyle;
  gray: ChalkStyle;
  dim: ChalkStyle;
  bold: ChalkStyle;
}

export const themes: Record<ThemeName, Theme> = {
  default: {
    blue: chalk.blue,
    green: chalk.green,
    yellow: chalk.yellow,
    red: chalk.red,
    cyan: chalk.cyan,
    gray: chalk.gray,
    dim: chalk.dim,
    bold: chalk.bold
  },
  minimal: {
    blue: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
    gray: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s
  },
  none: {
    blue: () => '',
    green: () => '',
    yellow: () => '',
    red: () => '',
    cyan: () => '',
    gray: () => '',
    dim: () => '',
    bold: (s: string) => s
  }
};

export function getTheme(name: ThemeName): Theme {
  return themes[name] || themes.default;
}
