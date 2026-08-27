const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const zipPath = path.join(
    __dirname,
    "MSC_Geography_Pkg_V6_15_0_CAP-CP_V1_0_draft_Unproj.zip"
);

console.log("🇨🇦 CANBOT GEOGRAPHY INSPECTOR");
console.log("────────────────────────────");

if (!fs.existsSync(zipPath)) {
    console.error("❌ Geography ZIP not found.");
    process.exit(1);
}

const zip = new AdmZip(zipPath);

const entries = zip.getEntries();

console.log(
    `📦 ZIP contains ${entries.length} files.`
);

console.log("");

for (const entry of entries) {
    console.log(
        entry.isDirectory
            ? `📁 ${entry.entryName}`
            : `📄 ${entry.entryName}`
    );
}

console.log("");
console.log("✅ Inspection complete.");