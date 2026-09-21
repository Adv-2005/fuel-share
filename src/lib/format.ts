export function formatMoney(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

export function formatLitres(millilitres: number): string {
  return `${(millilitres / 1000).toFixed(millilitres < 1000 ? 2 : 1)} L`;
}

export function formatDistance(metres: number): string {
  return `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`;
}

export function toLocalDateTimeInput(iso = new Date().toISOString()): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function fromLocalDateTimeInput(value: string): string {
  return new Date(value).toISOString();
}
