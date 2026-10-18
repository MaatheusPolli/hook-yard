// Teste de carga do recebimento: 500 req/s por 30s, p95 < 50ms.
//   docker run --rm -i --network host grafana/k6 run - < tests/load/receive.k6.js
//   (variáveis: API_URL, SOURCE, SECRET, RATE, DURATION)
import crypto from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const SOURCE = __ENV.SOURCE || 'mercadolivre';
const SECRET = __ENV.SECRET || 'dev-secret-mercadolivre';

export const options = {
  scenarios: {
    receive: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 500),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<50'],
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const id = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({ id, type: 'order.created', data: { orderId: id, total: 99.9 } });
  const signature = 'sha256=' + crypto.hmac('sha256', SECRET, body, 'hex');
  const res = http.post(`${API_URL}/webhooks/${SOURCE}`, body, {
    headers: { 'content-type': 'application/json', 'x-hookyard-signature': signature },
  });
  check(res, { 'status 202': (r) => r.status === 202 });
}
