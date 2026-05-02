import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dictionaryRoot = path.join(projectRoot, "server", "dictionaries");
const targetPath = path.join(dictionaryRoot, "ecdict.csv");
const tempPath = `${targetPath}.download`;
const sourceUrl = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";

const download = (url, destination) =>
  new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ECDICT: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });

await mkdir(dictionaryRoot, { recursive: true });
await rm(tempPath, { force: true });
await download(sourceUrl, tempPath);
await rename(tempPath, targetPath);

console.log(`Downloaded ECDICT to ${targetPath}`);
