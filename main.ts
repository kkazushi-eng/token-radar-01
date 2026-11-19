// Token Launch Radar — program entry point (Node 22, standard library only).
//
// Pipeline, in order:
//   1. locate the sealed snapshot (--input <file|dir>, default /input)
//   2. parse it and run the model in lib/model.ts
//   3. refuse to write anything if the board would fail the gate
//   4. write board.json and data.js into the output directory
//   5. copy dashboard/ and screenshots/ across, checking screenshot names
//   6. write dossier.json last, via the vendored make.fun library, so the
//      scorer's rebuild of it from the same output matches byte for byte
//
// The output directory is --output, else $MAKEFUN_OUTPUT_DIR, else /output
// (the grader mounts a writable /output). Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps mirrored from the gate: the text cap shapes dossier bytes, the
// remaining caps only cause refusals.
const DOSSIER_TEXT_CAP = 65_536;
const SCREENSHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from argv, with a fallback. */
function readArg(name: string, fallback: string): string {
  const flag = '--' + name;
  const position = process.argv.indexOf(flag);
  if (position >= 0 && position + 1 < process.argv.length) {
    return process.argv[position + 1]!;
  }
  const inline = process.argv.find((a) => a.startsWith(flag + '='));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

// --- locate and load the snapshot ------------------------------------

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(
    `token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
    2,
  );
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// --- score ------------------------------------------------------------

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const problem = boardIssue(board, snapshot);
if (problem !== null) {
  fail(`token radar: the model wrote a board the gate refuses: ${problem}\n`, 1);
}

// --- write the data outputs -------------------------------------------

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/**
 * Copy the regular files of one directory into another, skipping
 * dotfiles. Returns the names copied, in directory order.
 */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const screenshots = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (screenshots.length < 3) {
  fail(
    `token radar: screenshots/ holds ${screenshots.length} image${screenshots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
    1,
  );
}
for (const name of screenshots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
  }
}

// --- dossier, always last ----------------------------------------------

const dossier = buildDossier(outputDir, {
  text_max_bytes: DOSSIER_TEXT_CAP,
  screenshots: SCREENSHOT_LIMITS,
  dashboard: DASHBOARD_LIMITS,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outputDir, 'screenshots')} (${screenshots.length} images) and ${join(outputDir, 'dossier.json')}\n`,
);
