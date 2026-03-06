#!/usr/bin/env bash
# 打包 Chrome 扩展为 .crx 和 .zip
# 用法：在项目根目录执行 npm run pack 或 bash scripts/pack.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 从 manifest.json 读取名称和版本
NAME=$(node -e "console.log(require('./manifest.json').name || 'DataCrawler')")
VER=$(node -e "console.log(require('./manifest.json').version || '1.0')")
OUT_BASE="${NAME}-${VER}"
DIST="$ROOT/dist"
EXT="$DIST/extension"

echo "[pack] 扩展: $NAME $VER"
echo "[pack] 输出目录: $DIST"

# 清理并创建输出目录
rm -rf "$EXT" "$DIST/$OUT_BASE.zip" "$DIST/$OUT_BASE.crx"
mkdir -p "$EXT"

# 复制扩展文件（排除不需要打包的）
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.DS_Store' \
  --exclude='.idea' \
  --exclude='key.pem' \
  --exclude='dist' \
  --exclude='*.crx' \
  --exclude='*.zip' \
  --exclude='scripts' \
  --exclude='script' \
  --exclude='data' \
  --exclude='*.md' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  "$ROOT/" "$EXT/"

# 使用 Terser 压缩并混淆 JS（变量缩短等，不触犯 CSP）
echo "[pack] 压缩 JS: $EXT/js"
while IFS= read -r -d '' f; do
  npx terser "$f" -o "$f.tmp" --compress --mangle && mv "$f.tmp" "$f"
done < <(find "$EXT/js" -name "*.js" -type f -print0)

# 若无 key.pem 则生成（用于 crx 签名，保证扩展 ID 稳定）
KEY_PEM="$ROOT/key.pem"
if [[ ! -f "$KEY_PEM" ]]; then
  echo "[pack] 生成私钥 key.pem（仅首次）"
  openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out "$KEY_PEM" 2>/dev/null
fi

# 打 zip（zip 内为扩展根内容，无 extension 一层）
echo "[pack] 生成 $DIST/$OUT_BASE.zip"
(cd "$EXT" && zip -r "$DIST/$OUT_BASE.zip" . -x "*.DS_Store")

# 打 crx
echo "[pack] 生成 $DIST/$OUT_BASE.crx"
npx crx pack "$EXT" -o "$DIST/$OUT_BASE.crx" -p "$KEY_PEM"

echo "[pack] 完成: $DIST/$OUT_BASE.zip, $DIST/$OUT_BASE.crx"
