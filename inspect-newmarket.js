const shapefile = require("shapefile");
const path = require("path");

const shp = path.join(
    __dirname,
    "MSC_Geography_Pkg_V6_15_0_CAP-CP_V1_0_draft_Unproj.zip",
    "CAP-CP_land_detail_unproj.shp"
);

const searchTerms = [
    "newmarket",
    "georgina",
    "york"
];

async function run() {

    console.log("🇨🇦 SEARCHING CAP-CP GEOGRAPHY");
    console.log("────────────────────────────");

    const source =
        await shapefile.open(shp);

    let found = 0;

    while (true) {

        const result =
            await source.read();

        if (result.done) {
            break;
        }

        const properties =
            result.value.properties;

        const name =
            String(
                properties.NAME || ""
            ).toLowerCase();

        const match =
            searchTerms.some(
                term =>
                    name.includes(term)
            );

        if (match) {

            found++;

            console.log("");
            console.log(
                `🗺️ MATCH ${found}`
            );
            console.log(
                "────────────────────────────"
            );

            console.dir(
                properties,
                {
                    depth: null
                }
            );

            console.log(
                "Geometry:",
                result.value.geometry?.type
            );
        }
    }

    console.log("");
    console.log(
        `🔎 Found ${found} matching feature(s).`
    );
    console.log(
        "✅ Search complete."
    );
}

run().catch(error => {

    console.error(
        "❌ Search failed:"
    );

    console.error(error);

});