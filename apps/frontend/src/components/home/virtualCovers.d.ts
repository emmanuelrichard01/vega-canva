/** Template id to the URL of its cover baked by the build. See `vega-template-covers` in `vite.config.ts`. */
declare module 'virtual:template-covers' {
  const covers: Record<string, string>;
  export default covers;
}
