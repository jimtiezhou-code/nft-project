const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

// 从环境变量读取 Pinata 凭证
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

const ROOT = path.join(__dirname, "..");
const IMAGES_DIR = path.join(ROOT, "images");
const METADATA_DIR = path.join(ROOT, "metadata");

function getAuthHeaders(formHeaders = {}) {
    const headers = { ...formHeaders };
    if (PINATA_JWT) {
        headers["Authorization"] = `Bearer ${PINATA_JWT}`;
    } else if (PINATA_API_KEY && PINATA_SECRET_KEY) {
        headers["pinata_api_key"] = PINATA_API_KEY;
        headers["pinata_secret_api_key"] = PINATA_SECRET_KEY;
    } else {
        console.error("❌ 缺少 Pinata 凭证!");
        console.error("请先注册免费账号: https://app.pinata.cloud");
        console.error("然后复制 .env.example 为 .env 并填入你的凭证");
        process.exit(1);
    }
    return headers;
}

async function uploadFile(filePath, name) {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("pinataMetadata", JSON.stringify({ name }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const headers = getAuthHeaders(form.getHeaders());
    const res = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        form,
        { headers, maxBodyLength: Infinity }
    );
    return res.data.IpfsHash;
}

async function uploadJSON(json, name) {
    const headers = getAuthHeaders();
    headers["Content-Type"] = "application/json";

    const payload = {
        pinataContent: json,
        pinataMetadata: { name },
        pinataOptions: { cidVersion: 1 },
    };

    const res = await axios.post(
        "https://api.pinata.cloud/pinning/pinJSONToIPFS",
        payload,
        { headers }
    );
    return res.data.IpfsHash;
}

async function main() {
    console.log("🚀 上传 NFT 文件到 IPFS (Pinata)...\n");

    // Step 1: 上传图片
    const imageCIDs = {};
    for (let i = 1; i <= 3; i++) {
        const filePath = path.join(IMAGES_DIR, `${i}.svg`);
        console.log(`📤 上传 images/${i}.svg ...`);
        const cid = await uploadFile(filePath, `MyNFT_Image_${i}`);
        imageCIDs[i] = cid;
        console.log(`   ✅ ipfs://${cid}\n`);
    }

    // Step 2: 更新 metadata 中的图片链接
    for (let i = 1; i <= 3; i++) {
        const metaPath = path.join(METADATA_DIR, `${i}.json`);
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        meta.image = `ipfs://${imageCIDs[i]}`;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    // Step 3: 上传 metadata
    const metadataCIDs = {};
    for (let i = 1; i <= 3; i++) {
        const metaPath = path.join(METADATA_DIR, `${i}.json`);
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        console.log(`📤 上传 metadata/${i}.json ...`);
        const cid = await uploadJSON(meta, `MyNFT_Metadata_${i}`);
        metadataCIDs[i] = cid;
        console.log(`   ✅ ipfs://${cid}\n`);
    }

    // Step 4: 保存结果
    const result = {
        images: imageCIDs,
        metadata: metadataCIDs,
        tokenURIs: {
            0: `ipfs://${metadataCIDs[1]}`,
            1: `ipfs://${metadataCIDs[2]}`,
            2: `ipfs://${metadataCIDs[3]}`,
        },
    };

    fs.writeFileSync(path.join(ROOT, "ipfs-cids.json"), JSON.stringify(result, null, 2));

    console.log("═══════════════════════════════════════════");
    console.log("🎉 上传完成! Token URIs (用于部署):");
    console.log("═══════════════════════════════════════════");
    console.log(`  Token 0: ${result.tokenURIs[0]}`);
    console.log(`  Token 1: ${result.tokenURIs[1]}`);
    console.log(`  Token 2: ${result.tokenURIs[2]}`);
    console.log("\n📎 IPFS Gateway 预览链接:");
    console.log(`  Token 0: https://ipfs.io/ipfs/${metadataCIDs[1]}`);
    console.log(`  Token 1: https://ipfs.io/ipfs/${metadataCIDs[2]}`);
    console.log(`  Token 2: https://ipfs.io/ipfs/${metadataCIDs[3]}`);
    console.log("\n💡 OpenSea 测试网链接 (部署后):");
    console.log(`  https://testnets.opensea.io/assets/sepolia/<合约地址>/0`);
    console.log(`  https://testnets.opensea.io/assets/sepolia/<合约地址>/1`);
    console.log(`  https://testnets.opensea.io/assets/sepolia/<合约地址>/2`);
}

main().catch((err) => {
    console.error("❌ 上传失败:", err.response?.data || err.message);
    process.exit(1);
});
