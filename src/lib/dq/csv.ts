import Papa from "papaparse";
import type { Row } from "./types";

export function parseCsv(text: string): { rows: Row[]; errors: string[]; fields: string[] } {
  const res = Papa.parse<Row>(text, { header: true, skipEmptyLines: "greedy", dynamicTyping: false, transformHeader: (h) => h.trim() });
  const errors = res.errors.slice(0, 5).map((e) => `Row ${(e.row ?? 0) + 1}: ${e.message}`);
  return { rows: res.data, errors, fields: res.meta.fields ?? [] };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))));
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
