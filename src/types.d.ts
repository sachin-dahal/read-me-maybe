declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  import type { PluginWithOptions } from 'markdown-it';
  export const full: PluginWithOptions;
  export const light: PluginWithOptions;
  export const bare: PluginWithOptions;
}

declare module 'markdown-it-front-matter' {
  import type { PluginWithOptions } from 'markdown-it';
  const plugin: PluginWithOptions<(frontMatter: string) => void>;
  export default plugin;
}
