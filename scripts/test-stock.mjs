// End-to-end verification of Wastage Types + Stock Adjustments + Stock Transfers.
// Builds an isolated synthetic dataset under business 1 (OlympasLLC demo), exercises the compiled
// services against the live DB, asserts the stock math, then hard-deletes everything it created.
//
//   node scripts/test-stock.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { StockAdjustmentsService } = await import('../dist/modules/stock-adjustments/stock-adjustments.service.js');
const { StockTransfersService } = await import('../dist/modules/stock-transfers/stock-transfers.service.js');
const { WastageTypesService } = await import('../dist/modules/wastage-types/wastage-types.service.js');
const { StockService } = await import('../dist/common/services/stock.service.js');
const { ReferenceNumberService } = await import('../dist/common/services/reference-number.service.js');

const prisma = new PrismaClient();
const stock = new StockService();
const refs = new ReferenceNumberService(prisma);
const audit = { log: () => {} };
const adjustments = new StockAdjustmentsService(prisma, stock, refs, audit);
const transfers = new StockTransfersService(prisma, stock, refs, audit);
const wastageTypes = new WastageTypesService(prisma);

const BIZ = 1;
const USER = 1;
const user = { businessId: BIZ, sub: USER };
const MARK = 'ZZTEST-STOCK';

let pass = 0;
let fail = 0;
const approx = (a, b) => Math.abs(a - b) < 0.001;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ✓', msg);
  } else {
    fail++;
    console.error('  ✗ FAIL:', msg);
  }
}

const made = { locations: [], products: [], txns: [] };

async function stockAt(variationId, locationId) {
  const r = await prisma.variationLocationDetail.findUnique({
    where: { variationId_locationId: { variationId, locationId } },
  });
  return r ? Number(r.qtyAvailable) : 0;
}

async function setup() {
  const mk = (name) =>
    prisma.businessLocation.create({
      data: {
        businessId: BIZ,
        name: `${MARK}-${name}`,
        country: 'NA',
        state: 'NA',
        city: 'NA',
        zipCode: '0000000',
        invoiceSchemeId: 1,
        invoiceLayoutId: 1,
      },
    });
  const L1 = await mk('L1');
  const L2 = await mk('L2');
  made.locations.push(L1.id, L2.id);

  const product = await prisma.product.create({
    data: { businessId: BIZ, name: `${MARK}-Product`, sku: `${MARK}-SKU`, createdBy: USER, enableStock: true },
  });
  made.products.push(product.id);
  const pv = await prisma.productVariation.create({ data: { productId: product.id, name: 'DUMMY' } });
  const variation = await prisma.variation.create({
    data: { productId: product.id, productVariationId: pv.id, subSku: `${MARK}-SUB`, defaultPurchasePrice: 10 },
  });

  // A received purchase lot of 100 at L1.
  const purchase = await prisma.transaction.create({
    data: {
      businessId: BIZ,
      locationId: L1.id,
      type: 'PURCHASE',
      status: 'RECEIVED',
      refNo: `${MARK}-PUR`,
      transactionDate: new Date(),
      createdBy: USER,
    },
  });
  made.txns.push(purchase.id);
  const lot = await prisma.purchaseLine.create({
    data: {
      transactionId: purchase.id,
      productId: product.id,
      variationId: variation.id,
      quantity: 100,
      ppWithoutDiscount: 10,
      purchasePrice: 10,
      purchasePriceIncTax: 10,
    },
  });
  // Aggregate balance at L1 = 100.
  await prisma.variationLocationDetail.create({
    data: {
      productId: product.id,
      productVariationId: pv.id,
      variationId: variation.id,
      locationId: L1.id,
      qtyAvailable: 100,
    },
  });

  return { L1: L1.id, L2: L2.id, productId: product.id, variationId: variation.id, lotId: lot.id };
}

async function run() {
  const { L1, L2, productId, variationId, lotId } = await setup();

  // 1) Wastage type
  const wt = await wastageTypes.create(BIZ, USER, { name: `${MARK}-Damaged` });
  ok(!!wt.id, 'Wastage type created');
  try {
    await wastageTypes.create(BIZ, USER, { name: `${MARK}-Damaged` });
    ok(false, 'Duplicate wastage type name must be rejected');
  } catch {
    ok(true, 'Duplicate wastage type name rejected (unique guard)');
  }

  // 2) Stock adjustment — remove 30 at L1
  const adj = await adjustments.create(user, {
    location_id: L1,
    adjustment_type_id: wt.id,
    total_amount_recovered: 5,
    additional_notes: 'test',
    products: [{ product_id: productId, variation_id: variationId, quantity: 30, unit_price: 10 }],
  });
  made.txns.push(adj.id);
  ok(approx(await stockAt(variationId, L1), 70), `Adjustment reduced L1 stock 100→70 (=${await stockAt(variationId, L1)})`);
  let lot = await prisma.purchaseLine.findUnique({ where: { id: lotId } });
  ok(approx(Number(lot.quantityAdjusted), 30), `Lot quantityAdjusted is 30 (=${Number(lot.quantityAdjusted)})`);
  ok(approx(adj.totalAmount, 300), `Adjustment total = 30×10 = 300 (=${adj.totalAmount})`);

  await adjustments.remove(user, adj.id);
  made.txns = made.txns.filter((x) => x !== adj.id);
  lot = await prisma.purchaseLine.findUnique({ where: { id: lotId } });
  ok(
    approx(await stockAt(variationId, L1), 100) && approx(Number(lot.quantityAdjusted), 0),
    'Deleting the adjustment restored L1 stock and the lot counter',
  );

  // 3) Over-adjustment refused
  try {
    await adjustments.create(user, {
      location_id: L1,
      products: [{ product_id: productId, variation_id: variationId, quantity: 999, unit_price: 10 }],
    });
    ok(false, 'Adjusting more than available must be refused');
  } catch (e) {
    ok(/Not enough stock/i.test(e.message), 'Over-adjustment refused (no negative stock)');
  }

  // 4) Transfer created COMPLETED — 40 from L1 to L2
  const tr = await transfers.create(user, {
    status: 'completed',
    location_id: L1,
    transfer_location_id: L2,
    products: [{ product_id: productId, variation_id: variationId, quantity: 40, unit_price: 10 }],
  });
  made.txns.push(tr.id);
  ok(approx(await stockAt(variationId, L1), 60), `Completed transfer: L1 100→60 (=${await stockAt(variationId, L1)})`);
  ok(approx(await stockAt(variationId, L2), 40), `Completed transfer: L2 0→40 (=${await stockAt(variationId, L2)})`);
  lot = await prisma.purchaseLine.findUnique({ where: { id: lotId } });
  ok(approx(Number(lot.quantitySold), 40), `Source lot quantitySold is 40 (=${Number(lot.quantitySold)})`);
  const destLots = await prisma.purchaseLine.count({
    where: { variationId, transaction: { type: 'PURCHASE_TRANSFER', locationId: L2 } },
  });
  ok(destLots >= 1, 'Destination lot(s) created at L2');

  await transfers.remove(user, tr.id);
  made.txns = made.txns.filter((x) => x !== tr.id);
  lot = await prisma.purchaseLine.findUnique({ where: { id: lotId } });
  ok(
    approx(await stockAt(variationId, L1), 100) &&
      approx(await stockAt(variationId, L2), 0) &&
      approx(Number(lot.quantitySold), 0),
    'Deleting the completed transfer reversed both locations and the source lot',
  );

  // 5) Transfer created PENDING moves NO stock; then complete it
  const tr2 = await transfers.create(user, {
    status: 'pending',
    location_id: L1,
    transfer_location_id: L2,
    products: [{ product_id: productId, variation_id: variationId, quantity: 20, unit_price: 10 }],
  });
  made.txns.push(tr2.id);
  ok(
    approx(await stockAt(variationId, L1), 100) && approx(await stockAt(variationId, L2), 0),
    'A pending transfer moves no stock',
  );
  await transfers.updateStatus(user, tr2.id, 'completed');
  ok(
    approx(await stockAt(variationId, L1), 80) && approx(await stockAt(variationId, L2), 20),
    'Completing the transfer then posts stock (L1 80, L2 20)',
  );
  await transfers.remove(user, tr2.id);
  made.txns = made.txns.filter((x) => x !== tr2.id);
  ok(
    approx(await stockAt(variationId, L1), 100) && approx(await stockAt(variationId, L2), 0),
    'Deleting it restored both locations',
  );
}

async function cleanup() {
  // adjustment/transfer txns still tracked (on failure) + the paired purchase_transfer children
  await prisma.transaction.deleteMany({ where: { businessId: BIZ, refNo: { startsWith: MARK } } });
  await prisma.transaction.deleteMany({ where: { businessId: BIZ, id: { in: made.txns } } });
  if (made.products.length) await prisma.product.deleteMany({ where: { id: { in: made.products } } }); // cascades variations/pv/vld
  if (made.locations.length) await prisma.businessLocation.deleteMany({ where: { id: { in: made.locations } } });
  await prisma.wastageType.deleteMany({ where: { businessId: BIZ, name: { startsWith: MARK } } });
}

try {
  await run();
} catch (e) {
  fail++;
  console.error('\n  ✗ THREW:', e.message);
} finally {
  await cleanup();
  await prisma.$disconnect();
}

console.log(`\nStock modules verification: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
