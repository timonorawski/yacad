#!/usr/bin/env node
/**
 * scripts/perf-report.mjs
 *
 * Runs Vitest benchmarks with JSON output and renders a human-readable
 * markdown report grouped by component. When GITHUB_STEP_SUMMARY is set
 * (i.e. running inside a GitHub Actions step) the report is appended there;
 * otherwise it is printed to stdout.
 *
 * Usage:
 *   node scripts/perf-report.mjs
 *
 * Deps: Node built-ins only (child_process, fs, os, path).
 */

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_JSON = join(tmpdir(), `vitest-bench-${Date.now()}.json`);

// ---------------------------------------------------------------------------
// 1. Run benches
// ---------------------------------------------------------------------------

console.error('Running benchmarks…');
try {
  execSync(`pnpm exec vitest bench --run --outputJson ${OUTPUT_JSON} bench/`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch {
  // vitest bench exits 0 on success even if some benches are slow; a non-zero
  // exit usually means a setup error. We still try to read whatever output was
  // written.
  console.error('Warning: vitest bench exited with a non-zero code.');
}

// ---------------------------------------------------------------------------
// 2. Parse output
// ---------------------------------------------------------------------------

let raw;
try {
  raw = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
} catch (err) {
  console.error(`Failed to read bench output from ${OUTPUT_JSON}: ${err.message}`);
  process.exit(1);
}

/**
 * @typedef {{ name: string; hz: number; mean: number; p75: number; p99: number; rme: number; sampleCount: number }} BenchResult
 * @typedef {{ fullName: string; benchmarks: BenchResult[] }} Group
 * @typedef {{ filepath: string; groups: Group[] }} BenchFile
 */

/** @type {BenchFile[]} */
const files = raw.files ?? [];

// ---------------------------------------------------------------------------
// 3. Derive component groupings
// ---------------------------------------------------------------------------

// Map each bench file's basename (without extension) to a display name.
const COMPONENT_LABELS = {
  'canonical.bench': 'Canonical serialization (@yacad/canonical)',
  'hash.bench': 'Hashing (@yacad/hash)',
  'dag.bench': 'DAG build (@yacad/dag)',
  'cache.bench': 'Cache operations (@yacad/cache)',
  'kernel.bench': 'Manifold WASM kernel (@yacad/kernel-manifold)',
  'engine.bench': 'Engine evaluation (@yacad/engine)',
  'pipeline.bench': 'E2E pipeline (doc → STL)',
};

// ---------------------------------------------------------------------------
// 4. Render markdown
// ---------------------------------------------------------------------------

function fmtHz(hz) {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} M ops/s`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} K ops/s`;
  return `${hz.toFixed(1)} ops/s`;
}

function fmtMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  return `${ms.toFixed(3)} ms`;
}

const lines = [];

lines.push('# Performance Report');
lines.push('');
lines.push(`_Generated ${new Date().toUTCString()}_`);
lines.push('');

// Collect cold and warm engine results for the speedup summary.
let coldHz = null;
let warmHz = null;

for (const file of files) {
  const basename = file.filepath.split('/').pop().replace(/\.ts$/, '');
  const label = COMPONENT_LABELS[basename] ?? basename;

  lines.push(`## ${label}`);
  lines.push('');

  for (const group of file.groups ?? []) {
    // group.fullName is e.g. "bench/engine.bench.ts > Engine.evaluate"
    const groupTitle = group.fullName.replace(/^.*> /, '');
    lines.push(`### ${groupTitle}`);
    lines.push('');
    lines.push('| Benchmark | Throughput | Mean | p75 | p99 | ±RME | Samples |');
    lines.push('|-----------|-----------|------|-----|-----|------|---------|');

    for (const b of group.benchmarks ?? []) {
      lines.push(
        `| ${b.name} | ${fmtHz(b.hz)} | ${fmtMs(b.mean)} | ${fmtMs(b.p75)} | ${fmtMs(b.p99)} | ±${b.rme.toFixed(2)}% | ${b.sampleCount.toLocaleString()} |`,
      );

      // Track engine cold/warm for speedup calculation.
      if (basename === 'engine.bench') {
        if (b.name.includes('cold')) coldHz = b.hz;
        if (b.name.includes('warm')) warmHz = b.hz;
      }
    }

    lines.push('');
  }
}

// ---------------------------------------------------------------------------
// 5. Cold-vs-warm speedup summary
// ---------------------------------------------------------------------------

if (coldHz !== null && warmHz !== null) {
  const speedup = (warmHz / coldHz).toFixed(1);
  lines.push('## Engine Cold-vs-Warm Speedup');
  lines.push('');
  lines.push(
    `> **${speedup}×** faster on a warm cache (root cache hit vs full kernel evaluation).`,
  );
  lines.push('');
  lines.push('This is the core architectural validation: the Merkle-DAG cache lets re-evaluation');
  lines.push('after an unchanged model return in a single store lookup instead of re-running');
  lines.push('the geometry kernel. The goal is >10× speedup on realistic scenes.');
  lines.push('');
  lines.push('| Scenario | Throughput |');
  lines.push('|----------|-----------|');
  lines.push(`| Cold (full kernel evaluation) | ${fmtHz(coldHz)} |`);
  lines.push(`| Warm (root cache hit) | ${fmtHz(warmHz)} |`);
  lines.push(`| **Speedup** | **${speedup}×** |`);
  lines.push('');
}

const report = lines.join('\n');

// ---------------------------------------------------------------------------
// 6. Output
// ---------------------------------------------------------------------------

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  appendFileSync(summaryPath, report + '\n');
  console.error(`Report appended to $GITHUB_STEP_SUMMARY (${summaryPath})`);
} else {
  process.stdout.write(report + '\n');
}
