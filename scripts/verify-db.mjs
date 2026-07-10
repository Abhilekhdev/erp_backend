// Quick DB verification: lists tables + enums created in the public schema.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Minimal .env loader (avoids echoing secrets on the command line).
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();

const tables = await prisma.$queryRawUnsafe(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
);
const enums = await prisma.$queryRawUnsafe(
  'SELECT t.typname FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid GROUP BY t.typname ORDER BY t.typname',
);

console.log(`\nTables (${tables.length}):`);
for (const r of tables) console.log('  -', r.table_name);
console.log(`\nEnums (${enums.length}):`);
for (const r of enums) console.log('  -', r.typname);

await prisma.$disconnect();
