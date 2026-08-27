const express = require("express");
const http = require("http");
const path = require("path");
const axios = require("axios");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ECCC_URL =
    "https://api.weather.gc.ca/collections/weather-alerts/items";

const PROVINCES = {
    AB: "Alberta",
    BC: "British Columbia",
    MB: "Manitoba",
    NB: "New Brunswick",
    NL: "Newfoundland and Labrador",
    NS: "Nova Scotia",
    NT: "Northwest Territories",
    NU: "Nunavut",
    ON: "Ontario",
    PE: "Prince Edward Island",
    QC: "Quebec",
    SK: "Saskatchewan",
    YT: "Yukon"
};

let alerts = [];
let lastUpdate = null;
let updating = false;

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function getProvinceCode(value) {
    if (!value) {
        return null;
    }

    const text = String(value).trim();

    for (const code of Object.keys(PROVINCES)) {
        if (text.toUpperCase() === code) {
            return code;
        }

        if (
            text.toLowerCase() ===
            PROVINCES[code].toLowerCase()
        ) {
            return code;
        }
    }

    return text.toUpperCase();
}

function getAlertIcon(title, event) {
    const text =
        String(title || "") +
        " " +
        String(event || "");

    const value = text.toLowerCase();

    if (value.includes("tornado")) {
        return "🌪️";
    }

    if (
        value.includes("thunderstorm") ||
        value.includes("thunder")
    ) {
        return "⛈️";
    }

    if (
        value.includes("blizzard") ||
        value.includes("winter storm")
    ) {
        return "🌨️";
    }

    if (
        value.includes("snow") ||
        value.includes("flurr")
    ) {
        return "❄️";
    }

    if (
        value.includes("freezing rain") ||
        value.includes("ice pellet") ||
        value.includes("freezing drizzle")
    ) {
        return "🧊";
    }

    if (
        value.includes("rain") ||
        value.includes("rainfall")
    ) {
        return "🌧️";
    }

    if (
        value.includes("wind") ||
        value.includes("gust")
    ) {
        return "💨";
    }

    if (value.includes("fog")) {
        return "🌫️";
    }

    if (
        value.includes("heat") ||
        value.includes("hot")
    ) {
        return "🌡️";
    }

    if (
        value.includes("cold") ||
        value.includes("frost")
    ) {
        return "🥶";
    }

    if (value.includes("flood")) {
        return "🌊";
    }

    if (
        value.includes("wildfire") ||
        value.includes("forest fire")
    ) {
        return "🔥";
    }

    if (value.includes("smoke")) {
        return "💨";
    }

    return "⚠️";
}

/* =========================================================
   CLC
========================================================= */

function extractCLC(properties) {
    const result = [];

    const fields = [
        properties.CLC,
        properties.clc,
        properties.CLC_CODE,
        properties.clc_code,
        properties.CLC_CODES,
        properties.clc_codes
    ];

    for (const field of fields) {
        if (!field) {
            continue;
        }

        const values = Array.isArray(field)
            ? field
            : String(field).split(",");

        for (const value of values) {
            const code = clean(value);

            if (
                code &&
                !result.includes(code)
            ) {
                result.push(code);
            }
        }
    }

    return result;
}

/* =========================================================
   ALERT CONVERSION
========================================================= */

function convertECCCAlert(feature) {
    const p = feature.properties || {};

    const title =
        p.alert_name_en ||
        p.alert_short_name_en ||
        p.event_en ||
        p.alert_type ||
        "Weather Alert";

    const event =
        p.event_en ||
        p.alert_type ||
        title;

    const province =
        getProvinceCode(
            p.province ||
            p.province_code ||
            p.provinceCode
        );

    return {
        id: String(
            p.id ||
            feature.id ||
            "eccc-" +
                Date.now() +
                "-" +
                Math.random()
        ),

        title: title,

        event: event,

        icon: getAlertIcon(
            title,
            event
        ),

        description:
            p.alert_text_en ||
            p.description_en ||
            p.text_en ||
            p.instruction_en ||
            "",

        severity:
            p.severity_en ||
            p.risk_colour_en ||
            p.impact_en ||
            "Unknown",

        urgency:
            p.urgency_en ||
            "Unknown",

        certainty:
            p.certainty_en ||
            "Unknown",

        effective:
            p.publication_datetime ||
            p.effective_datetime ||
            p.onset_datetime ||
            null,

        expires:
            p.expiration_datetime ||
            p.expiry_datetime ||
            p.event_end_datetime ||
            p.expires ||
            null,

        areas:
            p.area_desc_en ||
            p.feature_name_en ||
            p.area_en ||
            p.location_name_en ||
            "",

        province: province,

        clc: extractCLC(p),

        source:
            "Environment and Climate Change Canada",

        sourceUrl:
            "https://weather.gc.ca/",

        test: false
    };
}

/* =========================================================
   REMOVE EXPIRED ALERTS
========================================================= */

function removeExpiredAlerts() {
    const now = Date.now();

    const oldCount = alerts.length;

    alerts = alerts.filter(
        function(alert) {
            if (!alert.expires) {
                return true;
            }

            const expiry =
                new Date(
                    alert.expires
                ).getTime();

            if (Number.isNaN(expiry)) {
                return true;
            }

            return expiry > now;
        }
    );

    if (alerts.length !== oldCount) {
        console.log(
            "Removed " +
            (oldCount - alerts.length) +
            " expired alert(s)."
        );

        io.emit(
            "alerts:update",
            alerts
        );
    }
}

/* =========================================================
   DOWNLOAD ECCC ALERTS
========================================================= */

async function updateAlerts() {
    if (updating) {
        return;
    }

    updating = true;

    console.log("");
    console.log(
        "Updating Canadian weather alerts..."
    );

    try {
        const response =
            await axios.get(
                ECCC_URL,
                {
                    params: {
                        f: "json",
                        limit: 1000
                    },

                    timeout: 60000,

                    headers: {
                        "User-Agent":
                            "CanBot/1.0"
                    }
                }
            );

        const features =
            response.data &&
            Array.isArray(
                response.data.features
            )
                ? response.data.features
                : [];

        const testAlerts =
            alerts.filter(
                function(alert) {
                    return alert.test === true;
                }
            );

        alerts =
            features.map(
                convertECCCAlert
            );

        alerts =
            alerts.concat(
                testAlerts
            );

        removeExpiredAlerts();

        lastUpdate =
            new Date().toISOString();

        console.log(
            "Canadian alerts loaded: " +
            features.length
        );

        console.log(
            "Active alerts: " +
            alerts.length
        );

        io.emit(
            "alerts:update",
            alerts
        );

        io.emit(
            "status",
            {
                online: true,
                clcSystem: true,
                alerts: alerts.length,
                lastUpdate: lastUpdate
            }
        );
    } catch (error) {
        if (error.response) {
            console.error(
                "ECCC update failed: HTTP " +
                error.response.status
            );
        } else {
            console.error(
                "ECCC update failed: " +
                error.message
            );
        }
    }

    updating = false;
}

/* =========================================================
   API - ALL ALERTS
========================================================= */

app.get(
    "/api/alerts",
    function(req, res) {
        removeExpiredAlerts();

        let result = alerts.slice();

        if (req.query.province) {
            const wanted =
                getProvinceCode(
                    req.query.province
                );

            result =
                result.filter(
                    function(alert) {
                        return (
                            alert.province ===
                            wanted
                        );
                    }
                );
        }

        if (req.query.clc) {
            const requested =
                String(
                    req.query.clc
                )
                    .split(",")
                    .map(clean)
                    .filter(Boolean);

            result =
                result.filter(
                    function(alert) {
                        return requested.some(
                            function(code) {
                                return alert.clc.includes(
                                    code
                                );
                            }
                        );
                    }
                );
        }

        res.json({
            success: true,
            count: result.length,
            alerts: result,
            updated: lastUpdate
        });
    }
);

/* =========================================================
   API - STATUS
========================================================= */

app.get(
    "/api/status",
    function(req, res) {
        removeExpiredAlerts();

        res.json({
            online: true,
            clcSystem: true,
            alerts: alerts.length,
            lastUpdate: lastUpdate,
            serverTime:
                new Date().toISOString()
        });
    }
);

/* =========================================================
   API - PROVINCES
========================================================= */

app.get(
    "/api/provinces",
    function(req, res) {
        res.json({
            success: true,
            provinces: PROVINCES
        });
    }
);

/* =========================================================
   API - CREATE TEST ALERT
========================================================= */

app.post(
    "/api/test-alert",
    function(req, res) {
        const province =
            getProvinceCode(
                req.body.province ||
                "ON"
            );

        const clc =
            clean(
                req.body.clc ||
                "TEST"
            );

        const title =
            req.body.title ||
            "CanBot Test Alert";

        const event =
            req.body.event ||
            "Test Alert";

        const testAlert = {
            id:
                "test-" +
                Date.now(),

            title: title,

            event: event,

            icon:
                getAlertIcon(
                    title,
                    event
                ),

            description:
                req.body.message ||
                "This is a CanBot test alert.",

            severity:
                req.body.severity ||
                "Extreme",

            urgency:
                "Immediate",

            certainty:
                "Observed",

            effective:
                new Date().toISOString(),

            expires:
                new Date(
                    Date.now() +
                    10 * 60 * 1000
                ).toISOString(),

            areas:
                PROVINCES[province] ||
                province,

            province:
                province,

            clc: [
                clc
            ],

            source:
                "CanBot",

            sourceUrl:
                null,

            test: true
        };

        alerts.unshift(
            testAlert
        );

        io.emit(
            "alert:new",
            testAlert
        );

        io.emit(
            "alerts:update",
            alerts
        );

        console.log("");
        console.log(
            "TEST ALERT CREATED"
        );

        console.log(
            "Province: " +
            province
        );

        console.log(
            "CLC: " +
            clc
        );

        res.json({
            success: true,
            alert: testAlert
        });
    }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    function(socket) {
        console.log(
            "CanBot client connected: " +
            socket.id
        );

        removeExpiredAlerts();

        socket.emit(
            "alerts:update",
            alerts
        );

        socket.emit(
            "status",
            {
                online: true,
                clcSystem: true,
                alerts: alerts.length,
                lastUpdate: lastUpdate
            }
        );

        socket.on(
            "getAlerts",
            function(filters) {
                let result =
                    alerts.slice();

                if (
                    filters &&
                    filters.province
                ) {
                    const province =
                        getProvinceCode(
                            filters.province
                        );

                    result =
                        result.filter(
                            function(alert) {
                                return (
                                    alert.province ===
                                    province
                                );
                            }
                        );
                }

                if (
                    filters &&
                    filters.clc
                ) {
                    const clc =
                        clean(
                            filters.clc
                        );

                    result =
                        result.filter(
                            function(alert) {
                                return alert.clc.includes(
                                    clc
                                );
                            }
                        );
                }

                socket.emit(
                    "alerts:filtered",
                    result
                );
            }
        );
    }
);

/* =========================================================
   WEBSITE ROUTES
========================================================= */

app.get(
    "/",
    function(req, res) {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );
    }
);

app.get(
    "/index.html",
    function(req, res) {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );
    }
);

app.get(
    "/about.html",
    function(req, res) {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "about.html"
            )
        );
    }
);

app.get(
    "/contact.html",
    function(req, res) {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "contact.html"
            )
        );
    }
);

app.get(
    "/settings.html",
    function(req, res) {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "settings.html"
            )
        );
    }
);

/* =========================================================
   AUTOMATIC EXPIRATION
========================================================= */

setInterval(
    function() {
        removeExpiredAlerts();
    },
    30000
);

/* =========================================================
   AUTOMATIC WEATHER UPDATE
========================================================= */

setInterval(
    function() {
        updateAlerts();
    },
    5 * 60 * 1000
);

/* =========================================================
   START CANBOT
========================================================= */

server.listen(
    PORT,
    async function() {
        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "             CANBOT ONLINE"
        );
        console.log(
            "========================================"
        );
        console.log(
            "Website: http://localhost:" +
            PORT +
            "/"
        );
        console.log(
            "CLC system: READY"
        );
        console.log(
            "Alerts: " +
            alerts.length
        );
        console.log(
            "========================================"
        );

        await updateAlerts();
    }
);