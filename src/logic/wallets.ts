// The game prints the same wallet shortened (hxcf6f...173a) or in full once
// cracked. The canonical DB form is the SHORT one — it's the form we always
// have, since most wallets are never cracked. Seeing the full address is what
// proves a wallet cracked.

/** How many leading characters the shortened form keeps, including "hx". */
const PREFIX_LENGTH = 6;

/** How many trailing characters the shortened form keeps. */
const SUFFIX_LENGTH = 4;

/** The separator the game prints between the two halves. */
const ELLIPSIS = '...';

/** Two or more consecutive dots marks an address as shortened. */
const ELLIPSIS_RE = /\.{2,}/;

const FULL_RE = /^hx[0-9a-fA-F]{16,}$/;

// The 16-digit floor is well below the ~30 the game prints, so a paste that lost
// a character or two still counts as full; a shortened address never can.
export function isFullWalletAddress(address: string): boolean {
  const cleaned = address.trim();
  if (ELLIPSIS_RE.test(cleaned)) return false;
  return FULL_RE.test(cleaned);
}

export function isPartialWalletAddress(address: string): boolean {
  return ELLIPSIS_RE.test(address.trim());
}

/** The canonical shortened form. Idempotent: already-short addresses come back unchanged. */
export function shortenWallet(address: string): string {
  const cleaned = address.trim();
  if (isPartialWalletAddress(cleaned)) return cleaned;
  if (cleaned.length <= PREFIX_LENGTH + SUFFIX_LENGTH) return cleaned;
  return `${cleaned.slice(0, PREFIX_LENGTH)}${ELLIPSIS}${cleaned.slice(-SUFFIX_LENGTH)}`;
}

/**
 * The two ends of an address — all any two forms of the same wallet share.
 * Null when the string is not an address at all.
 */
export function walletParts(address: string): { prefix: string; suffix: string } | null {
  const cleaned = address.trim();
  if (cleaned.length === 0) return null;

  if (isPartialWalletAddress(cleaned)) {
    const [prefix, suffix] = cleaned.split(ELLIPSIS_RE);
    if (!prefix || !suffix) return null;
    return { prefix, suffix };
  }

  if (cleaned.length <= PREFIX_LENGTH + SUFFIX_LENGTH) return null;
  return {
    prefix: cleaned.slice(0, PREFIX_LENGTH),
    suffix: cleaned.slice(-SUFFIX_LENGTH),
  };
}

/**
 * True when two addresses denote the same wallet, in any combination of forms.
 * Only as much of each end as both provide is compared — hand-pasted log text
 * gets trimmed and mangled, and splitting one wallet into two loses real crypto.
 */
export function walletsMatch(a: string, b: string): boolean {
  const left = walletParts(a);
  const right = walletParts(b);
  if (!left || !right) return false;

  const prefixLength = Math.min(left.prefix.length, right.prefix.length);
  const suffixLength = Math.min(left.suffix.length, right.suffix.length);
  if (prefixLength === 0 || suffixLength === 0) return false;

  return (
    left.prefix.slice(0, prefixLength).toLowerCase() ===
      right.prefix.slice(0, prefixLength).toLowerCase() &&
    left.suffix.slice(-suffixLength).toLowerCase() ===
      right.suffix.slice(-suffixLength).toLowerCase()
  );
}
