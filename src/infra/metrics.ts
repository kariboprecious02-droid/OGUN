/**
 * Lightweight Prometheus-compatible metrics — Execution Spec §13.4.
 *
 * We avoid adding a full metrics library for MVP; this module exposes
 * three primitives (counter, gauge, histogram) with a Prometheus text
 * exposition format renderer. The output is scrape-compatible with
 * Prometheus, Grafana Cloud, and most observability stacks.
 *
 * Usage:
 *   counter('ogun_http_requests_total', { route: '/v1/collections', status: '201' }).inc();
 *   gauge('ogun_wallet_reserved_cents', { sub_merchant: 'smrc_...' }).set(1100);
 *   const timer = histogram('ogun_http_duration_ms', { route: '/v1/collections' }).startTimer();
 *   timer.stop();
 */

type LabelValues = Record<string, string>;

type CounterState = {
  name: string;
  help: string;
  labels: LabelValues;
  value: number;
};

type GaugeState = {
  name: string;
  help: string;
  labels: LabelValues;
  value: number;
};

type HistogramState = {
  name: string;
  help: string;
  labels: LabelValues;
  buckets: number[]; // upper bounds
  counts: number[]; // per-bucket cumulative counts
  sum: number;
  count: number;
};

const counters = new Map<string, CounterState>();
const gauges = new Map<string, GaugeState>();
const histograms = new Map<string, HistogramState>();

const HELP_TEXT: Record<string, string> = {};

function labelKey(name: string, labels: LabelValues): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`);
  return `${name}{${parts.join(',')}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: LabelValues): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`).join(',')}}`;
}

/* ---------- Counter ---------- */

export function counter(
  name: string,
  labels: LabelValues = {},
  help = '',
): { inc: (delta?: number) => void } {
  const key = labelKey(name, labels);
  let state = counters.get(key);
  if (!state) {
    state = { name, help, labels, value: 0 };
    counters.set(key, state);
    if (help) HELP_TEXT[name] = help;
  }
  return {
    inc(delta = 1): void {
      state!.value += delta;
    },
  };
}

/* ---------- Gauge ---------- */

export function gauge(
  name: string,
  labels: LabelValues = {},
  help = '',
): { set: (value: number) => void; inc: (delta?: number) => void; dec: (delta?: number) => void } {
  const key = labelKey(name, labels);
  let state = gauges.get(key);
  if (!state) {
    state = { name, help, labels, value: 0 };
    gauges.set(key, state);
    if (help) HELP_TEXT[name] = help;
  }
  return {
    set(value: number): void {
      state!.value = value;
    },
    inc(delta = 1): void {
      state!.value += delta;
    },
    dec(delta = 1): void {
      state!.value -= delta;
    },
  };
}

/* ---------- Histogram ---------- */

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export function histogram(
  name: string,
  labels: LabelValues = {},
  help = '',
  buckets: number[] = DEFAULT_BUCKETS_MS,
): { observe: (value: number) => void; startTimer: () => { stop: () => void } } {
  const key = labelKey(name, labels);
  let state = histograms.get(key);
  if (!state) {
    state = {
      name,
      help,
      labels,
      buckets,
      counts: new Array(buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    histograms.set(key, state);
    if (help) HELP_TEXT[name] = help;
  }
  const s = state;
  return {
    observe(value: number): void {
      s.sum += value;
      s.count += 1;
      for (let i = 0; i < s.buckets.length; i++) {
        if (value <= s.buckets[i]) {
          s.counts[i] += 1;
        }
      }
    },
    startTimer(): { stop: () => void } {
      const start = Date.now();
      return {
        stop: () => {
          const delta = Date.now() - start;
          s.sum += delta;
          s.count += 1;
          for (let i = 0; i < s.buckets.length; i++) {
            if (delta <= s.buckets[i]) {
              s.counts[i] += 1;
            }
          }
        },
      };
    },
  };
}

/* ---------- Renderer ---------- */

/**
 * Produce the Prometheus text exposition format for all registered
 * metrics. Called by the `/metrics` HTTP handler.
 */
export function renderMetrics(): string {
  const lines: string[] = [];
  const seenNames = new Set<string>();

  const emitHelp = (name: string, type: 'counter' | 'gauge' | 'histogram'): void => {
    if (seenNames.has(name)) return;
    seenNames.add(name);
    const help = HELP_TEXT[name];
    if (help) lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
  };

  for (const c of counters.values()) {
    emitHelp(c.name, 'counter');
    lines.push(`${c.name}${formatLabels(c.labels)} ${c.value}`);
  }
  for (const g of gauges.values()) {
    emitHelp(g.name, 'gauge');
    lines.push(`${g.name}${formatLabels(g.labels)} ${g.value}`);
  }
  for (const h of histograms.values()) {
    emitHelp(h.name, 'histogram');
    for (let i = 0; i < h.buckets.length; i++) {
      const bucketLabels = { ...h.labels, le: String(h.buckets[i]) };
      lines.push(`${h.name}_bucket${formatLabels(bucketLabels)} ${h.counts[i]}`);
    }
    lines.push(`${h.name}_bucket${formatLabels({ ...h.labels, le: '+Inf' })} ${h.count}`);
    lines.push(`${h.name}_sum${formatLabels(h.labels)} ${h.sum}`);
    lines.push(`${h.name}_count${formatLabels(h.labels)} ${h.count}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Reset all metrics (for tests).
 */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
}
