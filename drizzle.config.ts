import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

// Migrations must run over a DIRECT connection. Supabase's transaction pooler
// (port 6543) cannot execute DDL reliably, so prefer DIRECT_URL when present.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_URL atau DATABASE_URL belum diisi. Salin .env.example menjadi .env.local lalu isi connection string Postgres.',
  );
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
