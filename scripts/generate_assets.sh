#!/bin/bash
# 生成 NFT 图片(SVG)和元数据 JSON

mkdir -p images metadata

# === 图片 1：金色圆形 ===
cat > images/1.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="g1" cx="50%" cy="40%" r="50%">
      <stop offset="0%" style="stop-color:#FFD700"/>
      <stop offset="100%" style="stop-color:#B8860B"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="#1a1a2e"/>
  <circle cx="200" cy="180" r="100" fill="url(#g1)"/>
  <text x="200" y="340" text-anchor="middle" font-family="Arial" font-size="28" fill="#FFD700">Golden Dawn #1</text>
</svg>
SVGEOF

# === 图片 2：蓝色几何 ===
cat > images/2.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00BFFF"/>
      <stop offset="100%" style="stop-color:#00008B"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="#0d0d2b"/>
  <polygon points="200,60 330,240 200,320 70,240" fill="url(#g2)" opacity="0.9"/>
  <text x="200" y="370" text-anchor="middle" font-family="Arial" font-size="28" fill="#00BFFF">Crystal Blue #2</text>
</svg>
SVGEOF

# === 图片 3：火焰漩涡 ===
cat > images/3.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="g3" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#FF4500"/>
      <stop offset="50%" style="stop-color:#FF6347"/>
      <stop offset="100%" style="stop-color:#8B0000"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="#1a0a0a"/>
  <rect x="100" y="80" width="200" height="200" rx="20" fill="url(#g3)" transform="rotate(15 200 180)"/>
  <circle cx="200" cy="180" r="60" fill="#FFD700" opacity="0.7"/>
  <text x="200" y="340" text-anchor="middle" font-family="Arial" font-size="28" fill="#FF4500">Flame Vortex #3</text>
</svg>
SVGEOF

echo "3 SVG images created in images/"

# === 元数据 JSON (先填 placeholder IPFS，上传图片后更新) ===
for i in 1 2 3; do
  case $i in
    1) title="Golden Dawn #1"; desc="A radiant golden circle emerging from the depths of the cosmos." ;;
    2) title="Crystal Blue #2"; desc="A crystalline blue polygon floating in the digital void." ;;
    3) title="Flame Vortex #3"; desc="A fiery vortex swirling with cosmic energy and molten passion." ;;
  esac

  cat > "metadata/${i}.json" << JSONEOF
{
  "name": "${title}",
  "description": "${desc}",
  "image": "PLACEHOLDER_IMAGE_IPFS_${i}",
  "attributes": [
    {"trait_type": "Series", "value": "Genesis"},
    {"trait_type": "Number", "value": "${i}"},
    {"trait_type": "Rarity", "value": "Legendary"}
  ]
}
JSONEOF
done

echo "3 metadata JSON files created in metadata/"
