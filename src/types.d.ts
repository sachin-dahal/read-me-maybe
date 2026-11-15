declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it';
  export const full: MarkdownIt.PluginWithOptions;
  export const light: MarkdownIt.PluginWithOptions;
  export const bare: MarkdownIt.PluginWithOptions;
}

declare module 'markdown-it-front-matter' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginWithOptions<(frontMatter: string) => void>;
  export default plugin;
}
