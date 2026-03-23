const express = require('express');
const client = require('prom-client');

const app = express();
const register = new client.Registry();

// Default metrics: event loop lag, GC, memory, etc.
client.collectDefaultMetrics({ register });

// Custom counter: track HTTP requests
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// Custom histogram: track response time
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

// Middleware: instrument every request
app.use((req, res, next) => {
  const end = httpDuration.startTimer({
    method: req.method,
    route: req.path
  });
  res.on('finish', () => {
    httpRequests.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode
    });
    end();
  });
  next();
});

app.get('/', (req, res) => res.send('Hello World'));

// Prometheus scrapes this endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.listen(3000, () => console.log('App running on :3000'));
