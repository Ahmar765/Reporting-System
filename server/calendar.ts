// Calendar arithmetic uses UTC calendar dates; Intl resolves IANA timezone offsets.
// Kept small to avoid relying on the server's local timezone.
type Options = {
  zone?: string;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, zone: string) {
  if (zone === 'UTC') {
    const d = new Date(ms);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    };
  }
  const result: Record<string, number> = {};
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    formatters.set(zone, formatter);
  }
  for (const p of formatter.formatToParts(ms)) if (p.type !== 'literal') result[p.type] = Number(p.value);
  return result;
}
function fromWall(y: number, m: number, d: number, h: number, min: number, s: number, zone: string) {
  const wall = Date.UTC(y, m - 1, d, h, min, s);
  if (zone === 'UTC') return wall;
  let candidate = wall;
  for (let i = 0; i < 5; i++) {
    const p = parts(candidate, zone);
    const delta = wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (delta === 0) return candidate;
    candidate += delta;
  }
  return candidate;
}
export class DateTime {
  constructor(private ms: number, private zone = 'UTC') {}
  static fromJSDate(d: Date, o: Options = {}) {
    return new DateTime(d.getTime(), o.zone || 'UTC');
  }
  static now() {
    return new DateTime(Date.now());
  }
  static fromISO(value: string, o: Options = {}) {
    const zone = o.zone || 'UTC';
    if (/Z$|[+-]\d\d:\d\d$/.test(value)) return new DateTime(Date.parse(value), zone);
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
    if (!m) return new DateTime(NaN, zone);
    const y = +m[1],
      mo = +m[2],
      d = +m[3],
      h = +(m[4] || 0),
      min = +(m[5] || 0),
      s = +(m[6] || 0);
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || min > 59 || s > 59) return new DateTime(NaN, zone);
    try {
      return new DateTime(fromWall(y, mo, d, h, min, s, zone), zone);
    } catch {
      return new DateTime(NaN, zone);
    }
  }
  get isValid() {
    try {
      return Number.isFinite(this.ms) && !!parts(this.ms, this.zone);
    } catch {
      return false;
    }
  }
  private get p() {
    return parts(this.ms, this.zone);
  }
  get weekday() {
    const p = this.p;
    return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() || 7;
  }
  get day() {
    return this.p.day;
  }
  valueOf() {
    return this.ms;
  }
  toMillis() {
    return this.ms;
  }
  toISO() {
    return new Date(this.ms).toISOString();
  }
  toISODate() {
    const p = this.p;
    return String(p.year).padStart(4, '0') + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }
  setZone(zone: string) {
    return new DateTime(this.ms, zone);
  }
  toUTC() {
    return this.setZone('UTC');
  }
  plus(v: {
    days?: number;
    minutes?: number;
  }) {
    if (v.minutes) return new DateTime(this.ms + v.minutes * 60000, this.zone);
    const p = this.p;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + (v.days || 0)));
    return new DateTime(fromWall(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.hour, p.minute, p.second, this.zone), this.zone);
  }
  minus(v: {
    days?: number;
    minutes?: number;
  }) {
    return this.plus({
      days: -(v.days || 0),
      minutes: -(v.minutes || 0)
    });
  }
  startOf(unit: 'week' | 'month') {
    const date = this.toISODate();
    const d = DateTime.fromISO(date, {
      zone: this.zone
    });
    return unit === 'week' ? d.minus({
      days: this.weekday - 1
    }) : d.minus({
      days: this.day - 1
    });
  }
  endOf(unit: 'week' | 'month') {
    const d = this.startOf(unit);
    if (unit === 'week') return d.plus({
      days: 6
    });
    const p = d.p;
    return d.plus({
      days: new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() - 1
    });
  }
  diff(other: DateTime, _unit: 'days') {
    return {
      days: (this.ms - other.ms) / 86400000
    };
  }
  toFormat(format: string) {
    const p = this.p;
    if (format === 'HH:mm') return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
    if (format === 'yyyy-MM') return this.toISODate().slice(0, 7);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.zone,
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(this.ms) + ' ' + this.zone;
  }
}
