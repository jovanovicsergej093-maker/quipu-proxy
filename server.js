const express = require("express");
const https = require("https");

const app = express();
app.use(express.json());

const parsePem = (env) => (env || "").replace(/\\n/g, "\n");
const cert = parsePem(process.env.QUIPU_CLIENT_CERT);
const key = parsePem(process.env.QUIPU_CLIENT_KEY);
const ca = parsePem(process.env.QUIPU_CA_CERT);

const MERCHANT_ID = process.env.MERCHANT_ID || "ECOM_TEST241";
const BANK_HOST = process.env.BANK_HOST || "3dss2.quipu.de";
const BANK_PORT = parseInt(process.env.BANK_PORT || "8443");

// Helper: make mTLS request to bank (JSON)
function makeBankRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : "";
    const options = {
      hostname: BANK_HOST,
      port: BANK_PORT,
      path,
      method,
      cert,
      key,
      ca,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    if (bodyStr) {
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        console.log("Bank response:", response.statusCode, data.substring(0, 500));
        resolve({ statusCode: response.statusCode, body: data });
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// POST /order - Create payment order (JSON API per Quipu docs)
app.post("/order", async (req, res) => {
  try {
    const { amount, currency, description, approveUrl } = req.body;

    const orderPayload = {
      order: {
        typeRid: "ORD1",
        amount: parseFloat(amount).toFixed(2),
        currency: currency || "EUR",
        description: description || "Online payment",
        language: "en",
        hppRedirectUrl: approveUrl,
        initiationEnvKind: "Browser",
        consumerDevice: {
          browser: {
            javaEnabled: false,
            jsEnabled: true,
            acceptHeader: "application/json,application/jose;charset=utf-8",
            ip: "127.0.0.1",
            colorDepth: "24",
            screenW: "1920",
            screenH: "1080",
            tzOffset: "-60",
            language: "sr-RS",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        }
      }
    };

    console.log("Sending JSON to bank:", JSON.stringify(orderPayload));

    const result = await makeBankRequest("POST", "/order", orderPayload);

    let data;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      throw new Error(`Failed to parse bank response: ${result.body.substring(0, 300)}`);
    }

    if (data.order && data.order.id && data.order.password) {
      const hppUrl = data.order.hppUrl || `https://${BANK_HOST}:8009/flex`;
      const paymentUrl = `${hppUrl}?id=${data.order.id}&password=${data.order.password}`;

      res.json({
        success: true,
        orderId: String(data.order.id),
        password: data.order.password,
        paymentUrl,
        status: data.order.status,
      });
    } else {
      res.status(400).json({
        success: false,
        error: data.errorDescription || data.error || `Unexpected response`,
        rawResponse: result.body.substring(0, 500),
      });
    }
  } catch (err) {
    console.error("Order error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /order-status/:id - Get order details (JSON API per Quipu docs)
app.get("/order-status/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    const password = req.query.password || "";

    const path = `/order/${orderId}?password=${encodeURIComponent(password)}&tranDetailLevel=1`;
    
    console.log("Getting order status:", path);

    const result = await makeBankRequest("GET", path, null);

    let data;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      throw new Error(`Failed to parse bank response: ${result.body.substring(0, 300)}`);
    }

    res.json({
      success: true,
      order: data.order || data,
    });
  } catch (err) {
    console.error("Status error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /order-status - backward compat
app.post("/order-status", async (req, res) => {
  try {
    const { orderId, password } = req.body;
    const path = `/order/${orderId}?password=${encodeURIComponent(password || "")}&tranDetailLevel=1`;

    console.log("Getting order status (POST):", path);

    const result = await makeBankRequest("GET", path, null);

    let data;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      throw new Error(`Failed to parse bank response: ${result.body.substring(0, 300)}`);
    }

    const orderStatus = data.order?.status || "UNKNOWN";

    res.json({
      success: true,
      orderId,
      orderStatus,
      rawResponse: result.body.substring(0, 500),
    });
  } catch (err) {
    console.error("Status error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    mtls: Boolean(cert && key && ca),
    merchantId: MERCHANT_ID,
    apiFormat: "JSON",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`mTLS proxy running on port ${PORT}`));
