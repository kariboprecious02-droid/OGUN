import { counter, gauge, histogram, renderMetrics, resetMetrics } from './metrics';

describe('metrics primitives', () => {
  beforeEach(() => {
    resetMetrics();
  });

  test('counter inc accumulates', () => {
    const c = counter('test_counter_total', { tag: 'x' }, 'test counter');
    c.inc();
    c.inc(3);
    const rendered = renderMetrics();
    expect(rendered).toContain('# HELP test_counter_total test counter');
    expect(rendered).toContain('# TYPE test_counter_total counter');
    expect(rendered).toContain('test_counter_total{tag="x"} 4');
  });

  test('counter with different labels are separate series', () => {
    counter('ogun_demo_total', { route: '/a' }).inc();
    counter('ogun_demo_total', { route: '/a' }).inc();
    counter('ogun_demo_total', { route: '/b' }).inc();
    const rendered = renderMetrics();
    expect(rendered).toContain('ogun_demo_total{route="/a"} 2');
    expect(rendered).toContain('ogun_demo_total{route="/b"} 1');
  });

  test('gauge set/inc/dec', () => {
    const g = gauge('test_gauge', {}, 'test gauge');
    g.set(10);
    g.inc(5);
    g.dec(3);
    const rendered = renderMetrics();
    expect(rendered).toContain('test_gauge 12');
  });

  test('histogram observe accumulates buckets', () => {
    const h = histogram('test_hist_ms', {}, 'test hist', [10, 100, 1000]);
    h.observe(5);
    h.observe(50);
    h.observe(500);
    h.observe(5000);
    const rendered = renderMetrics();
    expect(rendered).toContain('# TYPE test_hist_ms histogram');
    // le=10 captures only 5
    expect(rendered).toContain('test_hist_ms_bucket{le="10"} 1');
    // le=100 captures 5 and 50
    expect(rendered).toContain('test_hist_ms_bucket{le="100"} 2');
    // le=1000 captures 5, 50, 500
    expect(rendered).toContain('test_hist_ms_bucket{le="1000"} 3');
    // le=+Inf captures all 4
    expect(rendered).toContain('test_hist_ms_bucket{le="+Inf"} 4');
    expect(rendered).toContain('test_hist_ms_sum 5555');
    expect(rendered).toContain('test_hist_ms_count 4');
  });

  test('renderMetrics output is Prometheus-scrape-compatible', () => {
    counter('a_total').inc();
    gauge('a_current').set(42);
    const out = renderMetrics();
    // Must end with newline
    expect(out.endsWith('\n')).toBe(true);
    // Must have TYPE + value lines (empty label set is omitted,
    // which is valid Prometheus exposition format)
    expect(out).toMatch(/# TYPE a_total counter\na_total 1/);
    expect(out).toMatch(/# TYPE a_current gauge\na_current 42/);
  });
});
