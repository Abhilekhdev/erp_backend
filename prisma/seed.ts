import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CURRENCIES } from './currencies.data';
import { PERMISSION_CATALOG, allPermissionValues } from '../src/modules/permissions/permissions.catalog';

// Load DATABASE_URL from .env so `ts-node prisma/seed.ts` works standalone.
try {
  const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* .env optional when vars are already set (e.g. `prisma db seed`) */
}

const prisma = new PrismaClient();

// Euro/European-locale rows use thousands '.' and decimal ',' in the legacy data.
const EU_DECIMAL_IDS = new Set([30, 38, 41, 44, 48, 56, 59, 73, 76, 84, 105, 110, 127]);

function separators(id: number): { thousandSeparator: string; decimalSeparator: string } {
  if (id === 135) return { thousandSeparator: ' ', decimalSeparator: '.' };
  if (EU_DECIMAL_IDS.has(id)) return { thousandSeparator: '.', decimalSeparator: ',' };
  return { thousandSeparator: ',', decimalSeparator: '.' };
}

async function main(): Promise<void> {
  for (const c of CURRENCIES) {
    const data = { country: c.country, currency: c.currency, code: c.code, symbol: c.symbol, ...separators(c.id) };
    // Upsert by id: idempotent, keeps legacy ids, safe against the currencies FK on `business`.
    await prisma.currency.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }

  // Keep the id sequence ahead of the explicit ids so future auto-inserts don't collide.
  await prisma.$executeRawUnsafe(
    "SELECT setval(pg_get_serial_sequence('currencies', 'id'), (SELECT MAX(id) FROM currencies))",
  );

  const total = await prisma.currency.count();
  console.log(`✔ Currencies seeded — total now ${total}`);

  // ── Permission catalogue (global permission names, grouped) ──
  const valueToGroup = new Map<string, string>();
  for (const g of PERMISSION_CATALOG) {
    for (const it of g.items) {
      if (it.type === 'checkbox') valueToGroup.set(it.value, g.key);
      else it.options.forEach((o) => valueToGroup.set(o.value, g.key));
    }
  }
  const permNames = allPermissionValues();
  for (const name of permNames) {
    const dot = name.indexOf('.');
    const resource = dot >= 0 ? name.slice(0, dot) : name;
    const action = dot >= 0 ? name.slice(dot + 1) : null;
    const data = { category: valueToGroup.get(name) ?? null, resource, action };
    await prisma.permission.upsert({ where: { name }, update: data, create: { name, ...data } });
  }
  console.log(`✔ Permissions seeded — ${permNames.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
