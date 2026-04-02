#!/usr/bin/env node
// Generates latest.json for the Tauri updater from a GitHub release.
// Reads .sig files uploaded by tauri-action, assembles the manifest, writes latest.json.
//
// Required env vars: VERSION, GITHUB_TOKEN
// Usage: node scripts/generate-update-manifest.js

const { execSync } = require('child_process');
const fs = require('fs');

const VERSION = process.env.VERSION;
const REPO = 'Psychotoxical/psysonic';
const TAG = `app-v${VERSION}`;

if (!VERSION) {
  console.error('VERSION env var required');
  process.exit(1);
}

// Platform → update bundle filename (produced by tauri-action with updater plugin)
const PLATFORM_FILES = {
  'darwin-aarch64': `Psysonic_aarch64.app.tar.gz`,
  'darwin-x86_64':  `Psysonic_x64.app.tar.gz`,
  'windows-x86_64': `Psysonic_${VERSION}_x64-setup.nsis.zip`,
};

const platforms = {};

for (const [platform, filename] of Object.entries(PLATFORM_FILES)) {
  const sigFile = `${filename}.sig`;
  try {
    execSync(
      `gh release download "${TAG}" --repo "${REPO}" -p "${sigFile}" --clobber`,
      { stdio: 'pipe' }
    );
    const signature = fs.readFileSync(sigFile, 'utf8').trim();
    const url = `https://github.com/${REPO}/releases/download/${TAG}/${filename}`;
    platforms[platform] = { signature, url };
    console.log(`✓ ${platform}`);
  } catch (e) {
    console.warn(`⚠ Skipping ${platform}: asset not found (${sigFile})`);
  }
}

if (Object.keys(platforms).length === 0) {
  console.error('No platforms found — aborting manifest generation');
  process.exit(1);
}

// Pull release notes from GitHub
let notes = '';
try {
  const raw = execSync(
    `gh release view "${TAG}" --repo "${REPO}" --json body`,
    { stdio: 'pipe' }
  ).toString();
  notes = JSON.parse(raw).body ?? '';
} catch {
  console.warn('Could not fetch release notes');
}

const manifest = {
  version: VERSION,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync('latest.json', JSON.stringify(manifest, null, 2));
console.log(`\nWrote latest.json for v${VERSION} with platforms: ${Object.keys(platforms).join(', ')}`);
