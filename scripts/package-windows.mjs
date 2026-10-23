import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./create-zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") throw new Error("Windows packaging requires Windows and its .NET Framework C# compiler.");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const name = `Naiwa-Studio-v${pkg.version}-windows-x64`;
const releaseRoot = path.join(root, "release");
const stage = path.join(releaseRoot, `.build-${Date.now()}`, name);
const compiler = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
for (const file of [compiler, "dist/client/index.html", "desktop/NaiwaLauncher.cs", "docs/PORTABLE-WINDOWS.md"]) {
  if (!existsSync(path.resolve(root, file))) throw new Error(`Missing input: ${file}. Run pnpm build first.`);
}
mkdirSync(stage, { recursive: true });
cpSync(path.join(root, "dist/client"), path.join(stage, "www"), {
  recursive: true,
  filter: (file) => path.basename(file) !== "naiwa-laugh.gif",
});
for (const file of ["LICENSE", "ASSET-SOURCES.md", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(path.join(root, file), path.join(stage, file));
}
const guide = readFileSync(path.join(root, "docs/PORTABLE-WINDOWS.md"), "utf8")
  .replaceAll("../README.md", "https://github.com/Theorists258/naiwa-studio#readme")
  .replaceAll("../THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md")
  .replaceAll("../ASSET-SOURCES.md", "ASSET-SOURCES.md");
writeFileSync(path.join(stage, "使用说明.txt"), "\uFEFF" + guide.replace(/\r?\n/g, "\r\n"));
mkdirSync(path.join(stage, "licenses"));
for (const [name, packagePath, licenseFile = "LICENSE"] of [["React", "react"], ["React-DOM", "react-dom"], ["Phosphor-Icons", "@phosphor-icons/react"], ["Vite", "vite", "LICENSE.md"]]) {
  copyFileSync(path.join(root, "node_modules", packagePath, licenseFile), path.join(stage, "licenses", `${name}.txt`));
}
const executable = path.join(stage, "奶蛙Studio.exe");
execFileSync(compiler, [
  "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/utf8output", "/codepage:65001",
  "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
  `/out:${executable}`, path.join(root, "desktop/NaiwaLauncher.cs"),
], { stdio: "inherit" });

function filesIn(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? filesIn(path.join(dir, entry.name), `${relative}/`) : [relative];
  });
}
const manifest = filesIn(stage).sort().map(file => ({
  file,
  sha256: createHash("sha256").update(readFileSync(path.join(stage, file))).digest("hex"),
}));
writeFileSync(path.join(stage, "manifest.json"), JSON.stringify({ name, version: pkg.version, files: manifest }, null, 2) + "\n");
const archive = path.join(releaseRoot, `${name}.zip`);
createZip(stage, archive);
const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
writeFileSync(path.join(releaseRoot, "latest-build.json"), JSON.stringify({ archive, executable, stage, sha256: hash }, null, 2) + "\n");
console.log(`Portable app: ${executable}\nArchive: ${archive}\nSHA-256: ${hash}`);
