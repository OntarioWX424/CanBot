"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3000;
const ECCC_INTERVAL = 5000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let initialized = false;
let lastCheck = null;
let lastError = null;
let activeAlerts = new Map();

const PROVINCES = {
    BC: "British Columbia",
    AB: "Alberta",
    SK: "Saskatchewan",
    MB: "Manitoba",
    ON: "Ontario",
    QC: "Quebec",
    NB: "New Brunswick",
    NS: "Nova Scotia",
    PE: "Prince Edward Island",
    NL: "Newfoundland and Labrador",
    YT: "Yukon",
    NT: "Northwest Territories",
    NU: "Nunavut"
};

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/\r/g, "")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            {
                headers: {
                    "User-Agent": "CanBot/1.0 Canadian Alert Network",
                    "Accept": "application/geo+json, application/json"
                }
            },
            response => {
                let body = "";

                response.setEncoding("utf8");

                response.on("data", chunk => {
                    body += chunk;
                });

                response.on("end", () => {
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        reject(
                            new Error(
                                `GeoMet HTTP ${response.statusCode}: ${body.slice(0, 300)}`
                            )
                        );
                        return;
                    }

                    try {
                        resolve(JSON.parse(body));
                    } catch (error) {
                        reject(
                            new Error(
                                "GeoMet returned invalid JSON: " + error.message
                            )
                        );
                    }
                });
            }
        );

        request.setTimeout(15000, () => {
            request.destroy(new Error("GeoMet request timed out"));
        });

        request.on("error", reject);
    });
}

/* =========================================================
   ECCC / GEOMET ALERT FETCHER
   ========================================================= */

async function fetchProvinceAlerts(provinceCode) {
    const url =
        "https://api.weather.gc.ca/collections/weather-alerts/items" +
        "?f=json" +
        "&limit=1000" +
        "&filter=" +
        encodeURIComponent(`properties.province=${provinceCode}`);

    const data = await httpGetJson(url);

    if (!data || !Array.isArray(data.features)) {
        return [];
    }

    return data.features.map(feature => {
        const p = feature.properties || {};

        return {
            id:
                feature.id ||
                p.feature_id ||
                p.identifier ||
                `${provinceCode}-${p.alert_code}-${p.publication_datetime}-${p.feature_name_en}`,

            province: provinceCode,

            provinceName:
                PROVINCES[provinceCode] || provinceCode,

            event:
                cleanText(p.alert_name_en) ||
                cleanText(p.alert_short_name_en) ||
                cleanText(p.alert_code) ||
                "Weather Alert",

            type:
                cleanText(p.alert_type) ||
                "alert",

            alertCode:
                cleanText(p.alert_code),

            location:
                cleanText(p.feature_name_en) ||
                cleanText(p.area) ||
                "Canadian forecast area",

            description:
                cleanText(p.alert_text_en) ||
                "Environment and Climate Change Canada weather alert.",

            colour:
                cleanText(p.risk_colour_en) ||
                "",

            status:
                cleanText(p.status_en) ||
                "active",

            published:
                p.publication_datetime || null,

            effective:
                p.validity_datetime || null,

            expires:
                p.expiration_datetime || null,

            eventEnd:
                p.event_end_datetime || null,

            confidence:
                cleanText(p.confidence_en),

            impact:
                cleanText(p.impact_en),

            geometry:
                feature.geometry || null,

            source:
                "Environment and Climate Change Canada"
        };
    });
}

async function fetchECCCAlerts() {
    const provinceCodes = Object.keys(PROVINCES);

    const results = await Promise.allSettled(
        provinceCodes.map(code => fetchProvinceAlerts(code))
    );

    const alerts = [];

    for (const result of results) {
        if (result.status === "fulfilled") {
            alerts.push(...result.value);
        } else {
            console.error(
                "Province alert request failed:",
                result.reason?.message || result.reason
            );
        }
    }

    /*
       Remove duplicates.
    */

    const unique = new Map();

    for (const alert of alerts) {
        if (alert && alert.id) {
            unique.set(String(alert.id), alert);
        }
    }

    return Array.from(unique.values());
}

/* =========================================================
   ALERT PROCESSING
   ========================================================= */

function processAlerts(incomingAlerts) {
    if (!Array.isArray(incomingAlerts)) {
        return;
    }

    const incomingIds = new Set();

    for (const alert of incomingAlerts) {
        if (!alert || !alert.id) {
            continue;
        }

        const id = String(alert.id);
        incomingIds.add(id);

        const existing = activeAlerts.get(id);

        const contentHash = JSON.stringify({
            event: alert.event,
            description: alert.description,
            status: alert.status,
            expires: alert.expires,
            colour: alert.colour
        });

        alert.contentHash = contentHash;

        if (!existing) {
            activeAlerts.set(id, alert);

            console.log("");
            console.log("================================");
            console.log("NEW ALERT");
            console.log("================================");
            console.log(alert.provinceName);
            console.log(alert.event);
            console.log(alert.location);
            console.log("================================");
            console.log("");

            io.emit("alert:new", alert);
        } else if (existing.contentHash !== contentHash) {
            activeAlerts.set(id, alert);

            console.log("");
            console.log("ALERT UPDATED");
            console.log(alert.event);
            console.log(alert.location);

            io.emit("alert:updated", alert);
        }
    }

    /*
       Remove alerts that ECCC no longer reports.
    */

    for (const id of activeAlerts.keys()) {
        if (!incomingIds.has(id)) {
            const oldAlert = activeAlerts.get(id);

            activeAlerts.delete(id);

            io.emit("alert:removed", {
                id,
                province: oldAlert?.province || null
            });
        }
    }

    io.emit(
        "alerts:current",
        Array.from(activeAlerts.values())
    );
}

/* =========================================================
   POLLING
   ========================================================= */

let polling = false;

async function checkAlerts() {
    if (polling) {
        return;
    }

    polling = true;

    try {
        const alerts = await fetchECCCAlerts();

        processAlerts(alerts);

        lastCheck = new Date().toISOString();
        lastError = null;
        initialized = true;

        console.log(
            `[CanBot] ECCC check complete: ${alerts.length} active alerts`
        );
    } catch (error) {
        lastError = error.message;

        console.error(
            "[CanBot] ECCC check failed:",
            error.message
        );
    } finally {
        polling = false;
    }
}

/* =========================================================
   STATIC WEBSITE
   ========================================================= */

app.use(express.json());

app.use(express.static(path.join(ROOT, "public")));

/*
   Make sure the homepage is actually HTML.
*/

app.get("/", (req, res) => {
    res.sendFile(
        path.join(ROOT, "public", "index.html")
    );
});

/* =========================================================
   API
   ========================================================= */

app.get("/api/alerts", (req, res) => {
    const province = String(
        req.query.province || ""
    ).toUpperCase();

    let alerts = Array.from(activeAlerts.values());

    if (province && PROVINCES[province]) {
        alerts = alerts.filter(
            alert => alert.province === province
        );
    }

    res.json({
        count: alerts.length,
        alerts
    });
});

app.get("/api/provinces", (req, res) => {
    res.json(PROVINCES);
});

app.get("/api/status", (req, res) => {
    res.json({
        initialized,
        lastCheck,
        lastError,
        activeAlerts: activeAlerts.size,
        provinces: Object.keys(PROVINCES).length,
        sound: "alert_tone.wav"
    });
});

/* =========================================================
   SOCKET.IO
   ========================================================= */

io.on("connection", socket => {
    console.log(
        "Web client connected:",
        socket.id
    );

    /*
       Immediately send everything currently active.
    */

    socket.emit(
        "alerts:current",
        Array.from(activeAlerts.values())
    );

    socket.on("disconnect", () => {
        console.log(
            "Web client disconnected:",
            socket.id
        );
    });
});

/* =========================================================
   STARTUP
   ========================================================= */

async function start() {
    console.log("");
    console.log("CANBOT WEB SERVER");
    console.log("----------------------------");
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`Alerts: http://localhost:${PORT}/api/alerts`);
    console.log(`Status: http://localhost:${PORT}/api/status`);
    console.log("Sound: alert_tone.wav");
    console.log(`ECCC interval: ${ECCC_INTERVAL / 1000} seconds`);
    console.log("");

    console.log("CANBOT INITIALIZING");
    console.log("----------------------------");

    console.log("");
    console.log("Loading current Canadian alerts...");
    console.log("----------------------------");

    await checkAlerts();

    console.log("");
    console.log("CANBOT READY");
    console.log("----------------------------");
    console.log(
        `Active alerts: ${activeAlerts.size}`
    );
    console.log("");

    console.log("Monitoring for new alerts...");
    console.log("");

    setInterval(
        checkAlerts,
        ECCC_INTERVAL
    );
}

server.listen(PORT, () => {
    start().catch(error => {
        console.error(
            "CanBot startup error:",
            error
        );
    });
});