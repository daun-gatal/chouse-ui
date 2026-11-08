/**
 * Client-side password generation for the admin "generate" buttons.
 *
 * Uses the Web Crypto CSPRNG with rejection sampling (no modulo bias) and a
 * Fisher–Yates shuffle, so every character and position is uniform.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*";

/** Uniform random integer in [0, max) from the CSPRNG. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) {
    throw new RangeError("max must be an integer in (0, 2^32]");
  }
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/**
 * A random password with at least one upper-case letter, lower-case letter,
 * digit and symbol. Look-alike characters (0/O, 1/l/I) are left out.
 */
export function generatePassword(length = 16): string {
  const pools = [UPPER, LOWER, DIGITS, SYMBOLS];
  if (length < pools.length) throw new RangeError(`length must be at least ${pools.length}`);
  const all = pools.join("");
  const chars = pools.map((pool) => pool[secureRandomInt(pool.length)]);
  while (chars.length < length) chars.push(all[secureRandomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
