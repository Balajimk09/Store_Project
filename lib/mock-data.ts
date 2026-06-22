export type PaymentType = 'Credit' | 'Debit' | 'Cash' | 'EBT' | 'Mobile';
export type TransactionType = 'Sale' | 'Refund' | 'Void' | 'No-Sale';

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
  taxRate?: number;
  taxCategory?: string;
  ebtEligible?: boolean;
  taxable?: boolean;
  isActive?: boolean;
  notes?: string;
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

export const categories = [
  'Beverages',
  'Snacks',
  'Candy',
  'Tobacco',
  'Beer',
  'Fuel',
  'Grocery',
  'Automotive',
  'Health & Beauty',
  'Dairy',
];

export const products: Product[] = [
  { upc: '0120000010101', name: 'Coca-Cola 20oz', category: 'Beverages', costPrice: 1.25, sellPrice: 2.49, stock: 142, reorderLevel: 48 },
  { upc: '0120000010102', name: 'Pepsi 20oz', category: 'Beverages', costPrice: 1.20, sellPrice: 2.39, stock: 38, reorderLevel: 48 },
  { upc: '0120000010103', name: 'Red Bull 8.4oz', category: 'Beverages', costPrice: 1.85, sellPrice: 3.99, stock: 96, reorderLevel: 36 },
  { upc: '0120000010104', name: 'Monster Energy 16oz', category: 'Beverages', costPrice: 1.75, sellPrice: 3.49, stock: 21, reorderLevel: 36 },
  { upc: '0284000900001', name: 'Doritos Cool Ranch', category: 'Snacks', costPrice: 1.10, sellPrice: 2.79, stock: 84, reorderLevel: 40 },
  { upc: '0284000900002', name: 'Lay\'s Classic 1oz', category: 'Snacks', costPrice: 0.55, sellPrice: 1.99, stock: 132, reorderLevel: 60 },
  { upc: '0284000900003', name: 'Cheetos Crunchy', category: 'Snacks', costPrice: 0.95, sellPrice: 2.29, stock: 47, reorderLevel: 40 },
  { upc: '0284000900004', name: 'Pringles Original', category: 'Snacks', costPrice: 1.40, sellPrice: 2.99, stock: 16, reorderLevel: 30 },
  { upc: '0048000011111', name: 'Snickers Bar', category: 'Candy', costPrice: 0.65, sellPrice: 1.79, stock: 158, reorderLevel: 50 },
  { upc: '0048000011112', name: 'Reese\'s Cups', category: 'Candy', costPrice: 0.70, sellPrice: 1.79, stock: 143, reorderLevel: 50 },
  { upc: '0048000011113', name: 'M&M Peanuts', category: 'Candy', costPrice: 0.75, sellPrice: 1.89, stock: 9, reorderLevel: 50 },
  { upc: '0048000011114', name: 'Kit Kat', category: 'Candy', costPrice: 0.60, sellPrice: 1.69, stock: 88, reorderLevel: 50 },
  { upc: '0123456789001', name: 'Marlboro Red', category: 'Tobacco', costPrice: 5.80, sellPrice: 9.49, stock: 96, reorderLevel: 40 },
  { upc: '0123456789002', name: 'Newport 100s', category: 'Tobacco', costPrice: 5.90, sellPrice: 9.79, stock: 72, reorderLevel: 40 },
  { upc: '0123456789003', name: 'Bic Lighter', category: 'Tobacco', costPrice: 0.85, sellPrice: 2.49, stock: 54, reorderLevel: 30 },
  { upc: '0820001000011', name: 'Bud Light 24oz', category: 'Beer', costPrice: 1.65, sellPrice: 3.49, stock: 120, reorderLevel: 48 },
  { upc: '0820001000012', name: 'Miller Lite 24oz', category: 'Beer', costPrice: 1.60, sellPrice: 3.29, stock: 84, reorderLevel: 48 },
  { upc: '0820001000013', name: 'Corona 24oz', category: 'Beer', costPrice: 1.95, sellPrice: 3.99, stock: 12, reorderLevel: 40 },
  { upc: '0200000000099', name: 'Regular Unleaded', category: 'Fuel', costPrice: 3.02, sellPrice: 3.49, stock: 8400, reorderLevel: 2000 },
  { upc: '0200000000100', name: 'Premium Unleaded', category: 'Fuel', costPrice: 3.32, sellPrice: 3.89, stock: 4200, reorderLevel: 1500 },
  { upc: '0200000000101', name: 'Diesel #2', category: 'Fuel', costPrice: 3.42, sellPrice: 3.99, stock: 5600, reorderLevel: 1800 },
  { upc: '0700000010001', name: 'Great Value Water 1L', category: 'Beverages', costPrice: 0.35, sellPrice: 1.29, stock: 210, reorderLevel: 80 },
  { upc: '0700000010002', name: 'Gatorade Fruit Punch', category: 'Beverages', costPrice: 0.95, sellPrice: 2.49, stock: 76, reorderLevel: 48 },
  { upc: '0700000010003', name: 'Tropicana OJ 12oz', category: 'Beverages', costPrice: 0.85, sellPrice: 2.19, stock: 23, reorderLevel: 40 },
  { upc: '0411969100011', name: 'Glad Trash Bags', category: 'Grocery', costPrice: 2.45, sellPrice: 5.99, stock: 34, reorderLevel: 15 },
  { upc: '0411969100012', name: 'Bounty Paper Towels', category: 'Grocery', costPrice: 1.85, sellPrice: 4.49, stock: 7, reorderLevel: 15 },
  { upc: '0411969100013', name: 'Tide Pods 12ct', category: 'Grocery', costPrice: 4.20, sellPrice: 8.99, stock: 22, reorderLevel: 10 },
  { upc: '0705010017001', name: 'Pennzoil 5W-30 Quart', category: 'Automotive', costPrice: 3.20, sellPrice: 6.99, stock: 28, reorderLevel: 12 },
  { upc: '0705010017002', name: 'Rain-X Wiper Fluid', category: 'Automotive', costPrice: 2.10, sellPrice: 5.49, stock: 19, reorderLevel: 10 },
  { upc: '0705010017003', name: 'STP Gas Treatment', category: 'Automotive', costPrice: 1.30, sellPrice: 3.99, stock: 41, reorderLevel: 12 },
  { upc: '0370000000001', name: 'Crest Toothpaste', category: 'Health & Beauty', costPrice: 1.95, sellPrice: 4.29, stock: 33, reorderLevel: 12 },
  { upc: '0370000000002', name: 'Dove Body Wash', category: 'Health & Beauty', costPrice: 2.40, sellPrice: 5.49, stock: 14, reorderLevel: 12 },
  { upc: '0370000000003', name: 'Tylenol 50ct', category: 'Health & Beauty', costPrice: 3.85, sellPrice: 7.99, stock: 18, reorderLevel: 8 },
  { upc: '0044000010001', name: 'Gallon Milk 2%', category: 'Dairy', costPrice: 2.40, sellPrice: 4.29, stock: 27, reorderLevel: 15 },
  { upc: '0044000010002', name: 'Large Eggs Dozen', category: 'Dairy', costPrice: 1.80, sellPrice: 3.49, stock: 31, reorderLevel: 15 },
  { upc: '0044000010003', name: 'Chobani Yogurt', category: 'Dairy', costPrice: 0.85, sellPrice: 1.99, stock: 5, reorderLevel: 24 },
  { upc: '0044000010004', name: 'Kraft Singles', category: 'Dairy', costPrice: 2.10, sellPrice: 4.49, stock: 22, reorderLevel: 10 },
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

// Deterministic pseudo-random for stable mock data
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260618);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T {
  const total = items.reduce((s, i) => s + weightFn(i), 0);
  let r = rng() * total;
  for (const item of items) {
    r -= weightFn(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function generateTransactions(count: number): Transaction[] {
  const transactions: Transaction[] = [];
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(rng() * 7);
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);

    // Peak hours: morning rush 6-9, lunch 11-13, evening rush 16-19
    const hourWeights = Array.from({ length: 24 }, (_, h) => {
      if (h >= 6 && h <= 9) return 8;
      if (h >= 11 && h <= 13) return 6;
      if (h >= 16 && h <= 19) return 10;
      if (h >= 20 && h <= 22) return 5;
      if (h >= 0 && h <= 5) return 1;
      return 3;
    });
    const hour = weightedPick(
      Array.from({ length: 24 }, (_, h) => h),
      (h) => hourWeights[h]
    );

    date.setHours(hour, Math.floor(rng() * 60), Math.floor(rng() * 60));

    // 88% sales, 5% refunds, 4% voids, 3% no-sales
    const typeRoll = rng();
    let type: TransactionType;
    if (typeRoll < 0.88) type = 'Sale';
    else if (typeRoll < 0.93) type = 'Refund';
    else if (typeRoll < 0.97) type = 'Void';
    else type = 'No-Sale';

    const product = weightedPick(products, (p) =>
      p.category === 'Fuel' ? 0.5 : p.category === 'Beverages' ? 2.2 : p.category === 'Beer' ? 1.5 : 1.4
    );

    const cashier = weightedPick(cashiers, (c) => {
      const shiftMatch =
        (c.shift === 'Morning' && hour >= 6 && hour < 14) ||
        (c.shift === 'Evening' && hour >= 14 && hour < 22) ||
        (c.shift === 'Night' && (hour >= 22 || hour < 6));
      return shiftMatch ? 3 : 0.4;
    });

    const paymentType = weightedPick(paymentTypes, (p) => (p === 'Credit' ? 4 : p === 'Debit' ? 3 : p === 'Cash' ? 2 : p === 'Mobile' ? 1.2 : 1));

    let amount: number;
    if (type === 'No-Sale') {
      amount = 0;
    } else if (type === 'Refund') {
      amount = -(product.sellPrice * (1 + Math.floor(rng() * 3)) * (0.9 + rng() * 0.2));
    } else if (product.category === 'Fuel') {
      const gallons = 4 + rng() * 12;
      amount = +(product.sellPrice * gallons).toFixed(2);
    } else {
      const qty = 1 + Math.floor(rng() * 4);
      amount = +(product.sellPrice * qty).toFixed(2);
    }
    amount = +amount.toFixed(2);

    transactions.push({
      id: `TX${String(100000 + i).padStart(6, '0')}`,
      timestamp: date.toISOString(),
      hour,
      date: date.toISOString().split('T')[0],
      item: product.name,
      category: product.category,
      cashierId: cashier.id,
      cashierName: cashier.name,
      register: 1 + Math.floor(rng() * 4),
      paymentType,
      amount,
      type,
    });
  }

  return transactions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export const transactions: Transaction[] = generateTransactions(540);

export const cashierData: Cashier[] = computeCashiers(transactions);

export function computeCashiers(txns: Transaction[]): Cashier[] {
  // Preserve known cashier identities from mock roster; fall back to ID/name in data
  const known = new Map(cashiers.map((c) => [c.id, c]));
  const byId = new Map<string, Transaction[]>();
  for (const t of txns) {
    const arr = byId.get(t.cashierId) || [];
    arr.push(t);
    byId.set(t.cashierId, arr);
  }
  const result: Cashier[] = [];
  for (const [id, cTxns] of Array.from(byId.entries())) {
    const sales = cTxns.filter((t) => t.type === 'Sale');
    const totalSales = +sales.reduce((s, t) => s + t.amount, 0).toFixed(2);
    const refundCount = cTxns.filter((t) => t.type === 'Refund').length;
    const voidCount = cTxns.filter((t) => t.type === 'Void').length;
    const noSaleCount = cTxns.filter((t) => t.type === 'No-Sale').length;
    const refundRate = sales.length ? refundCount / sales.length : 0;
    const voidRate = sales.length ? voidCount / sales.length : 0;
    const noSaleRate = sales.length ? noSaleCount / sales.length : 0;
    const riskScore = Math.min(
      100,
      Math.round(refundRate * 350 + voidRate * 450 + noSaleRate * 180 + (known.get(id)?.id === 'C006' ? 15 : 0) + (known.get(id)?.id === 'C002' ? 8 : 0))
    );
    const knownC = known.get(id);
    result.push({
      id,
      name: cTxns[0]?.cashierName || knownC?.name || `Cashier ${id}`,
      shift: knownC?.shift || 'Morning',
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

// Aggregated dashboard metrics — parameterized so the client can pass uploaded data
export function computeDashboardStats(txns: Transaction[]) {
  const allSales = txns.filter((t) => t.type === 'Sale');
  return {
    totalSales: +allSales.reduce((s, t) => s + t.amount, 0).toFixed(2),
    totalTransactions: txns.length,
    refundCount: txns.filter((t) => t.type === 'Refund').length,
    voidCount: txns.filter((t) => t.type === 'Void').length,
    noSaleCount: txns.filter((t) => t.type === 'No-Sale').length,
    averageTransactionValue: +(allSales.reduce((s, t) => s + t.amount, 0) / (allSales.length || 1)).toFixed(2),
  };
}

// Backwards-compatible default (mock) export
export const dashboardStats = computeDashboardStats(transactions);

export function salesByCategory(txns: Transaction[] = transactions): { category: string; sales: number; pct: number }[] {
  const allSales = txns.filter((t) => t.type === 'Sale');
  const map = new Map<string, number>();
  for (const t of allSales) {
    map.set(t.category, (map.get(t.category) || 0) + t.amount);
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0) || 1;
  return Array.from(map.entries())
    .map(([category, sales]) => ({ category, sales: +sales.toFixed(2), pct: +((sales / total) * 100).toFixed(1) }))
    .sort((a, b) => b.sales - a.sales);
}

export function salesByHour(txns: Transaction[] = transactions): { hour: string; sales: number; transactions: number }[] {
  const allSales = txns.filter((t) => t.type === 'Sale');
  const map = new Map<number, { sales: number; transactions: number }>();
  for (let h = 0; h < 24; h++) map.set(h, { sales: 0, transactions: 0 });
  for (const t of allSales) {
    const e = map.get(t.hour)!;
    e.sales += t.amount;
    e.transactions += 1;
  }
  return Array.from(map.entries()).map(([h, v]) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    sales: +v.sales.toFixed(2),
    transactions: v.transactions,
  }));
}

export function topProducts(limit = 8, txns: Transaction[] = transactions): { name: string; sales: number; units: number; category: string }[] {
  const allSales = txns.filter((t) => t.type === 'Sale');
  const map = new Map<string, { sales: number; units: number; category: string }>();
  for (const t of allSales) {
    const e = map.get(t.item) || { sales: 0, units: 0, category: t.category };
    e.sales += t.amount;
    e.units += 1;
    map.set(t.item, e);
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, sales: +v.sales.toFixed(2), units: v.units, category: v.category }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

export function paymentTypeSplit(txns: Transaction[] = transactions): { name: PaymentType; value: number; pct: number }[] {
  const allSales = txns.filter((t) => t.type === 'Sale');
  const map = new Map<string, number>();
  for (const t of allSales) {
    map.set(t.paymentType, (map.get(t.paymentType) || 0) + t.amount);
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0) || 1;
  return Array.from(map.entries())
    .map(([name, value]) => ({ name: name as PaymentType, value: +value.toFixed(2), pct: +((value / total) * 100).toFixed(1) }))
    .sort((a, b) => b.value - a.value);
}

export function dailySales(txns: Transaction[] = transactions): { date: string; label: string; sales: number; transactions: number }[] {
  const allSales = txns.filter((t) => t.type === 'Sale');
  const map = new Map<string, { sales: number; transactions: number }>();
  for (const t of allSales) {
    const e = map.get(t.date) || { sales: 0, transactions: 0 };
    e.sales += t.amount;
    e.transactions += 1;
    map.set(t.date, e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const d = new Date(date);
      return {
        date,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        sales: +v.sales.toFixed(2),
        transactions: v.transactions,
      };
    });
}

export function lowStockProducts(): Product[] {
  return products
    .filter((p) => p.stock <= p.reorderLevel)
    .sort((a, b) => a.stock / a.reorderLevel - b.stock / b.reorderLevel);
}

export const CHART_COLORS = [
  'hsl(173, 80%, 36%)',
  'hsl(199, 89%, 48%)',
  'hsl(38, 92%, 50%)',
  'hsl(142, 71%, 45%)',
  'hsl(262, 83%, 58%)',
  'hsl(0, 72%, 51%)',
  'hsl(280, 65%, 55%)',
  'hsl(20, 85%, 50%)',
];
