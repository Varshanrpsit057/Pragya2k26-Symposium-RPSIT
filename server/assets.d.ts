/** JPEG files are bundled into the Worker as raw bytes (see "rules" in wrangler.jsonc). */
declare module '*.jpg' {
  const data: ArrayBuffer;
  export default data;
}
