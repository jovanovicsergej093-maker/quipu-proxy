const express = require('express');
const https = require('https');
const app = express();

const PORT = process.env.PORT || 3001;
const QUIPU_API_BASE = 'https://3dss2test.quipu.de:8000';
const MERCHANT_ID = process.env.MERCHANT_ID || 'ECOM_TEST241';
const PROXY_API_KEY = process.env.PROXY_API_KEY || '';

const CLIENT_CERT = process.env.CLIENT_CERT || '';
const CLIENT_KEY = process.env.CLIENT_KEY || '';
const CA_CERT = process.env.CA_CERT || '';

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Proxy-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.headers['x-proxy-key'];
  if (PROXY_API_KEY && key !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mtls: !!CLIENT_CERT });
});

function createMtlsAgent() {
  const options = {};
  if (CLIENT_CERT) options.cert = CLIENT_CERT;
  if (CLIENT_KEY) options.key = CLIENT_KEY;
  if (CA_CERT) options.ca = CA_CERT;
  options.rejectUnauthorized = true;
  return new https.Agent(options);
}

app.post('/create-order', async (req, res) => {
  try {
    const agent = createMtlsAgent();
    const url = `${QUIPU_API_BASE}/order`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Merchant-ID': MERCHANT_ID },
      body: JSON.stringify(req.body),
      dispatcher: agent,
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/order-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { password } = req.query;
    const agent = createMtlsAgent();
    const url = `${QUIPU_API_BASE}/order/${orderId}?password=${encodeURIComponent(password)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Merchant-ID': MERCHANT_ID },
      dispatcher: agent,
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`mTLS proxy running on port ${PORT}`);
});
