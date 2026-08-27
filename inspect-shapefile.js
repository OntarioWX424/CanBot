const shapefile = require("shapefile");
const path = require("path");

const shp = path.join(
    __dirname,
    "MSC_Geography_Pkg_V6_15_0_CAP-CP_V1_0_draft_Unproj.zip",
    "CAP-CP_land_detail_unproj.shp"
);

console.log("🇨🇦 CANBOT SHAPEFILE INSPECTOR");
console.log("────────────────────────────");
console.log("📂 Reading:");
console.log(shp);
console.log("");

async function inspect() {

    try {

        const source =
            await shapefile.open(shp);

        console.log("✅ Shapefile opened.");
        console.log("");

        for (let i = 0; i < 5; i++) {

            const result =
                await source.read();

            if (result.done) {
                break;
            }

            console.log(`🗺️ FEATURE ${i + 1}`);
            console.log("────────────────────────────");

            console.dir(
                result.value.properties,
                {
                    depth: null
                }
            );

            console.log("");

            console.log(
                "Geometry:",
                result.value.geometry?.type
            );

            console.log("");
        }

        console.log("✅ Inspection complete.");

    }
    catch (error) {

        console.error("");
        console.error(
            "❌ Could not read shapefile:"
        );

        console.error(error);

    }
}

inspect();