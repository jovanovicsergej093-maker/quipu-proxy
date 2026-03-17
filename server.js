const express = require("express");
const https = require("https");
const app = express();

app.use(express.json());

const QUIPU_BASE = "https://3dss2.quipu.de:8443";

const parsePem = (env) => (env || "").replace(/\\n/g, "\n");

const cert = parsePem(process.env.QUIPU_CLIENT_CERT);
const key = parsePem(process.env.QUIPU_CLIENT_KEY);
const ca = parsePem(process.env.QUIPU_CA_CERT);

app.post("/order", async (req, res) => {
  try {
    const body = JSON.stringify(req.body);
    console.log("Creating order:", body.substring(0, 200));
    const data = await makeRequest("POST", "/order", body);
    res.json(data);
  } catch (err) {
    console.error("Order error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get("/order/:id", async (req, res) => {
  try {
    const path = `/order/${req.params.id}?password=${encodeURIComponent(req.query.password || "")}`;
    console.log("Getting status:", path);
    const data = await makeRequest("GET", path);
    res.json(data);
  } catch (err) {
    console.error("Status error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "3dss2.quipu.de",
      port: 8443,
      path,
      method,
      cert,
      key,
      ca,
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json" },
    };
    if (body) options.headers["Content-Length"] = Buffer.byteLength(body);

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        console.log("Quipu response:", response.statusCode, data.substring(0, 300));
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid response: ${data}`)); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`mTLS proxy running on port ${PORT}`));
