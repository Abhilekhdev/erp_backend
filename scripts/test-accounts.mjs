// End-to-end verification of the Payment Accounts module against the live Neon DB.
// Imports the COMPILED services (real logic, no HTTP/auth), exercises every screen's path,
// asserts outcomes, then hard-deletes all the test rows it created.
//
//   node scripts/test-accounts.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// minimal .env loader
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { AccountsService } = await import('../dist/modules/accounts/accounts.service.js');
const { AccountTypesService } = await import('../dist/modules/accounts/account-types.service.js');
const { AccountReportsService } = await import('../dist/modules/accounts/account-reports.service.js');
const { AccountPostingService } = await import('../dist/modules/accounts/account-posting.service.js');

const prisma = new PrismaClient();
const accounts = new AccountsService(prisma);
const types = new AccountTypesService(prisma);
const reports = new AccountReportsService(prisma);
const posting = new AccountPostingService();

const BUSINESS = 1;
const USER = 1;

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

// track everything we create, for cleanup
const created = { accounts: [], types: [], payments: [] };

async function run() {
  // 1) Account Types — 2-level tree
  const parent = await types.create(BUSINESS, { name: 'TEST-Banks' });
  created.types.push(parent.id);
  const child = await types.create(BUSINESS, { name: 'TEST-Savings', parentAccountTypeId: parent.id });
  created.types.push(child.id);
  const grouped = await types.grouped(BUSINESS);
  const p = grouped.data.find((g) => g.id === parent.id);
  ok(p && p.children.some((c) => c.id === child.id), 'Account type child nests under parent');
  try {
    await types.update(BUSINESS, parent.id, { name: 'TEST-Banks', parentAccountTypeId: child.id });
    ok(false, 'A parent-with-children must not become a sub-type');
  } catch {
    ok(true, 'A parent-with-children cannot become a sub-type (2-level guard)');
  }

  // 2) Create account with opening balance -> balance == opening
  const a = await accounts.create(BUSINESS, USER, {
    name: 'TEST-Cash',
    accountNumber: 'TCASH-1',
    accountTypeId: child.id,
    openingBalance: 1000,
    accountDetails: [{ label: 'Branch', value: 'HQ' }],
    note: 'test',
  });
  created.accounts.push(a.id);
  ok(approx(a.balance, 1000), `Opening balance seeds the account (balance=${a.balance})`);

  const b = await accounts.create(BUSINESS, USER, { name: 'TEST-Bank', accountNumber: 'TBANK-1', openingBalance: 0 });
  created.accounts.push(b.id);
  ok(approx(b.balance, 0), 'Second account starts at 0');

  // 3) Fund transfer A->B 300  => A 700, B 300, both rows linked
  await accounts.fundTransfer(BUSINESS, USER, { fromAccountId: a.id, toAccountId: b.id, amount: 300, note: 'ft' });
  let ba = (await accounts.getAccountBalance(BUSINESS, a.id)).balance;
  let bb = (await accounts.getAccountBalance(BUSINESS, b.id)).balance;
  ok(approx(ba, 700) && approx(bb, 300), `Fund transfer moved money (A=${ba}, B=${bb})`);
  const ftRows = await prisma.accountTransaction.findMany({
    where: { subType: 'FUND_TRANSFER', accountId: { in: [a.id, b.id] }, deletedAt: null },
  });
  ok(
    ftRows.length === 2 && ftRows.every((r) => r.transferTransactionId != null),
    'Fund transfer wrote two mutually-linked rows',
  );

  // 4) Deposit into B, funded from A, 200 => A 500, B 500
  await accounts.deposit(BUSINESS, USER, { toAccountId: b.id, fromAccountId: a.id, amount: 200, note: 'dep' });
  ba = (await accounts.getAccountBalance(BUSINESS, a.id)).balance;
  bb = (await accounts.getAccountBalance(BUSINESS, b.id)).balance;
  ok(approx(ba, 500) && approx(bb, 500), `Deposit (with funding account) moved money (A=${ba}, B=${bb})`);

  // 5) Payment posting: a purchase payment of 150 on account A => debit, balance 350; reverse restores
  const payment = await prisma.transactionPayment.create({
    data: {
      businessId: BUSINESS,
      transactionId: null,
      amount: 150,
      method: 'cash',
      accountId: a.id,
      paymentRefNo: `TEST-PP-${Date.now()}`,
      paidOn: new Date(),
      createdBy: USER,
    },
  });
  created.payments.push(payment.id);
  await posting.postForPayment(prisma, {
    paymentId: payment.id,
    accountId: a.id,
    transactionId: null,
    transactionType: 'purchase',
    amount: 150,
    paidOn: new Date(),
    createdBy: USER,
  });
  ba = (await accounts.getAccountBalance(BUSINESS, a.id)).balance;
  ok(approx(ba, 350), `Purchase payment posted a DEBIT to the account (A=${ba})`);
  const posted = await prisma.accountTransaction.findFirst({
    where: { transactionPaymentId: payment.id, deletedAt: null },
  });
  ok(posted && posted.type === 'DEBIT' && posted.subType === null, 'Posted row is DEBIT with NULL sub_type (auto)');

  await posting.reverseForPayment(prisma, payment.id);
  ba = (await accounts.getAccountBalance(BUSINESS, a.id)).balance;
  ok(approx(ba, 500), `Reversing the payment restored the balance (A=${ba})`);

  // 6) purchase_return refund posts a CREDIT
  await posting.postForPayment(prisma, {
    paymentId: payment.id,
    accountId: a.id,
    transactionId: null,
    transactionType: 'purchase_return',
    amount: 50,
    paidOn: new Date(),
    createdBy: USER,
  });
  ba = (await accounts.getAccountBalance(BUSINESS, a.id)).balance;
  ok(approx(ba, 550), `Purchase-return refund posted a CREDIT (A=${ba})`);
  await posting.reverseForPayment(prisma, payment.id);

  // 7) Cash flow + account book
  const cf = await accounts.cashFlow(BUSINESS, { accountId: a.id });
  ok(cf.data.length >= 3 && typeof cf.totals.balance === 'number', 'Cash flow returns rows with running balance');
  const book = await accounts.accountBook(BUSINESS, a.id);
  ok(book.ledger.length >= 3 && book.ledger.some((r) => r.subType === 'OPENING_BALANCE'), 'Account book shows the ledger');

  // 8) Edit a manual transaction — its paired leg mirrors the change
  const depositCredit = await prisma.accountTransaction.findFirst({
    where: { accountId: b.id, subType: 'DEPOSIT', type: 'CREDIT', deletedAt: null },
  });
  await accounts.updateAccountTransaction(BUSINESS, depositCredit.id, { amount: 250 });
  const pairedDebit = await prisma.accountTransaction.findUnique({ where: { id: depositCredit.transferTransactionId } });
  ok(approx(Number(pairedDebit.amount), 250), 'Editing a deposit updates its paired leg too');
  // restore for balance sanity
  await accounts.updateAccountTransaction(BUSINESS, depositCredit.id, { amount: 200 });

  // reject editing an auto (payment) row — post one, try to edit, expect throw
  await posting.postForPayment(prisma, {
    paymentId: payment.id, accountId: a.id, transactionId: null,
    transactionType: 'purchase', amount: 10, paidOn: new Date(), createdBy: USER,
  });
  const autoRow = await prisma.accountTransaction.findFirst({ where: { transactionPaymentId: payment.id, deletedAt: null } });
  try {
    await accounts.updateAccountTransaction(BUSINESS, autoRow.id, { amount: 99 });
    ok(false, 'Auto payment rows must not be editable');
  } catch {
    ok(true, 'Auto payment rows are not editable (manual-only guard)');
  }
  await posting.reverseForPayment(prisma, payment.id);

  // 9) Reports run and are shaped
  const tb = await reports.trialBalance(BUSINESS);
  ok(Array.isArray(tb.accounts) && Array.isArray(tb.pending) && tb.summary.sell === 0, 'Trial balance runs (sell-side honest-zero)');
  const bs = await reports.balanceSheet(BUSINESS);
  ok(typeof bs.assets.paymentAccounts === 'number' && bs.pending.length > 0, 'Balance sheet runs with pending notes');
  const pr = await reports.paymentAccountReport(BUSINESS, {});
  ok(Array.isArray(pr.data) && typeof pr.totals.count === 'number', 'Payment account report runs');

  // 10) Close / activate / soft-delete
  await accounts.setClosed(BUSINESS, b.id, true);
  let list = await accounts.findAll(BUSINESS, false);
  ok(!list.data.some((x) => x.id === b.id), 'Closed account is hidden from the default list');
  await accounts.setClosed(BUSINESS, b.id, false);
  list = await accounts.findAll(BUSINESS, false);
  ok(list.data.some((x) => x.id === b.id), 'Activated account reappears');
}

async function cleanup() {
  // account_transactions (incl. soft-deleted) for our accounts, then payments, accounts, types
  if (created.accounts.length) {
    await prisma.accountTransaction.deleteMany({ where: { accountId: { in: created.accounts } } });
  }
  if (created.payments.length) {
    await prisma.accountTransaction.deleteMany({ where: { transactionPaymentId: { in: created.payments } } });
    await prisma.transactionPayment.deleteMany({ where: { id: { in: created.payments } } });
  }
  if (created.accounts.length) await prisma.account.deleteMany({ where: { id: { in: created.accounts } } });
  if (created.types.length) await prisma.accountType.deleteMany({ where: { id: { in: created.types } } });
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

console.log(`\nAccounts verification: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
