#!/usr/bin/env node
/**
 * Docker Runner - Executes commands in claude-mem-worker container
 *
 * This script wraps bun commands to run inside Docker container
 * instead of on the host (for macOS 12 compatibility).
 *
 * Usage: node docker-runner.js <script> [args...]
 */

import { spawnSync } from 'child_process';

const CONTAINER_NAME = 'claude-mem-worker';
const CONTAINER_WORKDIR = '/app/plugin';

// Get script and args
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: docker-runner.js <script> [args...]');
  process.exit(1);
}

const script = args[0];
const scriptArgs = args.slice(1);

// Map host paths to container paths (support both with and without /plugin suffix)
let containerScript = script
  .replace(/\/Users\/vince\/\.claude\/plugins\/marketplaces\/thedotmack\/plugin/g, CONTAINER_WORKDIR)
  .replace(/\/Users\/vince\/\.claude\/plugins\/marketplaces\/thedotmack/g, '/app');

// Build docker exec command with working directory
const dockerArgs = [
  'exec',
  '-i',
  '-w', CONTAINER_WORKDIR,
  CONTAINER_NAME,
  'bun',
  containerScript,
  ...scriptArgs
];

// Execute with better error handling
try {
  const result = spawnSync('docker', dockerArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: 120000 // 2 minute timeout
  });

  // Output stdout and stderr
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) {
    console.error('Docker runner error:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
} catch (error) {
  console.error('Docker runner exception:', error.message);
  process.exit(1);
}
