#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
test -n "${PREFIX:-}" || { echo 'Jalankan di Termux.'; exit 1; }
echo 'Hentikan agent dengan Ctrl-C. Cabut akses perangkat di dashboard sebelum menghapus binary.'
byga-agent unpair || true
rm -f "$PREFIX/bin/byga-agent"
echo 'Binary dan credential pairing dihapus. Workspace dan jurnal dipertahankan.'
