# Monitoring & Alerting Stack

A production-grade observability stack built with **Prometheus**, **Grafana**, **Alertmanager**, and a instrumented **Node.js** application — all running locally via Docker Compose.

![Stack](https://img.shields.io/badge/Prometheus-3.10-orange?logo=prometheus) ![Grafana](https://img.shields.io/badge/Grafana-latest-orange?logo=grafana) ![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js) ![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)

---

## Architecture

```
Your App (:3000)        ──scrape──►
Node Exporter (:9100)   ──scrape──►  Prometheus (:9090)  ──PromQL──►  Grafana (:3001)
Prometheus self (:9090) ──scrape──►       │
                                          │ fire alerts
                                          ▼
                                   Alertmanager (:9093)
                                          │
                                          ▼
                                   Slack / Email / Webhook
```

## Features

- **Instrumented Node.js app** — HTTP request counts, latency histograms, error rates via `prom-client`
- **Prometheus** — pulls metrics from all targets every 15 seconds, evaluates alert rules
- **Grafana** — Four Golden Signals dashboard (traffic, errors, latency, saturation)
- **Node Exporter** — host-level CPU, memory, disk, and network metrics
- **Alertmanager** — deduplicates, groups, and routes alerts to Slack
- **Three alert rules** — HighErrorRate, HighLatency, HighCPU with production-safe `for:` durations

---

## Project Structure

```
monitoring-stack/
├── docker-compose.yml
├── alertmanager.yml
├── prometheus/
│   ├── prometheus.yml
│   └── alerts.yml
└── app/
    ├── index.js
    ├── package.json
    └── Dockerfile
```

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose plugin
- Node.js 20+ (only needed if running the app outside Docker)

Verify Docker Compose is available:

```bash
docker compose version
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/monitoring-stack.git
cd monitoring-stack

# 2. Start the full stack
docker compose up --build -d

# 3. Verify all containers are running
docker compose ps
```

Open the UIs:

| Service | URL | Credentials |
|---|---|---|
| Grafana | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |
| App metrics | http://localhost:3000/metrics | — |

---

## Services

### Node.js App (`app/`)

Exposes a `/metrics` endpoint using [`prom-client`](https://github.com/siimon/prom-client). Instruments every request with:

```js
// Counter — total requests by method, route, status
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  labelNames: ['method', 'route', 'status'],
});

// Histogram — latency distribution (used for P95/P99)
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
});
```

Also collects default Node.js metrics: heap usage, event loop lag, GC duration, open file descriptors.

---

### Prometheus (`prometheus/`)

**`prometheus.yml`** — scrape configuration:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'app'
    static_configs:
      - targets: ['app:3000']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
```

**`alerts.yml`** — three alert rules:

| Alert | Condition | For | Severity |
|---|---|---|---|
| `HighErrorRate` | 5xx rate > 5% | 2m | critical |
| `HighLatency` | P95 latency > 1s | 5m | warning |
| `HighCPU` | CPU usage > 80% | 10m | warning |

---

### Grafana

**Four Golden Signals dashboard** — import by pasting these PromQL queries into new panels:

```promql
# Traffic — requests per second
rate(http_requests_total[5m])

# Errors — error rate as a ratio
rate(http_requests_total{status=~"5.."}[5m])
/ rate(http_requests_total[5m])

# Latency — 95th percentile response time
histogram_quantile(0.95,
  rate(http_request_duration_seconds_bucket[5m]))

# Saturation — CPU usage %
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

Also import **Node Exporter Full** (Dashboard ID `1860`) for complete host metrics.

---

### Alertmanager

Configure your Slack webhook in `alertmanager.yml`:

```yaml
receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        channel: '#alerts'
        send_resolved: true
```

Get a webhook URL at [api.slack.com/apps](https://api.slack.com/apps) → Incoming Webhooks.

---

## Useful Commands

```bash
# View logs for a specific service
docker logs monitoring-stack-prometheus-1 -f

# Check Prometheus targets are UP
open http://localhost:9090/targets

# Check alert rules loaded
open http://localhost:9090/rules

# Trigger a test alert (hammer with 404s to spike error rate)
for i in {1..200}; do curl -s http://localhost:3000/nonexistent > /dev/null; done

# Reload Prometheus config without restart
curl -X POST http://localhost:9090/-/reload

# Stop the stack
docker compose down

# Stop and remove volumes (wipes stored metrics)
docker compose down -v
```

---

## Key PromQL Queries

```promql
# Request rate per second
rate(http_requests_total[5m])

# Error rate percentage
rate(http_requests_total{status=~"5.."}[5m])
/ rate(http_requests_total[5m]) * 100

# P95 and P99 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# Memory used by the app
nodejs_heap_size_used_bytes

# Event loop lag (ms) — high value = event loop blocked
nodejs_eventloop_lag_p99_seconds * 1000

# CPU usage per core
rate(node_cpu_seconds_total{mode!="idle"}[5m]) * 100
```

---

## Metric Naming Conventions

This project follows the [Prometheus naming best practices](https://prometheus.io/docs/practices/naming/):

- Format: `namespace_subsystem_name_unit`
- Units are always base units: `_seconds` (not ms), `_bytes` (not KB)
- Counters end in `_total`
- No high-cardinality label values (no user IDs, request IDs, or raw URLs)

---

## Extending the Stack

**Add a database exporter** (e.g. PostgreSQL):
```yaml
# docker-compose.yml
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter
    environment:
      DATA_SOURCE_NAME: "postgresql://user:pass@db:5432/mydb?sslmode=disable"
    ports: ["9187:9187"]
```

**Add a new alert rule** in `prometheus/alerts.yml`:
```yaml
- alert: HighMemory
  expr: nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes > 0.9
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Heap usage above 90%"
```

Then reload: `curl -X POST http://localhost:9090/-/reload`

---

## Skills Demonstrated

- **Observability** — metrics instrumentation, scraping architecture, pull vs push model
- **PromQL** — rate(), histogram_quantile(), label filtering, aggregation
- **Dashboards** — Four Golden Signals methodology, Grafana panel configuration
- **Alerting** — rule evaluation, `for:` durations, Alertmanager routing, inhibition rules
- **Docker Compose** — multi-service orchestration, volume mounts, service networking
- **Metric design** — naming conventions, cardinality management, label strategy

---

## References

- [Prometheus documentation](https://prometheus.io/docs/)
- [Grafana documentation](https://grafana.com/docs/)
- [prom-client for Node.js](https://github.com/siimon/prom-client)
- [Google SRE Book — Four Golden Signals](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)

---

## License

MIT
