const express = require("express");
const https = require("https");

const app = express();
app.use(express.json());

const parsePem = (env) => (env || "").replace(/\\n/g, "\n");
const cert = parsePem(process.env.QUIPU_CLIENT_CERT);
const key = parsePem(process.env.QUIPU_CLIENT_KEY);
const ca = parsePem(process.env.QUIPU_CA_CERT);

const MERCHANT_ID = process.env.MERCHANT_ID || "ECOM_TEST241";

// Helper: make mTLS request to bank
function makeBankRequest(path, body, contentType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "3dss2.quipu.de",
      port: 8443,
      path,
      method: "POST",
      cert,
      key,
      ca,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": contentType || "application/xml",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        console.log("Bank response:", response.statusCode, data.substring(0, 500));
        resolve({ statusCode: response.statusCode, body: data });
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Helper: extract XML tag value
function extractXml(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

// POST /order - Create payment order via XML
app.post("/order", async (req, res) => {
  try {
    const { amount, currency, description, approveUrl, cancelUrl, declineUrl } = req.body;

    // Amount in minor units (cents): 25.98 EUR -> 2598
    const amountMinor = Math.round(parseFloat(amount) * 100);
    // Currency as ISO 4217 numeric code (EUR = 978, RSD = 941)
    const currencyCode = currency || "978";

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<TKKPG>
  <Request>
    <Operation>CreateOrder</Operation>
    <Language>EN</Language>
    <Order>
      <OrderType>Purchase</OrderType>
      <Merchant>${MERCHANT_ID}</Merchant>
      <Amount>${amountMinor}</Amount>
      <Currency>${currencyCode}</Currency>
      <Description>${description || "Online payment"}</Description>
      <ApproveURL>${approveUrl}</ApproveURL>
      <CancelURL>${cancelUrl || approveUrl}</CancelURL>
      <DeclineURL>${declineUrl || approveUrl}</DeclineURL>
    </Order>
  </Request>
</TKKPG>`;

    console.log("Sending XML to bank:", xmlBody);

    const result = await makeBankRequest("/Exec", xmlBody);

    // Parse XML response
    const status = extractXml(result.body, "Status");
    const orderId = extractXml(result.body, "OrderID");
    const sessionId = extractXml(result.body, "SessionID");
    const url = extractXml(result.body, "URL");

    if (status === "00" && orderId && sessionId) {
      // Construct payment URL
      const paymentUrl = url
        ? `${url}?ORDERID=${orderId}&SESSIONID=${sessionId}`
        : `https://3dss2.quipu.de/index.jsp?ORDERID=${orderId}&SESSIONID=${sessionId}`;

      res.json({
        success: true,
        orderId,
        sessionId,
        paymentUrl,
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Bank returned status: ${status}`,
        rawResponse: result.body.substring(0, 500),
      });
    }
  } catch (err) {
    console.error("Order error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /order-status - Get order status via XML
app.post("/order-status", async (req, res) => {
  try {
    const { orderId, sessionId } = req.body;

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<TKKPG>
  <Request>
    <Operation>GetOrderStatus</Operation>
    <Language>EN</Language>
    <Order>
      <Merchant>${MERCHANT_ID}</Merchant>
      <OrderID>${orderId}</OrderID>
    </Order>
    <SessionID>${sessionId}</SessionID>
  </Request>
</TKKPG>`;

    console.log("Getting order status:", xmlBody);

    const result = await makeBankRequest("/Exec", xmlBody);

    const status = extractXml(result.body, "Status");
    const orderStatus = extractXml(result.body, "OrderStatus");

    res.json({
      success: status === "00",
      orderId,
      orderStatus: orderStatus || "UNKNOWN",
      rawResponse: result.body.substring(0, 500),
    });
  } catch (err) {
    console.error("Status error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// Keep old GET endpoint for backward compat
app.get("/order/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    const sessionId = req.query.password || req.query.sessionId || "";

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<TKKPG>
  <Request>
    <Operation>GetOrderStatus</Operation>
    <Language>EN</Language>
    <Order>
      <Merchant>${MERCHANT_ID}</Merchant>
      <OrderID>${orderId}</OrderID>
    </Order>
    <SessionID>${sessionId}</SessionID>
  </Request>
</TKKPG>`;

    const result = await makeBankRequest("/Exec", xmlBody);

    const status = extractXml(result.body, "Status");
    const orderStatus = extractXml(result.body, "OrderStatus");

    res.json({
      success: status === "00",
      order: {
        id: orderId,
        status: orderStatus || "UNKNOWN",
      },
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
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`mTLS proxy running on port ${PORT}`));
