const CENTS_PER_UNIT = 100;

export function toCents(amount: number): number {
  return Math.round(amount * CENTS_PER_UNIT);
}

export function fromCents(cents: number): number {
  return cents / CENTS_PER_UNIT;
}

export function formatCents(cents: number, currency: string): string {
  return `${fromCents(cents).toFixed(2)} ${currency}`;
}
