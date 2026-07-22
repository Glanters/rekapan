/**
 * IP address matching for the global allowlist.
 *
 * Deliberately free of any database or environment import: the matching logic
 * is the security-critical part, so it is kept in isolation where it can be
 * unit-tested without standing up the world, and where the enforcement path
 * pays nothing but the arithmetic to evaluate it.
 *
 * Addresses are represented as byte arrays (4 for IPv4, 16 for IPv6) and
 * compared prefix-bit by prefix-bit, which keeps everything in integer
 * arithmetic that works regardless of the compiler target — no BigInt.
 */

/** IPv4 dotted-quad → its four bytes, or null when malformed. */
function ipv4ToBytes(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    bytes.push(octet);
  }
  return bytes;
}

/** IPv6 (with `::` compression and optional embedded IPv4) → its sixteen bytes. */
function ipv6ToBytes(input: string): number[] | null {
  if (!input.includes(':')) return null;

  let str = input;

  // Fold a trailing dotted-quad (e.g. ::ffff:192.0.2.1) into two hextets.
  if (str.includes('.')) {
    const lastColon = str.lastIndexOf(':');
    if (lastColon === -1) return null;
    const v4 = ipv4ToBytes(str.slice(lastColon + 1));
    if (!v4) return null;
    const hi = (((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16);
    const lo = (((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16);
    str = `${str.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = str.split('::');
  if (halves.length > 2) return null;

  const toBytes = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const value = parseInt(group, 16);
      out.push((value >> 8) & 0xff, value & 0xff);
    }
    return out;
  };

  const head = toBytes(halves[0] ?? '');
  const tail = halves.length === 2 ? toBytes(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;

  const fill = 16 - head.length - tail.length;
  // Without `::` the address must be exactly sixteen bytes; with it, the gap
  // stands for one or more zero groups.
  if (halves.length === 2 ? fill < 0 : fill !== 0) return null;

  const bytes = [...head, ...Array<number>(Math.max(0, fill)).fill(0), ...tail];
  return bytes.length === 16 ? bytes : null;
}

interface ParsedAddress {
  bytes: number[];
  bits: 32 | 128;
}

/**
 * Parses an address to its bytes and family width.
 *
 * A v4-mapped v6 address (`::ffff:a.b.c.d`) collapses to plain IPv4, so a rule
 * written as an IPv4 address still matches a client the proxy hands back in the
 * mapped form.
 */
function parseAddress(input: string): ParsedAddress | null {
  const stripped = input.trim().replace(/%.*$/, '');
  if (!stripped) return null;

  if (stripped.includes(':')) {
    const bytes = ipv6ToBytes(stripped);
    if (!bytes) return null;

    const isV4Mapped =
      bytes.slice(0, 10).every((byte) => byte === 0) &&
      bytes[10] === 0xff &&
      bytes[11] === 0xff;
    if (isV4Mapped) return { bytes: bytes.slice(12), bits: 32 };
    return { bytes, bits: 128 };
  }

  const v4 = ipv4ToBytes(stripped);
  return v4 === null ? null : { bytes: v4, bits: 32 };
}

/** Splits a rule into its address and prefix length, validating both. */
function parseRule(rule: string): { address: ParsedAddress; prefix: number } | null {
  const slash = rule.indexOf('/');
  const addressPart = slash === -1 ? rule : rule.slice(0, slash);
  const address = parseAddress(addressPart);
  if (!address) return null;

  if (slash === -1) return { address, prefix: address.bits };

  const prefix = Number(rule.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return null;
  return { address, prefix };
}

/** Whether two byte arrays agree on their first `prefix` bits. */
function bytesSharePrefix(a: number[], b: number[], prefix: number): boolean {
  let remaining = prefix;
  let index = 0;

  while (remaining >= 8) {
    if (a[index] !== b[index]) return false;
    index += 1;
    remaining -= 8;
  }

  if (remaining > 0) {
    const mask = (0xff << (8 - remaining)) & 0xff;
    if (((a[index] ?? 0) & mask) !== ((b[index] ?? 0) & mask)) return false;
  }
  return true;
}

function addressMatchesRule(client: ParsedAddress, rule: string): boolean {
  const parsed = parseRule(rule);
  if (!parsed) return false;
  if (parsed.address.bits !== client.bits) return false;
  return bytesSharePrefix(parsed.address.bytes, client.bytes, parsed.prefix);
}

/**
 * Whether a client address is permitted by a set of rules.
 *
 * An empty list means the feature is off, so everyone passes. A non-empty list
 * denies anything it does not match — including an address that could not be
 * parsed (`'unknown'` when no proxy header is present), which under a whitelist
 * must fail closed rather than open.
 */
export function isIpAllowed(
  ip: string | undefined,
  rules: readonly { cidr: string }[],
): boolean {
  if (rules.length === 0) return true;
  if (!ip) return false;

  const client = parseAddress(ip);
  if (!client) return false;

  return rules.some((rule) => addressMatchesRule(client, rule.cidr));
}

/**
 * Validates a submitted address or CIDR and returns its canonical form, or null
 * when it is not a valid IP or range.
 */
export function normaliseCidr(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return parseRule(trimmed) === null ? null : trimmed;
}
