// Vite ?raw imports (story fixtures read catalog SVG sources as text).
declare module "*.svg?raw" {
  const source: string;
  export default source;
}
