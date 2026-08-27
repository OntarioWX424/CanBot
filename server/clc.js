"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const turf = require("@turf/turf");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "clc_codes.txt");

let zones = [];

/* =========================================================
   LOAD CLC CODE LIST
   ========================================================= */

function loadCLC() {
    const lines = fs.readFileSync(FILE, "utf8").split(/\r?\n/);

    const result = [];
    let province = "";

    for (const line of lines) {
        const text = line.trim();

        if (!text) {
            continue;
        }

        if (text.endsWith(":")) {
            province = text.slice(0, -1).trim();
            continue;
        }

        const match = text.match(/^(\d{6})\s+(.+)$/);

        if (match) {
            result.push({
                province,
                code: match[1],
                location: match[2].trim()
            });
        }
    }

    return result;
}


/* =========================================================
   HTTPS JSON
   ========================================================= */

function getJSON(url) {
    return new Promise((resolve, reject) => {

        const request = https.get(
            url,
            {
                headers: {
                    "User-Agent":
                        "CanBot/1.0 Canadian Alert Network",

                    "Accept":
                        "application/geo+json, application/json"
                }
            },

            response => {

                let body = "";

                response.setEncoding("utf8");

                response.on(
                    "data",
                    chunk => {
                        body += chunk;
                    }
                );

                response.on(
                    "end",
                    () => {

                        if (
                            response.statusCode < 200 ||
                            response.statusCode >= 300
                        ) {

                            reject(
                                new Error(
                                    `ECCC HTTP ${response.statusCode}`
                                )
                            );

                            return;
                        }

                        try {

                            resolve(
                                JSON.parse(body)
                            );

                        } catch (error) {

                            reject(error);

                        }

                    }
                );

            }
        );

        request.setTimeout(
            30000,
            () => {
                request.destroy(
                    new Error(
                        "ECCC CLC request timed out"
                    )
                );
            }
        );

        request.on(
            "error",
            reject
        );

    });
}


/* =========================================================
   FAST GEOMETRY PREPARATION
   ========================================================= */

function getBBox(geometry) {

    try {

        return turf.bbox(
            turf.feature(geometry)
        );

    } catch {

        return null;

    }

}


function bboxIntersects(a, b) {

    return !(
        a[2] < b[0] ||
        a[0] > b[2] ||
        a[3] < b[1] ||
        a[1] > b[3]
    );

}


/* =========================================================
   LOAD ECCC FORECAST ZONES
   ========================================================= */

async function loadZones() {

    console.log(
        "[CanBot] Loading ECCC CLC zones..."
    );

    const url =
        "https://api.weather.gc.ca/collections/" +
        "public-standard-forecast-zones/items" +
        "?f=json&limit=10000";

    const data =
        await getJSON(url);

    zones = [];

    for (
        const feature of
        data.features || []
    ) {

        const properties =
            feature.properties || {};

        const code =
            String(
                properties.CLC || ""
            ).trim();

        const geometry =
            feature.geometry;

        if (
            !code ||
            !geometry
        ) {

            continue;

        }

        const bbox =
            getBBox(geometry);

        if (!bbox) {
            continue;
        }

        zones.push({

            code,

            name:
                properties.NAME || "",

            geometry,

            bbox

        });

    }

    console.log(
        `[CanBot] Loaded ${zones.length} ECCC CLC zones.`
    );

    console.log(
        "[CanBot] Building CLC spatial index..."
    );

    /*
     * Divide Canada into longitude/latitude
     * grid cells.
     *
     * This prevents every alert from being
     * tested against all 419 zones.
     */

    buildSpatialIndex();

    console.log(
        "[CanBot] CLC spatial index ready."
    );
}


/* =========================================================
   SPATIAL INDEX
   ========================================================= */

const GRID_SIZE = 1;

let spatialIndex = new Map();


function gridKey(x, y) {
    return `${x}:${y}`;
}


function buildSpatialIndex() {

    spatialIndex = new Map();

    for (
        const zone of zones
    ) {

        const [
            minLon,
            minLat,
            maxLon,
            maxLat
        ] = zone.bbox;

        const minX =
            Math.floor(
                minLon / GRID_SIZE
            );

        const maxX =
            Math.floor(
                maxLon / GRID_SIZE
            );

        const minY =
            Math.floor(
                minLat / GRID_SIZE
            );

        const maxY =
            Math.floor(
                maxLat / GRID_SIZE
            );

        for (
            let x = minX;
            x <= maxX;
            x++
        ) {

            for (
                let y = minY;
                y <= maxY;
                y++
            ) {

                const key =
                    gridKey(x, y);

                let bucket =
                    spatialIndex.get(key);

                if (!bucket) {

                    bucket = [];

                    spatialIndex.set(
                        key,
                        bucket
                    );

                }

                bucket.push(zone);

            }

        }

    }

}


/* =========================================================
   FIND POSSIBLE ZONES
   ========================================================= */

function getCandidateZones(
    alertBBox
) {

    const candidates =
        new Set();

    const [
        minLon,
        minLat,
        maxLon,
        maxLat
    ] = alertBBox;

    const minX =
        Math.floor(
            minLon / GRID_SIZE
        );

    const maxX =
        Math.floor(
            maxLon / GRID_SIZE
        );

    const minY =
        Math.floor(
            minLat / GRID_SIZE
        );

    const maxY =
        Math.floor(
            maxLat / GRID_SIZE
        );

    for (
        let x = minX;
        x <= maxX;
        x++
    ) {

        for (
            let y = minY;
            y <= maxY;
            y++
        ) {

            const bucket =
                spatialIndex.get(
                    gridKey(x, y)
                );

            if (!bucket) {
                continue;
            }

            for (
                const zone of bucket
            ) {

                candidates.add(
                    zone
                );

            }

        }

    }

    return [
        ...candidates
    ];

}


/* =========================================================
   ALERT → CLC MATCHING
   ========================================================= */

function getAlertCLC(
    geometry
) {

    if (
        !geometry ||
        !zones.length
    ) {

        return [];

    }

    let alert;

    try {

        alert =
            turf.feature(
                geometry
            );

    } catch {

        return [];

    }

    let alertBBox;

    try {

        alertBBox =
            turf.bbox(
                alert
            );

    } catch {

        return [];

    }


    /*
     * FIRST FILTER:
     *
     * Bounding boxes are extremely cheap.
     */

    const candidates =
        getCandidateZones(
            alertBBox
        );


    /*
     * SECOND FILTER:
     *
     * Only run the expensive polygon
     * intersection against zones that
     * could actually overlap.
     */

    const matches = [];

    for (
        const zone of candidates
    ) {

        if (
            !bboxIntersects(
                alertBBox,
                zone.bbox
            )
        ) {

            continue;

        }

        try {

            if (
                turf.booleanIntersects(
                    alert,
                    turf.feature(
                        zone.geometry
                    )
                )
            ) {

                matches.push(
                    zone.code
                );

            }

        } catch {

            /*
             * Ignore invalid geometry
             * instead of stopping the
             * entire alert cycle.
             */

        }

    }

    return [
        ...new Set(matches)
    ];

}


/* =========================================================
   LOAD CLC FILE
   ========================================================= */

const clcCodes =
    loadCLC();


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {

    loadCLC,

    loadZones,

    getAlertCLC,

    getCLCList: () =>
        clcCodes

};