#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
uname -m
command -v byga-agent
byga-agent doctor
if command -v termux-battery-status >/dev/null; then echo 'Termux:API executable tersedia; izin Android masih harus diberikan lokal.'; fi
