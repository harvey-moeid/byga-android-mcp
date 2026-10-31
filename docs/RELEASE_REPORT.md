# Bukti rilis awal BYGA 1.0.0

**Mode: PRODUCTION ONLY — NO STAGING.** Laporan ini mencatat hasil nyata, bukan klaim semua fitur spesifikasi atau hardware sudah selesai diuji.

| Item | Hasil |
| --- | --- |
| Repository | https://github.com/harvey-moeid/byga-android-mcp |
| Implementation branch | `codex/byga-production-build` |
| Implementation commit | `052ce2b3842401ce666635a66711d08fd0a2faaa` |
| Dashboard / Worker build | PASS: Vite, Wrangler dry-run, generated types, TypeScript strict |
| Backend / protocol / browser | PASS: 16 Vitest tests, termasuk Worker/SQLite DO/WSS/real Go executable, MCP, OAuth PKCE, Chromium desktop/mobile |
| Go | PASS: 6 tests dengan race detector, go vet, Linux amd64 simulator, Android ARM64 binary |
| Android APK | PASS: APK debug dan instrumentation APK dibangun; bukan APK release dengan signing key pemilik |
| Android JVM | PASS: 2 OneShotGate tests |
| Android lint | PASS: tidak ada lint errors; laporan tersedia dalam artefak |
| Android instrumentation / fisik | NOT_TESTED; test APK dikompilasi, tidak dijalankan pada emulator/perangkat |
| Dependency production audit | PASS: npm audit melaporkan 0 vulnerabilities |
| GitHub Actions | SUCCESS: https://github.com/harvey-moeid/byga-android-mcp/actions/runs/41180620073 |
| Artefak CI | https://github.com/harvey-moeid/byga-android-mcp/actions/runs/41180620073/artifacts/13034289910 |
| Cloudflare upload / activation | PASS: API 200; deployment aktif pada 100%; namespace SQLite dan binding secret/KV dikonfirmasi lewat API |
| Production HTTP smoke | BLOCKED: environment proxy menolak destination hostname dengan HTTP 403; tidak diklaim PASS |

## Deployment aktual

- Worker: `byga-android-mcp-production`.
- URL: https://byga-android-mcp-production.harveymoeid.workers.dev/dashboard
- Deployment ID: `432dd4c6-0e6d-4f9d-bb4c-0e8c6447c410`.
- Version ID: `739dd802-86a8-48ed-9578-7e1d1ec5d461`.
- Waktu API: 31 Oktober 2026, 14:40 WIB.
- Migration tag `v1`; dua Durable Objects dikonfirmasi `use_sqlite: true`.
- workers.dev enabled; preview URLs disabled. Tidak ada staging yang dibuat.
- Native upload memakai bundle minified yang juga lulus 16 tes lokal. Artefak CI memuat bundle dry-run tanpa minify dari source yang sama.

## Checksum

SHA-256 ZIP artefak CI, dilaporkan GitHub:

```text
e9022ff562c8a5358ea248a3ca4dfd6abf0ef60dd56f19bba6aaf946b4943989
```

SHA-256 bundle production lokal yang diunggah:

```text
cebe87135885a793aad09eee7c93b92e5772c232cd4032753ed91dfb0d9aa05e
```

ZIP berisi binary, APK debug, test APK, `dist/SHA256SUMS`, SBOM CycloneDX, source commit, screenshots hasil pengujian simulator, dan laporan Android. Checksum binary/APK CI harus dibaca dari manifest dalam ZIP; build lokal dan CI dapat berbeda karena metadata build dan signing debug.

## Batas dan langkah berikutnya

1. Izinkan `byga-android-mcp-production.harveymoeid.workers.dev` pada konfigurasi jaringan environment, lalu jalankan `BYGA_PUBLIC_ORIGIN=https://byga-android-mcp-production.harveymoeid.workers.dev node --use-env-proxy scripts/smoke-production.mjs`.
2. Verifikasi login dan pairing dengan identity perangkat tes terisolasi. Jangan menjalankan perintah perangkat pengguna sebagai smoke test tanpa approval.
3. Uji pemasangan Termux/bridge, background behavior, jaringan seluler, dan izin Accessibility pada Samsung A06 atau target fisik lain.
4. Screenshot, R2 media storage, Shizuku, shell arbitrer, sensitive Android APIs, jadwal cron, dan workflow condition/loop tetap tidak aktif/tidak diimplementasikan pada rilis awal ini.
5. Source belum digabung ke main. Workflow production manual untuk main sudah disiapkan; credential/variables GitHub production environment perlu dikonfigurasi untuk deployment selanjutnya melalui Actions.
6. Kunci pemilik tidak dimasukkan ke Git, artefak CI, audit log, maupun laporan ini. Dashboard memakai kunci acak tersendiri; buat credential MCP client melalui dashboard.

Tidak ada klaim production-ready penuh, kompatibilitas client ChatGPT UI, pengujian Android fisik, atau availability/SLO tanpa bukti tambahan.
