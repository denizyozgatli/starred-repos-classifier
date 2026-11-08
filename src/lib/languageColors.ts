/**
 * GitHub language color mapping for developer-oriented visual identification.
 * Colors correspond to GitHub's linguist color definitions, adjusted for high contrast on dark themes.
 */
export const LANGUAGE_COLORS: Record<string, string> = {
  Python: '#3572A5',
  'Jupyter Notebook': '#DA5B0B',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  HTML: '#e34c26',
  CSS: '#563d7c',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#8b949e',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  PHP: '#4F5D95',
  PowerShell: '#5391fe',
  Shell: '#89e051',
  MDX: '#fcb32c',
  PLSQL: '#dad8d8',
  Ruby: '#701516',
  Swift: '#F05138',
  Dart: '#00B4AB',
};

const DEFAULT_COLOR = '#8b949e';

/**
 * Returns the hex color associated with a programming language.
 * Falls back to a clean neutral gray if unknown.
 */
export function getLanguageColor(language: string | null | undefined): string {
  if (!language) return DEFAULT_COLOR;
  return LANGUAGE_COLORS[language] || DEFAULT_COLOR;
}
