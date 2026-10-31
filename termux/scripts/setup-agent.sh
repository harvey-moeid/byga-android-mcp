#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
command -v byga-agent >/dev/null
echo 'Agent tidak memerlukan akses root. Pasang Termux:API dari sumber yang sama dengan Termux bila memakai battery status.'
echo 'Pairing read-only secara default. Tambahkan --allow-write hanya jika Anda menginginkan operasi tulis yang disetujui.'
byga-agent pair "$@"
