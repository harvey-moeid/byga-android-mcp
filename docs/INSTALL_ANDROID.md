# Instalasi Android tanpa root

Gunakan Termux dan Termux:API dengan penandatangan yang sama. `termux-api` CLI perlu paket Termux:API Android dan izin lokalnya; keberadaan executable bukan bukti izin sudah diberikan. Samsung A06 belum diuji secara fisik.

Binary `byga-agent-android-arm64` dibangun dengan `GOOS=android GOARCH=arm64 CGO_ENABLED=0`. Pemeriksaan ELF menunjukkan AArch64 PIE dengan interpreter `/system/bin/linker64`; bukan binary Linux glibc yang diberi label Android. Tetap lakukan tes nyata di Termux sebelum penggunaan kritis.

Installer memverifikasi entri checksum binary yang tepat sebelum menyalin ke `$PREFIX/bin`. Verifikasi asal `SHA256SUMS` secara terpisah; checksum tanpa asal terpercaya tidak membuktikan autentisitas. Jangan menjalankan installer dari `curl | sh`.

```bash
bash install-termux.sh ~/storage/downloads/byga-release
byga-agent pair --server https://SERVER-PRODUCTION --code KODE --name 'Android saya'
# Konfirmasi perangkat pada dashboard
byga-agent start
```

Untuk file write/delete, pair dengan `--allow-write`. Untuk UI, pasang APK debug secara sadar melalui installer Android, aktifkan Accessibility sendiri, masukkan package allowlist pada APK, salin token lokal, lalu pair dengan `--bridge-token TOKEN`. Token harus dirahasiakan; hapus clipboard setelah menyalinnya. Daftar capability tetap selama pairing; perubahan izin lokal memerlukan pair ulang agar discovery akurat.

Layanan loopback hidup selama AccessibilityService terhubung. Tidak ada port publik. Tidak ada root/ADB eksternal untuk jalur inti. Bridge hanya memberi satu izin operasi dalam 60 detik. UI tree dibatasi dan password disembunyikan. Screenshot tidak diaktifkan. Gestur diterima oleh Android secara asinkron; hasil `ok` berarti diterima API, bukan verifikasi semantik target berhasil.

`byga-agent doctor` memeriksa konfigurasi tanpa mencetak token. `config` meredaksi token. `status`, `stop`, dan `restart` memakai Unix socket lokal berizin 0600. `restart` berjalan foreground. Log saat ini menuju stderr; gunakan fasilitas log supervisor Termux jika ingin riwayat persisten. Instal/uninstall memakai script, bukan subcommand agent. Ctrl-C/SIGTERM melakukan shutdown dan pembatalan proses anak.

Untuk boot/background, gunakan supervisor Termux yang Anda percayai dan panggil `start-agent.sh`; konfigurasi boot/autostart harus dipilih pemilik sendiri. Jangan menganggap battery exemption menjamin daemon tetap hidup. Saat offline, job belum dispatch dapat menunggu sampai expiry; job yang sudah dispatch tidak otomatis diulang.

Uninstall: stop agent, revoke perangkat di dashboard, jalankan `uninstall-agent.sh`, nonaktifkan Accessibility, lalu hapus APK melalui Android. Workspace dan journal tidak dihapus oleh script agar data pengguna tidak hilang. Hapus manual hanya setelah ditinjau.
