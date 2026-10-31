# BYGA Android MCP Control Center

Dashboard Bahasa Indonesia, Remote MCP melalui OAuth/PKCE, Durable Objects SQLite, serta agent Go dengan koneksi WSS keluar dari Android. Cloudflare mengatur job; hanya perangkat yang mengeksekusi operasi.

Rilis awal ini membatasi command ke `pwd`, `date`, `uname`, `uptime`, `whoami`, dan `termux-battery-status`. File memakai sandbox `os.Root`. Tulis/hapus dan semua operasi UI membutuhkan approval pemilik. Bridge juga meminta izin lokal satu operasi selama 60 detik pada aplikasi allowlist.

## Build dan verifikasi

Prasyarat: Node 24, Go 1.26.8, JDK 21, Android SDK 35.

```bash
npm ci
mkdir -p dist
cd termux
go test -race ./...
go vet ./...
go build -trimpath -o ../dist/byga-agent-linux-amd64 ./connector
GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -o ../dist/byga-agent-android-arm64 ./connector
cd ..
npm run build
npm run types
npm run typecheck
npm test
cd apps/android-bridge
./gradlew assembleDebug testDebugUnitTest lintDebug assembleDebugAndroidTest
```

Tes integrasi menjalankan Worker/DO lokal dengan Miniflare, executable Go sungguhan, OAuth PKCE, MCP SDK, dan Chromium. Chromium dapat dipilih melalui `CHROMIUM_PATH`; CI memasangnya melalui Playwright. Tidak menggunakan perangkat fisik sebagai simulasi hasil yang sudah diuji.

## Instalasi Android

1. Pasang Termux dan Termux:API dari sumber yang sama. Di Termux, pasang `coreutils` dan `termux-api` jika membutuhkan status baterai.
2. Unduh binary Android ARM64, installer, dan `SHA256SUMS` dari artefak rilis yang sama. Periksa asal manifest checksum, lalu jalankan `bash install-termux.sh <direktori-rilis>`.
3. Masuk ke dashboard dengan kunci akses pemilik, pilih **Tambah perangkat**, lalu jalankan perintah pairing yang ditampilkan.
4. Konfirmasi nama dan ID perangkat di dashboard. Jalankan `byga-agent start` pada Termux. Tanpa konfirmasi, credential belum bisa membuka WSS.
5. Untuk tulis/hapus file, tambahkan `--allow-write` saat pairing. Default hanya baca. Workspace default `~/byga-workspace`, credential disimpan di `~/.config/byga/agent.json` dengan mode 0600, di luar workspace.
6. Untuk kendali UI, pasang APK bridge, aktifkan Accessibility secara manual, buat allowlist package, dan salin token lokal ke argumen `--bridge-token` saat pairing. Setiap operasi memerlukan approval dashboard dan izin satu kali di APK.

Lihat [panduan instalasi](docs/INSTALL_ANDROID.md), [konfigurasi MCP](docs/MCP_CLIENTS.md), dan [deployment production](docs/PRODUCTION_SETUP.md).

## Batas rilis ini

- Satu workspace pemilik; belum merupakan layanan multitenant publik.
- APK artefak diberi label **debug**, bukan APK release yang ditandatangani key pemilik.
- Screenshot, R2 media persistence, Shizuku, arbitrary shell, SMS/kontak/lokasi/clipboard, dan penjadwalan kalender tidak diaktifkan.
- Workflow menjalankan langkah baca berurutan, tanpa loop, condition, atau cron. Runtime hanya mengiklankan tools yang didukung perangkat dan scope client.
- Hasil job dibatasi, bukan streaming terminal interaktif. Job ambigu setelah disconnect tidak diputar ulang. Cancellation bersifat best effort.
- Android fisik, emulator instrumentation, Samsung Galaxy A06, serta integrasi langsung UI ChatGPT belum diverifikasi. Jangan menganggap lolos tes simulator sebagai verifikasi hardware.
- Android dapat menghentikan Termux/Accessibility di latar belakang. Tidak ada jaminan proses bertahan 24/7.

[Arsitektur](docs/ARCHITECTURE.md) · [Keamanan](docs/SECURITY.md) · [Audit upstream](docs/UPSTREAM_AUDIT.md) · [Matriks pengujian](docs/TEST_MATRIX.md)
