/**
 * Reproduces PHP's `json_encode()` default output byte-for-byte.
 *
 * The `Signature` header is AES over the exact bytes of `json_encode($body)`,
 * so the request body and the signed string must agree down to the byte or the
 * server rejects the login. `JSON.stringify` differs from PHP in exactly two
 * ways, both verified against generated fixtures in `crypto.test.ts`:
 *
 *   - PHP escapes `/` as `\/`; JavaScript leaves it bare.
 *   - PHP escapes non-ASCII as lowercase `\uXXXX` (surrogate pairs for
 *     astral characters); JavaScript emits the character literally.
 *
 * Everything else already matches: the quote, backslash, and C0 control
 * characters use identical escapes; DEL is left raw by both; and neither
 * escapes the HTML-significant characters.
 *
 * CONTRACT: values must be strings, booleans, null, arrays, or plain objects.
 * Numbers are deliberately unsupported — PHP renders float `1.0` as `"1.0"`
 * while JavaScript renders `"1"`, which would corrupt the signature silently.
 */

/**
 * Matches every UTF-16 code unit above the ASCII range.
 *
 * Written as a negated ASCII range so the source stays pure ASCII and cannot be
 * mangled by editor encodings. The boundary is U+007F, not U+0080: DEL sits
 * inside the excluded set because PHP emits it raw rather than escaping it.
 */
const NON_ASCII = /[^\x00-\x7f]/g;

/** JSON structural characters never contain `/`, so a global replace is safe. */
const FORWARD_SLASH = /\//g;

export class PhpJsonEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhpJsonEncodeError';
  }
}

function assertNoNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    throw new PhpJsonEncodeError(
      `Numeric value at "${path}" is outside the signing contract: PHP and ` +
        'JavaScript disagree on float formatting, which would corrupt the ' +
        'signature. Pass the value as a string instead.',
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoNumbers(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertNoNumbers(item, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * @param value - The payload to encode.
 * @returns A string byte-identical to PHP's `json_encode($value)`.
 * @throws {PhpJsonEncodeError} If the payload contains a number, or is not
 *   serialisable to JSON at all.
 */
export function phpJsonEncode(value: unknown): string {
  assertNoNumbers(value, '');

  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new PhpJsonEncodeError(
      'Value is not JSON-serialisable (undefined, function, or symbol).',
    );
  }

  return json
    .replace(FORWARD_SLASH, '\\/')
    .replace(
      NON_ASCII,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}
