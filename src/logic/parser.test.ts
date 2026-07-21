import { describe, expect, it } from 'bun:test';
import { parseLogLine, parseLogText, resolveTimestamp } from './parser';

// Real capture, exactly as it came out of the game.
const SAMPLE = `[7-18 19:00] Uploaded Lv3 Siphon to 216.22.206.218
[7-18 19:00] Failed to crack password on 216.22.206.218
[7-18 19:00] Uploaded Lv3 Siphon to 154.9.12.100
[7-18 18:08] Failed to crack password on 154.9.12.100
[7-18 18:04] Cracked password on 113.39.182.104
[7-18 18:03] Uploading Lv3 Siphon to 154.9.12.100...
[7-18 18:03] Cracked password on 49.208.94.110
[7-18 18:03] Accessed device at 154.9.12.100
[7-18 18:02] Cracking password on 154.9.12.100...
[7-18 18:02] Cracking password on 216.22.206.218...
[7-18 18:02] Uploading Lv3 Siphon to 216.22.206.218...
[7-18 18:02] Accessed device at 216.22.206.218
[7-18 18:01] Cracking password on 113.39.182.104...
[7-18 18:01] Accessed device at 113.39.182.104
[7-18 18:00] Stole 172 Crypto from hx84d9...762d
[7-18 18:00] Accessed device at 153.95.66.226
[7-18 18:00] Accessed device at 235.4.159.236
[7-18 18:00] Stole 195 Crypto from hxe182...621c
[7-18 17:59] Accessed device at 27.46.201.227
[7-18 17:59] Stole 65 Crypto from hxcea9...9e4b
[7-18 17:59] Accessed device at 7.183.30.179
[7-18 17:59] Stole 435 Crypto from hxbef6...beba
[7-18 17:58] Accessed device at 84.39.197.170
[7-18 17:57] Stole 564 Crypto from hx0cee...7894
[7-18 17:57] Accessed device at 190.124.162.177
[7-18 17:57] Accessed device at 125.75.111.26
[7-18 17:56] Uploaded Lv3 Siphon to 153.95.66.226
[7-18 17:56] Bypassed firewall on 154.9.12.100
[7-18 17:56] Stole 866 Crypto from hx786b...08d0
[7-18 17:56] Bypassed firewall on 216.22.206.218
[7-18 17:56] Stole 887 Crypto from hxa31d...41db
[7-18 17:56] Accessed device at 227.192.234.14
[7-18 17:56] Stole 319 Crypto from hxeae6...4725
[7-18 17:55] Accessed device at 13.133.120.254
[7-18 17:55] Uploaded Lv3 Siphon to 49.208.94.110
[7-18 17:55] Stole 68 Crypto from hxbe15...8903
[7-18 17:55] Accessed device at 115.246.146.239
[7-18 17:55] Accessed device at 28.173.97.227
[7-18 17:54] Accessed device at 165.43.195.40
[7-18 17:54] Stole 172 Crypto from hxbb8d...042b
[7-18 17:54] Stole 168 Crypto from hxb037...5bd2`;

const NOW = new Date(2026, 6, 18, 20, 0, 0);

describe('parseLogLine', () => {
  it('reads a crypto theft: amount and wallet, no IP', () => {
    const line = parseLogLine('[7-18 18:00] Stole 172 Crypto from hx84d9...762d', NOW)!;
    expect(line.eventType).toBe('CRYPTO_STEAL');
    expect(line.cryptoAmount).toBe(172);
    expect(line.wallets).toEqual(['hx84d9...762d']);
    expect(line.fullWallets).toEqual([]);
    expect(line.ips).toEqual([]);
    expect(line.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('shortens a full wallet address onto the same identity as its short form', () => {
    const short = parseLogLine('[7-19 0:11] Stole 8 Crypto from hxcf6f...173a', NOW)!;
    const full = parseLogLine(
      '[7-19 0:12] Stole 8 Crypto from hxcf6f90f2f558f95bc581c9ed61173a',
      NOW,
    )!;

    expect(full.wallets).toEqual(['hxcf6f...173a']);
    expect(full.wallets).toEqual(short.wallets);

    // The full text is kept — it is what proves the wallet cracked.
    expect(full.fullWallets).toEqual(['hxcf6f90f2f558f95bc581c9ed61173a']);
    expect(short.fullWallets).toEqual([]);
  });

  it('does not read a 30-character wallet as an IP address', () => {
    const line = parseLogLine(
      '[7-19 0:12] Stole 8 Crypto from hxcf6f90f2f558f95bc581c9ed61173a',
      NOW,
    )!;
    expect(line.ips).toEqual([]);
    expect(line.cryptoAmount).toBe(8);
  });

  it('reads a software upload: software name, level and IP', () => {
    const line = parseLogLine('[7-18 19:00] Uploaded Lv3 Siphon to 216.22.206.218', NOW)!;
    expect(line.eventType).toBe('UPLOAD_DONE');
    expect(line.software).toBe('Siphon');
    expect(line.softwareLevel).toBe(3);
    expect(line.ips).toEqual(['216.22.206.218']);
    expect(line.provesMySoftware).toBe(true);
  });

  it('separates the three password-cracking states', () => {
    expect(parseLogLine('[7-18 18:02] Cracking password on 1.2.3.4...', NOW)!.eventType).toBe(
      'CRACK_START',
    );
    expect(parseLogLine('[7-18 18:04] Cracked password on 1.2.3.4', NOW)!.eventType).toBe(
      'CRACK_SUCCESS',
    );
    expect(parseLogLine('[7-18 19:00] Failed to crack password on 1.2.3.4', NOW)!.eventType).toBe(
      'CRACK_FAIL',
    );
  });

  it('infers defensive software from what resisted us', () => {
    const bypass = parseLogLine('[7-18 17:56] Bypassed firewall on 154.9.12.100', NOW)!;
    expect(bypass.software).toBe('Firewall');
    expect(bypass.provesTargetSoftware).toBe(true);

    const failed = parseLogLine('[7-18 19:00] Failed to crack password on 154.9.12.100', NOW)!;
    expect(failed.software).toBe('Password Encryptor');
  });

  it('never mistakes a wallet for an IP address', () => {
    const line = parseLogLine('[7-18 18:00] Stole 10 Crypto from hx1.2.3.4...762d', NOW)!;
    expect(line.ips).toEqual([]);
  });

  it('rejects impossible IP octets', () => {
    const line = parseLogLine('[7-18 18:00] Accessed device at 999.1.1.1', NOW)!;
    expect(line.ips).toEqual([]);
  });

  it('keeps unrecognised lines instead of dropping them', () => {
    const line = parseLogLine('[7-18 18:00] Something brand new on 8.8.8.8', NOW)!;
    expect(line.eventType).toBe('UNKNOWN');
    expect(line.ips).toEqual(['8.8.8.8']);
    // Low enough to route to the review inbox rather than apply blindly.
    expect(line.confidence).toBeLessThan(0.5);
  });

  it('ignores blank lines', () => {
    expect(parseLogLine('   ', NOW)).toBeNull();
  });
});

describe('resolveTimestamp', () => {
  it('assumes the current year for a recent date', () => {
    const ts = resolveTimestamp(7, 18, 19, 0, 0, NOW);
    expect(new Date(ts).getFullYear()).toBe(2026);
  });

  it('rolls back a year when the date would otherwise be in the future', () => {
    // December parsed in July means last December.
    const ts = resolveTimestamp(12, 25, 12, 0, 0, NOW);
    expect(new Date(ts).getFullYear()).toBe(2025);
  });
});

describe('parseLogText', () => {
  const result = parseLogText(SAMPLE, NOW);

  it('parses every line of a real capture', () => {
    expect(result.lines).toHaveLength(41);
    expect(result.skipped).toHaveLength(0);
  });

  it('recognises every line — nothing falls through to UNKNOWN', () => {
    const unknown = result.lines.filter((l) => l.eventType === 'UNKNOWN');
    expect(unknown).toHaveLength(0);
  });

  it('is confident about every line', () => {
    const unsure = result.lines.filter((l) => l.confidence < 0.85);
    expect(unsure).toHaveLength(0);
  });

  it('totals the crypto correctly', () => {
    const total = result.lines.reduce((sum, l) => sum + l.cryptoAmount, 0);
    expect(total).toBe(3911);
  });

  it('finds every distinct wallet and IP', () => {
    const wallets = new Set(result.lines.flatMap((l) => l.wallets));
    const ips = new Set(result.lines.flatMap((l) => l.ips));
    expect(wallets.size).toBe(11);
    expect(ips.size).toBe(16);
  });

  it('sorts oldest first so events apply in the order they happened', () => {
    const times = result.lines.map((l) => l.timestamp);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('collapses duplicate lines inside one paste', () => {
    const doubled = parseLogText(`${SAMPLE}\n${SAMPLE}`, NOW);
    expect(doubled.lines).toHaveLength(41);
    expect(doubled.duplicatesInBatch).toBe(41);
  });

  it('produces stable hashes, so re-importing the same logs changes nothing', () => {
    const again = parseLogText(SAMPLE, NOW);
    expect(again.lines.map((l) => l.hash)).toEqual(result.lines.map((l) => l.hash));
  });
});
