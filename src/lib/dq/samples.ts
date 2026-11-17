import type { Row, RuleParams, RuleType, Severity } from "./types";

// Deterministic pseudo-random so demo data is reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Priya", "Ethan", "Zara", "Lucas", "Ananya", "Omar", "Chloe", "Ravi", "Emma", "Kenji", "Isla"];
const LAST = ["Sharma", "Chen", "Patel", "Garcia", "Kim", "Nair", "Okafor", "Silva", "Müller", "Rossi", "Singh", "Brown"];
const CITIES = ["Mumbai", "Bengaluru", "London", "Berlin", "Toronto", "Singapore", "Austin", "Sydney"];
const date = (r: () => number, y = 2026) => `${y}-${String(1 + Math.floor(r() * 10)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;

function customers(n: number): Row[] {
  const r = rng(11);
  return Array.from({ length: n }, (_, i) => {
    const f = pick(r, FIRST), l = pick(r, LAST);
    return { customer_id: `C${1001 + i}`, first_name: f, last_name: l, email: `${f}.${l}${i}@example.com`.toLowerCase(), age: String(18 + Math.floor(r() * 60)), city: pick(r, CITIES), signup_date: date(r), is_active: r() > 0.2 ? "true" : "false" };
  });
}
function sales(n: number): Row[] {
  const r = rng(23);
  const products = ["Laptop", "Monitor", "Keyboard", "Mouse", "Headset", "Dock"];
  return Array.from({ length: n }, (_, i) => {
    const q = 1 + Math.floor(r() * 9), price = Math.round((20 + r() * 900) * 100) / 100;
    return { order_id: `SO-${50001 + i}`, customer_id: `C${1001 + Math.floor(r() * 60)}`, product: pick(r, products), quantity: String(q), unit_price: price.toFixed(2), order_date: date(r), region: pick(r, ["APAC", "EMEA", "NA", "LATAM"]) };
  });
}
function employees(n: number): Row[] {
  const r = rng(37);
  return Array.from({ length: n }, (_, i) => {
    const f = pick(r, FIRST), l = pick(r, LAST);
    return { employee_id: `E${2001 + i}`, full_name: `${f} ${l}`, email: `${f}.${l}@corp.example`.toLowerCase(), department: pick(r, ["Engineering", "Finance", "Sales", "HR", "Operations"]), salary: String(40000 + Math.floor(r() * 120000)), hire_date: date(r, 2015 + Math.floor(r() * 10)), age: String(22 + Math.floor(r() * 40)) };
  });
}
function inventory(n: number): Row[] {
  const r = rng(53);
  const cats = ["Electronics", "Furniture", "Stationery", "Kitchen"];
  return Array.from({ length: n }, (_, i) => ({ sku: `SKU-${3001 + i}`, product_name: `${pick(r, ["Pro", "Lite", "Max", "Mini"])} ${pick(r, ["Desk", "Lamp", "Chair", "Cable", "Kettle", "Notebook"])}`, category: pick(r, cats), stock_qty: String(Math.floor(r() * 500)), unit_cost: (2 + r() * 300).toFixed(2), reorder_level: String(10 + Math.floor(r() * 40)), last_restocked: date(r) }));
}

/** Corrupt a clean copy: missing values, duplicates, invalid ranges, wrong types, a dropped column, and fewer rows. */
function corrupt(rows: Row[], spec: { nullCol: string; rangeCol: string; badRange: string; typeCol: string; badType: string; dropCol?: string; emailCol?: string }): Row[] {
  const out = rows.slice(0, Math.floor(rows.length * 0.7)).map((r) => ({ ...r }));
  [2, 9, 17].forEach((i) => out[i] && (out[i][spec.nullCol] = ""));
  [4, 21].forEach((i) => out[i] && (out[i][spec.rangeCol] = spec.badRange));
  [6, 13].forEach((i) => out[i] && (out[i][spec.typeCol] = spec.badType));
  if (spec.emailCol) [8, 25].forEach((i) => out[i] && (out[i][spec.emailCol!] = "not-an-email"));
  out.push({ ...out[1] }, { ...out[5] });
  if (spec.dropCol) out.forEach((r) => delete r[spec.dropCol!]);
  return out;
}

export interface SampleRule {
  rule_name: string;
  column_name: string | null;
  rule_type: RuleType;
  parameters: RuleParams;
  severity: Severity;
}
export interface SampleDataset {
  key: string;
  name: string;
  filename: string;
  rows: Row[];
  rules: SampleRule[];
}

const rc = (cols: string[]): SampleRule => ({ rule_name: "Expected schema", column_name: null, rule_type: "required_columns", parameters: { columns: cols }, severity: "critical" });
const cnt = (): SampleRule => ({ rule_name: "Record count drift ≤ 20%", column_name: null, rule_type: "record_count", parameters: { min: 1, maxChangePct: 20 }, severity: "warning" });

export function buildSamples(): SampleDataset[] {
  const c = customers(60), s = sales(80), e = employees(50), p = inventory(60);
  const cRules: SampleRule[] = [
    rc(Object.keys(c[0]!)), cnt(),
    { rule_name: "Unique customer_id", column_name: null, rule_type: "duplicate", parameters: { columns: ["customer_id"] }, severity: "error" },
    { rule_name: "Email required", column_name: "email", rule_type: "not_null", parameters: {}, severity: "error" },
    { rule_name: "Valid email format", column_name: "email", rule_type: "custom", parameters: { operator: "email" }, severity: "error" },
    { rule_name: "Age must be > 0", column_name: "age", rule_type: "custom", parameters: { operator: "gt", value: 0 }, severity: "error" },
    { rule_name: "Age within 0–120", column_name: "age", rule_type: "range", parameters: { min: 0, max: 120 }, severity: "error" },
    { rule_name: "Signup date is a date", column_name: "signup_date", rule_type: "data_type", parameters: { type: "date" }, severity: "warning" },
  ];
  const sRules: SampleRule[] = [
    rc(Object.keys(s[0]!)), cnt(),
    { rule_name: "Unique order_id", column_name: null, rule_type: "duplicate", parameters: { columns: ["order_id"] }, severity: "error" },
    { rule_name: "Quantity must be > 0", column_name: "quantity", rule_type: "custom", parameters: { operator: "gt", value: 0 }, severity: "error" },
    { rule_name: "Quantity is integer", column_name: "quantity", rule_type: "data_type", parameters: { type: "integer" }, severity: "error" },
    { rule_name: "Price not negative", column_name: "unit_price", rule_type: "range", parameters: { min: 0 }, severity: "critical" },
    { rule_name: "Product required", column_name: "product", rule_type: "not_null", parameters: {}, severity: "error" },
  ];
  const eRules: SampleRule[] = [
    rc(Object.keys(e[0]!)), cnt(),
    { rule_name: "Unique employee_id", column_name: null, rule_type: "duplicate", parameters: { columns: ["employee_id"] }, severity: "error" },
    { rule_name: "Department required (fill Unassigned)", column_name: "department", rule_type: "not_null", parameters: { fillValue: "Unassigned" }, severity: "warning" },
    { rule_name: "Salary range", column_name: "salary", rule_type: "range", parameters: { min: 10000, max: 500000 }, severity: "error" },
    { rule_name: "Hire date is a date", column_name: "hire_date", rule_type: "data_type", parameters: { type: "date" }, severity: "error" },
  ];
  const pRules: SampleRule[] = [
    rc(Object.keys(p[0]!)), cnt(),
    { rule_name: "Exact duplicate rows", column_name: null, rule_type: "duplicate", parameters: {}, severity: "error" },
    { rule_name: "Stock not negative", column_name: "stock_qty", rule_type: "range", parameters: { min: 0 }, severity: "error" },
    { rule_name: "Unit cost is float", column_name: "unit_cost", rule_type: "data_type", parameters: { type: "float" }, severity: "error" },
    { rule_name: "Category required", column_name: "category", rule_type: "not_null", parameters: {}, severity: "error" },
  ];
  return [
    { key: "customers_clean", name: "Customers — Clean", filename: "customers_clean.csv", rows: c, rules: cRules },
    { key: "customers_corrupt", name: "Customers — Corrupted", filename: "customers_corrupted.csv", rows: corrupt(c, { nullCol: "email", rangeCol: "age", badRange: "-4", typeCol: "signup_date", badType: "yesterday", emailCol: "email", dropCol: "is_active" }), rules: cRules },
    { key: "sales_clean", name: "Sales — Clean", filename: "sales_clean.csv", rows: s, rules: sRules },
    { key: "sales_corrupt", name: "Sales — Corrupted", filename: "sales_corrupted.csv", rows: corrupt(s, { nullCol: "product", rangeCol: "unit_price", badRange: "-19.99", typeCol: "quantity", badType: "two", dropCol: "region" }), rules: sRules },
    { key: "employees_clean", name: "Employees — Clean", filename: "employees_clean.csv", rows: e, rules: eRules },
    { key: "employees_corrupt", name: "Employees — Corrupted", filename: "employees_corrupted.csv", rows: corrupt(e, { nullCol: "department", rangeCol: "salary", badRange: "999", typeCol: "hire_date", badType: "N/A" }), rules: eRules },
    { key: "inventory_clean", name: "Inventory — Clean", filename: "inventory_clean.csv", rows: p, rules: pRules },
    { key: "inventory_corrupt", name: "Inventory — Corrupted", filename: "inventory_corrupted.csv", rows: corrupt(p, { nullCol: "category", rangeCol: "stock_qty", badRange: "-12", typeCol: "unit_cost", badType: "twelve" }), rules: pRules },
  ];
}
