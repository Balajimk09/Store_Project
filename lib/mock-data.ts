export type PaymentType = 'Credit' | 'Debit' | 'Cash' | 'EBT' | 'Mobile';

export type CardNetwork =
  | 'AMEX'
  | 'Discover'
  | 'Mastercard'
  | 'Visa'
  | 'Voyager'
  | 'WEX'
  | 'Debit'
  | 'EBT'
  | 'Cash'
  | 'Mobile'
  | 'Other';

export type TransactionType = 'Sale' | 'Refund' | 'Void' | 'No-Sale';

export type ExceptionReason =
  | 'REFUND'
  | 'VOID_LINE'
  | 'VOID_TICKET'
  | 'ERROR_CORRECT'
  | 'NO_SALE'
  | 'SAFE_DROP'
  | 'OTHER';

export interface Product {
  upc: string;
  name: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  reorderLevel: number;
  brand?: string;
  vendor?: string;
  department?: string;
  sku?: string;
  plu?: string;
  productCode?: string;
  taxRate?: number;
  taxCategory?: string;
  ebtEligible?: boolean;
  taxable?: boolean;
  ageVerification?: boolean;
  minimumAge?: number;
  ageRestrictionType?: string;
  isActive?: boolean;
  notes?: string;
  unitsPerCase?: number;
  casesOnHand?: number;
  looseUnits?: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  hour: number;
  item: string;
  category: string;
  cashierId: string;
  cashierName: string;
  register: number;
  paymentType: PaymentType;
  amount: number;
  type: TransactionType;
  date: string;
  upc?: string;
  quantity?: number;
  unitPrice?: number;
  discountAmount?: number;
  cardNetwork?: CardNetwork;
  exceptionReason?: ExceptionReason;
  fuelGrade?: string;
}

export interface Cashier {
  id: string;
  name: string;
  shift: 'Morning' | 'Evening' | 'Night';
  totalSales: number;
  transactionCount: number;
  refundCount: number;
  voidCount: number;
  noSaleCount: number;
  riskScore: number;
}

export const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--destructive))',
  'hsl(var(--muted-foreground))',
];

export const products: Product[] = [
  { upc: '0120000010101', name: 'Coca-Cola 20oz', category: 'Beverages', costPrice: 1.25, sellPrice: 2.49, stock: 142, reorderLevel: 48, brand: 'Coca-Cola', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0120000010102', name: 'Pepsi 20oz', category: 'Beverages', costPrice: 1.2, sellPrice: 2.39, stock: 38, reorderLevel: 48, brand: 'Pepsi', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0120000010103', name: 'Red Bull 8.4oz', category: 'Beverages', costPrice: 1.85, sellPrice: 3.99, stock: 96, reorderLevel: 36, brand: 'Red Bull', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0120000010104', name: 'Monster Energy 16oz', category: 'Beverages', costPrice: 1.75, sellPrice: 3.49, stock: 21, reorderLevel: 36, brand: 'Monster', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0284000900001', name: 'Doritos Cool Ranch', category: 'Snacks', costPrice: 1.1, sellPrice: 2.79, stock: 84, reorderLevel: 40, brand: 'Frito-Lay', department: 'Snacks', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0284000900002', name: 'Lay’s Classic 1oz', category: 'Snacks', costPrice: 0.55, sellPrice: 1.99, stock: 132, reorderLevel: 60, brand: 'Frito-Lay', department: 'Snacks', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0284000900003', name: 'Cheetos Crunchy', category: 'Snacks', costPrice: 0.95, sellPrice: 2.29, stock: 47, reorderLevel: 40, brand: 'Frito-Lay', department: 'Snacks', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0284000900004', name: 'Pringles Original', category: 'Snacks', costPrice: 1.4, sellPrice: 2.99, stock: 16, reorderLevel: 30, brand: 'Pringles', department: 'Snacks', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0048000011111', name: 'Snickers Bar', category: 'Candy', costPrice: 0.65, sellPrice: 1.79, stock: 158, reorderLevel: 50, brand: 'Mars', department: 'Candy', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0048000011112', name: 'Reese’s Cups', category: 'Candy', costPrice: 0.7, sellPrice: 1.79, stock: 143, reorderLevel: 50, brand: 'Hershey', department: 'Candy', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0048000011113', name: 'M&M Peanuts', category: 'Candy', costPrice: 0.75, sellPrice: 1.89, stock: 9, reorderLevel: 50, brand: 'Mars', department: 'Candy', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0048000011114', name: 'Kit Kat', category: 'Candy', costPrice: 0.6, sellPrice: 1.69, stock: 88, reorderLevel: 50, brand: 'Hershey', department: 'Candy', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0123456789001', name: 'Marlboro Red', category: 'Tobacco', costPrice: 5.8, sellPrice: 9.49, stock: 96, reorderLevel: 40, brand: 'Philip Morris', department: 'Tobacco', taxCategory: 'tobacco', taxRate: 12, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0123456789002', name: 'Newport 100s', category: 'Tobacco', costPrice: 5.9, sellPrice: 9.79, stock: 72, reorderLevel: 40, brand: 'Newport', department: 'Tobacco', taxCategory: 'tobacco', taxRate: 12, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0123456789003', name: 'Bic Lighter', category: 'Tobacco', costPrice: 0.85, sellPrice: 2.49, stock: 54, reorderLevel: 30, brand: 'Bic', department: 'Tobacco', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0820001000011', name: 'Bud Light 24oz', category: 'Beer', costPrice: 1.65, sellPrice: 3.49, stock: 120, reorderLevel: 48, brand: 'Bud Light', department: 'Beer', taxCategory: 'alcohol', taxRate: 10, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0820001000012', name: 'Miller Lite 24oz', category: 'Beer', costPrice: 1.6, sellPrice: 3.29, stock: 84, reorderLevel: 48, brand: 'Miller Lite', department: 'Beer', taxCategory: 'alcohol', taxRate: 10, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0820001000013', name: 'Corona 24oz', category: 'Beer', costPrice: 1.95, sellPrice: 3.99, stock: 12, reorderLevel: 40, brand: 'Corona', department: 'Beer', taxCategory: 'alcohol', taxRate: 10, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0200000000099', name: 'Regular Unleaded', category: 'Fuel', costPrice: 3.02, sellPrice: 3.49, stock: 8400, reorderLevel: 2000, brand: 'Fuel', department: 'Fuel', taxCategory: 'fuel', taxRate: 0, taxable: false, ebtEligible: false, isActive: true },
  { upc: '0200000000100', name: 'Premium Unleaded', category: 'Fuel', costPrice: 3.32, sellPrice: 3.89, stock: 4200, reorderLevel: 1500, brand: 'Fuel', department: 'Fuel', taxCategory: 'fuel', taxRate: 0, taxable: false, ebtEligible: false, isActive: true },
  { upc: '0200000000101', name: 'Diesel #2', category: 'Fuel', costPrice: 3.42, sellPrice: 3.99, stock: 5600, reorderLevel: 1800, brand: 'Fuel', department: 'Fuel', taxCategory: 'fuel', taxRate: 0, taxable: false, ebtEligible: false, isActive: true },
  { upc: '0200000000102', name: 'E10', category: 'Fuel', costPrice: 2.92, sellPrice: 3.19, stock: 7600, reorderLevel: 2000, brand: 'Fuel', department: 'Fuel', taxCategory: 'fuel', taxRate: 0, taxable: false, ebtEligible: false, isActive: true },
  { upc: '0700000010001', name: 'Great Value Water 1L', category: 'Beverages', costPrice: 0.35, sellPrice: 1.29, stock: 210, reorderLevel: 80, brand: 'Great Value', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0700000010002', name: 'Gatorade Fruit Punch', category: 'Beverages', costPrice: 0.95, sellPrice: 2.49, stock: 76, reorderLevel: 48, brand: 'Gatorade', department: 'Beverages', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0411969100011', name: 'Glad Trash Bags', category: 'Grocery', costPrice: 2.45, sellPrice: 5.99, stock: 34, reorderLevel: 15, brand: 'Glad', department: 'Grocery', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0411969100012', name: 'Bounty Paper Towels', category: 'Grocery', costPrice: 1.85, sellPrice: 4.49, stock: 7, reorderLevel: 15, brand: 'Bounty', department: 'Grocery', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: true, isActive: true },
  { upc: '0370000000001', name: 'Crest Toothpaste', category: 'Health & Beauty', costPrice: 1.95, sellPrice: 4.29, stock: 33, reorderLevel: 12, brand: 'Crest', department: 'Health & Beauty', taxCategory: 'standard', taxRate: 8.5, taxable: true, ebtEligible: false, isActive: true },
  { upc: '0044000010001', name: 'Gallon Milk 2%', category: 'Dairy', costPrice: 2.4, sellPrice: 4.29, stock: 27, reorderLevel: 15, brand: 'Dairy Pure', department: 'Dairy', taxCategory: 'non-taxable', taxRate: 0, taxable: false, ebtEligible: true, isActive: true },
  { upc: '0044000010002', name: 'Large Eggs Dozen', category: 'Dairy', costPrice: 1.8, sellPrice: 3.49, stock: 31, reorderLevel: 15, brand: 'Farm Fresh', department: 'Dairy', taxCategory: 'non-taxable', taxRate: 0, taxable: false, ebtEligible: true, isActive: true },
];

const cashiers = [
  { id: 'C001', name: 'Maria Santos', shift: 'Morning' as const, refundCount: 2, voidCount: 1, noSaleCount: 4 },
  { id: 'C002', name: 'James Carter', shift: 'Evening' as const, refundCount: 8, voidCount: 6, noSaleCount: 18 },
  { id: 'C003', name: 'Aisha Khan', shift: 'Morning' as const, refundCount: 1, voidCount: 0, noSaleCount: 2 },
  { id: 'C004', name: 'Diego Ramirez', shift: 'Night' as const, refundCount: 5, voidCount: 4, noSaleCount: 27 },
  { id: 'C005', name: 'Priya Patel', shift: 'Evening' as const, refundCount: 3, voidCount: 2, noSaleCount: 6 },
  { id: 'C006', name: 'Tyrone Wells', shift: 'Night' as const, refundCount: 11, voidCount: 9, noSaleCount: 41 },
];

const paymentTypes: PaymentType[] = ['Credit', 'Debit', 'Cash', 'EBT', 'Mobile'];
const creditNetworks: CardNetwork[] = ['Visa', 'Mastercard', 'AMEX', 'Discover', 'Voyager', 'WEX'];

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260618);

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weightFn(item), 0);
  let value = rng() * total;

  for (const item of items) {
    value -= weightFn(item);
    if (value <= 0) return item;
  }

  return items[items.length - 1];
}

function getFuelGrade(product: Product) {
  const text = `${product.name} ${product.category}`.toLowerCase();

  if (text.includes('diesel')) return 'Diesel';
  if (text.includes('e10')) return 'E10';
  if (text.includes('premium')) return 'Premium';
  if (text.includes('plus')) return 'Plus';
  if (text.includes('regular') || text.includes('unleaded')) return 'Regular';

  return product.category === 'Fuel' ? 'Other Fuel' : undefined;
}

function getCardNetwork(paymentType: PaymentType): CardNetwork {
  if (paymentType === 'Credit') {
    return weightedPick(creditNetworks, (network) => {
      if (network === 'Visa') return 5;
      if (network === 'Mastercard') return 4;
      if (network === 'AMEX') return 1;
      if (network === 'Discover') return 1;
      if (network === 'Voyager') return 0.5;
      if (network === 'WEX') return 0.5;
      return 1;
    });
  }

  if (paymentType === 'Debit') return 'Debit';
  if (paymentType === 'EBT') return 'EBT';
  if (paymentType === 'Cash') return 'Cash';
  if (paymentType === 'Mobile') return 'Mobile';

  return 'Other';
}

function getExceptionReason(type: TransactionType): ExceptionReason | undefined {
  if (type === 'Refund') return 'REFUND';
  if (type === 'No-Sale') return 'NO_SALE';

  if (type === 'Void') {
    return weightedPick<ExceptionReason>(
      ['VOID_LINE', 'VOID_TICKET', 'ERROR_CORRECT'],
      (reason) => (reason === 'VOID_LINE' ? 3 : reason === 'VOID_TICKET' ? 2 : 1)
    );
  }

  return undefined;
}

function generateTransactions(count: number): Transaction[] {
  const result: Transaction[] = [];
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(rng() * 7);
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);

    const hourWeights = Array.from({ length: 24 }, (_, hour) => {
      if (hour >= 6 && hour <= 9) return 8;
      if (hour >= 11 && hour <= 13) return 6;
      if (hour >= 16 && hour <= 19) return 10;
      if (hour >= 20 && hour <= 22) return 5;
      if (hour >= 0 && hour <= 5) return 1;
      return 3;
    });

    const hour = weightedPick(
      Array.from({ length: 24 }, (_, hourValue) => hourValue),
      (hourValue) => hourWeights[hourValue]
    );

    date.setHours(hour, Math.floor(rng() * 60), Math.floor(rng() * 60));

    const typeRoll = rng();
    let type: TransactionType;

    if (typeRoll < 0.88) type = 'Sale';
    else if (typeRoll < 0.93) type = 'Refund';
    else if (typeRoll < 0.97) type = 'Void';
    else type = 'No-Sale';

    const product = weightedPick(products, (item) =>
      item.category === 'Fuel'
        ? 1.4
        : item.category === 'Beverages'
          ? 2.2
          : item.category === 'Beer'
            ? 1.5
            : 1.2
    );

    const cashier = weightedPick(cashiers, (cashierItem) => {
      const shiftMatch =
        (cashierItem.shift === 'Morning' && hour >= 6 && hour < 14) ||
        (cashierItem.shift === 'Evening' && hour >= 14 && hour < 22) ||
        (cashierItem.shift === 'Night' && (hour >= 22 || hour < 6));

      return shiftMatch ? 3 : 0.4;
    });

    const paymentType = weightedPick(paymentTypes, (payment) =>
      payment === 'Credit' ? 4 : payment === 'Debit' ? 3 : payment === 'Cash' ? 2 : payment === 'Mobile' ? 1.2 : 1
    );

    const fuelGrade = getFuelGrade(product);
    const isFuel = product.category === 'Fuel';

    let quantity = 1;
    let unitPrice = product.sellPrice;
    let amount = 0;

    if (type === 'No-Sale') {
      quantity = 0;
      unitPrice = 0;
      amount = 0;
    } else if (isFuel) {
      quantity = +(4 + rng() * 14).toFixed(3);
      unitPrice = product.sellPrice;
      amount = +(unitPrice * quantity).toFixed(2);
    } else {
      quantity = 1 + Math.floor(rng() * 4);
      unitPrice = product.sellPrice;
      amount = +(unitPrice * quantity).toFixed(2);
    }

    if (type === 'Refund') amount = -Math.abs(amount);
    if (type === 'Void') amount = -Math.abs(amount);

    const iso = date.toISOString();

    result.push({
      id: `TX${String(100000 + i).padStart(6, '0')}`,
      timestamp: iso,
      hour,
      date: iso.split('T')[0],
      item: product.name,
      category: product.category,
      cashierId: cashier.id,
      cashierName: cashier.name,
      register: 1 + Math.floor(rng() * 4),
      paymentType,
      amount: +amount.toFixed(2),
      type,
      upc: product.upc,
      quantity,
      unitPrice,
      discountAmount: 0,
      cardNetwork: getCardNetwork(paymentType),
      exceptionReason: getExceptionReason(type),
      fuelGrade,
    });
  }

  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export const transactions: Transaction[] = generateTransactions(540);

export function computeCashiers(txns: Transaction[]): Cashier[] {
  const known = new Map(cashiers.map((cashier) => [cashier.id, cashier]));
  const byId = new Map<string, Transaction[]>();

  for (const transaction of txns) {
    const list = byId.get(transaction.cashierId) || [];
    list.push(transaction);
    byId.set(transaction.cashierId, list);
  }

  const result: Cashier[] = [];

  for (const [id, cashierTransactions] of Array.from(byId.entries())) {
    const sales = cashierTransactions.filter((transaction) => transaction.type === 'Sale');
    const totalSales = +sales.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2);
    const refundCount = cashierTransactions.filter((transaction) => transaction.type === 'Refund').length;
    const voidCount = cashierTransactions.filter((transaction) => transaction.type === 'Void').length;
    const noSaleCount = cashierTransactions.filter((transaction) => transaction.type === 'No-Sale').length;

    const refundRate = sales.length ? refundCount / sales.length : 0;
    const voidRate = sales.length ? voidCount / sales.length : 0;
    const noSaleRate = sales.length ? noSaleCount / sales.length : 0;

    const knownCashier = known.get(id);

    const riskScore = Math.min(
      100,
      Math.round(
        refundRate * 350 +
          voidRate * 450 +
          noSaleRate * 180 +
          (knownCashier?.id === 'C006' ? 15 : 0) +
          (knownCashier?.id === 'C002' ? 8 : 0)
      )
    );

    result.push({
      id,
      name: cashierTransactions[0]?.cashierName || knownCashier?.name || `Cashier ${id}`,
      shift: knownCashier?.shift || 'Morning',
      totalSales,
      transactionCount: sales.length,
      refundCount,
      voidCount,
      noSaleCount,
      riskScore,
    });
  }

  return result.sort((a, b) => b.totalSales - a.totalSales);
}

export const cashierData: Cashier[] = computeCashiers(transactions);

export function computeDashboardStats(txns: Transaction[]) {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const totalSales = allSales.reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    totalSales: +totalSales.toFixed(2),
    totalTransactions: txns.length,
    refundCount: txns.filter((transaction) => transaction.type === 'Refund').length,
    voidCount: txns.filter((transaction) => transaction.type === 'Void').length,
    noSaleCount: txns.filter((transaction) => transaction.type === 'No-Sale').length,
    averageTransactionValue: +(totalSales / (allSales.length || 1)).toFixed(2),
  };
}

export const dashboardStats = computeDashboardStats(transactions);

export function salesByCategory(txns: Transaction[] = transactions): { category: string; sales: number; pct: number }[] {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const map = new Map<string, number>();

  for (const transaction of allSales) {
    map.set(transaction.category, (map.get(transaction.category) || 0) + transaction.amount);
  }

  const total = Array.from(map.values()).reduce((sum, value) => sum + value, 0) || 1;

  return Array.from(map.entries())
    .map(([category, sales]) => ({
      category,
      sales: +sales.toFixed(2),
      pct: +((sales / total) * 100).toFixed(1),
    }))
    .sort((a, b) => b.sales - a.sales);
}

export function salesByHour(txns: Transaction[] = transactions): { hour: string; sales: number; transactions: number }[] {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const map = new Map<number, { sales: number; transactions: number }>();

  for (let hour = 0; hour < 24; hour++) {
    map.set(hour, { sales: 0, transactions: 0 });
  }

  for (const transaction of allSales) {
    const row = map.get(transaction.hour)!;
    row.sales += transaction.amount;
    row.transactions += 1;
  }

  return Array.from(map.entries()).map(([hour, value]) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    sales: +value.sales.toFixed(2),
    transactions: value.transactions,
  }));
}

export function topProducts(
  limit = 8,
  txns: Transaction[] = transactions
): { name: string; sales: number; units: number; category: string }[] {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const map = new Map<string, { sales: number; units: number; category: string }>();

  for (const transaction of allSales) {
    const row = map.get(transaction.item) || { sales: 0, units: 0, category: transaction.category };
    row.sales += transaction.amount;
    row.units += Number(transaction.quantity || 1);
    map.set(transaction.item, row);
  }

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      sales: +value.sales.toFixed(2),
      units: +value.units.toFixed(3),
      category: value.category,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

export function paymentTypeSplit(txns: Transaction[] = transactions): { name: PaymentType; value: number; pct: number }[] {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const map = new Map<string, number>();

  for (const transaction of allSales) {
    map.set(transaction.paymentType, (map.get(transaction.paymentType) || 0) + transaction.amount);
  }

  const total = Array.from(map.values()).reduce((sum, value) => sum + value, 0) || 1;

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name: name as PaymentType,
      value: +value.toFixed(2),
      pct: +((value / total) * 100).toFixed(1),
    }))
    .sort((a, b) => b.value - a.value);
}

export function dailySales(txns: Transaction[] = transactions): { date: string; label: string; sales: number; transactions: number }[] {
  const allSales = txns.filter((transaction) => transaction.type === 'Sale');
  const map = new Map<string, { sales: number; transactions: number }>();

  for (const transaction of allSales) {
    const row = map.get(transaction.date) || { sales: 0, transactions: 0 };
    row.sales += transaction.amount;
    row.transactions += 1;
    map.set(transaction.date, row);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => {
      const parsedDate = new Date(date);

      return {
        date,
        label: parsedDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        sales: +value.sales.toFixed(2),
        transactions: value.transactions,
      };
    });
}
