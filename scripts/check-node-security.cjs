'use strict';

// October 21, 2026 Node.js security release, including CVE-2026-111497.
// Vercel selects only a major version; keep accepting later stable 24.x patches.
// https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
const MINIMUM_NODE24 = [24, 22, 1];

function isPatchedNode24(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts[0] !== MINIMUM_NODE24[0]) return false;
  return parts[1] > MINIMUM_NODE24[1]
    || (parts[1] === MINIMUM_NODE24[1] && parts[2] >= MINIMUM_NODE24[2]);
}

module.exports = { isPatchedNode24 };

if (require.main === module) {
  console.info(`[Wheel Deals build runtime] Node.js ${process.version}`);
  if (!isPatchedNode24(process.version)) {
    console.error('Build blocked: use stable Node.js 24.22.1 or a later 24.x security patch. Vercel manages patch versions for the 24.x runtime; do not bypass this check.');
    process.exitCode = 1;
  }
}
