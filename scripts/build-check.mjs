import { spawn } from 'node:child_process';

/**
 * Verification build that writes somewhere other than `.next`.
 *
 * `next build` and `next dev` share the default output directory, so building
 * while the dev server is running replaces the manifest it is serving and the
 * browser starts 404-ing on chunks that no longer exist. This keeps the two
 * apart without touching how production builds behave.
 *
 * Written as a script rather than an inline env assignment because `FOO=bar cmd`
 * is not valid on Windows and `set FOO=bar &&` is not valid anywhere else.
 */
const child = spawn('next', ['build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: '.next-check' },
});

child.on('exit', (code) => process.exit(code ?? 1));
