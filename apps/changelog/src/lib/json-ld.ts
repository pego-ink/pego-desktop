const UNSAFE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON for a `<script type="application/ld+json">` body: `<`, `>`, `&` and the JS line separators
 * are escaped, so no string in it can close the script element (`</script>`) or open a comment.
 */
export const serializeJsonLd = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => UNSAFE[char] ?? char);
