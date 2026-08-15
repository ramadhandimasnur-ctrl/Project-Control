import { config } from 'dotenv';

/**
 * Side-effect module: loads .env before anything else is imported.
 *
 * Next.js loads environment files itself, but a plain Node script does not.
 * `src/db/index.ts` opens its pool while the module graph is still being
 * evaluated, so a CLI must have the variables in place before that import is
 * reached — which means importing this file *first*, above every other import.
 */
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
