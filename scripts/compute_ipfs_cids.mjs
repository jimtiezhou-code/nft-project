import { createReadStream } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { importer } from "ipfs-unixfs-importer";
import { MemoryBlockstore } from "blockstore-core/memory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// IPFS 默认的 chunker 和布局参数
const importOptions = {
    cidVersion: 1,
    rawLeaves: true,
    leafType: "raw",
    maxChunkSize: 262144,
};

async function computeCID(filePath) {
    const content = await readFile(filePath);
    const blockstore = new MemoryBlockstore();

    let rootCID = null;
    const source = (async function* () {
        yield content;
    })();

    for await (const entry of importer([{ content: source, path: filePath }], blockstore, importOptions)) {
        rootCID = entry.cid;
    }

    return rootCID.toString();
}

async function main() {
    console.log("Computing IPFS CIDs locally...\n");

    // 1. 上传图片，获取 CID
    const imageCIDs = {};
    for (let i = 1; i <= 3; i++) {
        const imgPath = join(ROOT, "images", `${i}.svg`);
        console.log(`Computing CID for images/${i}.svg...`);
        const cid = await computeCID(imgPath);
        imageCIDs[i] = cid;
        console.log(`  => ${cid}`);
    }

    console.log("");

    // 2. 更新 metadata 中的 image 链接并计算 metadata CID
    const metadataCIDs = {};
    for (let i = 1; i <= 3; i++) {
        const metaPath = join(ROOT, "metadata", `${i}.json`);
        const meta = JSON.parse(await readFile(metaPath, "utf8"));
        meta.image = `ipfs://${imageCIDs[i]}`;

        // 写入更新后的 metadata 文件
        const metaStr = JSON.stringify(meta, null, 2);
        await writeFile(metaPath, metaStr);

        console.log(`Computing CID for metadata/${i}.json...`);
        const cid = await computeCID(metaPath);
        metadataCIDs[i] = cid;
        console.log(`  => ${cid}`);
    }

    console.log("\n============================");
    console.log("IPFS Token URIs (deploy时使用):");
    console.log("============================");
    for (let i = 1; i <= 3; i++) {
        console.log(`  Token ${i - 1}: ipfs://${metadataCIDs[i]}`);
    }

    console.log("\n============================");
    console.log("IPFS Gateway URLs (浏览器打开查看):");
    console.log("============================");
    for (let i = 1; i <= 3; i++) {
        console.log(`  Token ${i - 1}: https://ipfs.io/ipfs/${metadataCIDs[i]}`);
    }

    // 保存结果
    const result = { images: imageCIDs, metadata: metadataCIDs };
    await writeFile(join(ROOT, "ipfs-cids.json"), JSON.stringify(result, null, 2));
    console.log("\nCIDs saved to ipfs-cids.json");
    console.log("\n! 以上 CID 仅为本地计算，需要上传到 IPFS pinning service 才能公网访问 !");
}

main().catch(console.error);
