const XLSX = require("xlsx");
const path = require("path");

const file = path.join(
    __dirname,
    "CAP-CP_Geocodes_V1_0_draft.xlsx"
);

console.log("🇨🇦 CANBOT CAP-CP INSPECTOR");
console.log("────────────────────────────");

const workbook = XLSX.readFile(file);

console.log("Sheets:");
console.log(workbook.SheetNames);
console.log("");

const ontario = workbook.Sheets["ON"];

if (!ontario) {
    console.error("❌ Ontario sheet not found.");
    process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(
    ontario,
    {
        defval: null,
        header: 1
    }
);

console.log("🇨🇦 ONTARIO");
console.log("────────────────────────────");

console.log(
    `Rows found: ${rows.length}`
);

console.log("");

console.log("HEADER:");
console.dir(
    rows[0],
    {
        depth: null
    }
);

console.log("");

console.log("FIRST 5 RECORDS:");

for (
    let i = 1;
    i < Math.min(rows.length, 6);
    i++
) {

    console.log("");
    console.log(`Record ${i}:`);

    console.dir(
        rows[i],
        {
            depth: null
        }
    );
}

console.log("");
console.log("✅ Inspection complete.");