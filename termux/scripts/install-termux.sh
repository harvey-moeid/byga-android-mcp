#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
artifact_dir="${1:-.}"
command -v sha256sum >/dev/null || { echo 'Pasang coreutils di Termux terlebih dahulu.'; exit 1; }
test "$(uname -m)" = aarch64 || { echo 'Rilis ini hanya untuk Android ARM64.'; exit 1; }
test -f "$artifact_dir/SHA256SUMS" || { echo 'SHA256SUMS wajib tersedia dari rilis yang sama.'; exit 1; }
(
  cd "$artifact_dir"
  awk '$2 == "byga-agent-android-arm64" { print; found=1 } END { if (!found) exit 1 }' SHA256SUMS | sha256sum --check -
)
test -n "${PREFIX:-}" || { echo 'Jalankan di Termux.'; exit 1; }
install -m 700 "$artifact_dir/byga-agent-android-arm64" "$PREFIX/bin/byga-agent"
echo 'BYGA Agent terpasang. Jalankan: byga-agent doctor, lalu pair dan start.'
