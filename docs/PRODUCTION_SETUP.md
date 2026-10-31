# Deployment production saja

Tidak ada remote staging, staging bucket, atau staging domain pada proyek ini. Miniflare dan localhost hanya dipakai untuk pengujian lokal.

Resource: satu Worker baru `byga-android-mcp-production`, dua kelas SQLite Durable Objects, satu namespace OAuth KV. Tidak mengubah Worker BYGA lain di akun. R2/media persistence tidak diaktifkan; tidak ada bucket yang dibuat untuk fitur yang belum aktif.

Untuk deployment selanjutnya, gunakan token Cloudflare least privilege untuk Workers Scripts edit, Durable Objects, dan namespace KV milik proyek. Konfigurasikan melalui secret store, bukan Git:

- `CLOUDFLARE_API_TOKEN` sebagai GitHub secret.
- `CLOUDFLARE_ACCOUNT_ID`, `BYGA_PUBLIC_ORIGIN`, `BYGA_OAUTH_KV_ID` sebagai GitHub production environment variables.
- `ADMIN_PASSWORD_HASH` sebagai Worker secret: SHA-256 dari kunci acak 32 byte. Jangan gunakan default UNCONFIGURED atau password manusia berentropi rendah.

`wrangler.jsonc` berisi placeholder account-independent. `scripts/deploy-production.mjs` menghasilkan konfigurasi lokal terabaikan dengan origin dan KV ID yang disuplai. Secret yang sudah tersimpan pada Worker dipertahankan oleh Wrangler. Jangan mengubah secret menjadi plain vars.

```bash
npm ci
# Build Go simulator dahulu seperti README karena diperlukan tes integrasi
npm run build
npm run types
npm run typecheck
npm test
# Set env konfigurasi melalui lingkungan yang aman
node scripts/deploy-production.mjs
node scripts/smoke-production.mjs
```

Deployment pertama pada sesi ini dapat dilakukan melalui koneksi native Cloudflare: bundle Worker yang telah diuji diunggah sebagai ES module, binding DO/KV/secret ditambahkan, migration `v1` membuat SQLite classes, lalu workers.dev diaktifkan dengan preview URLs OFF. Laporan rilis memuat version ID aktual setelah API merespons; URL tidak dianggap live sebelum smoke PASS.

GitHub workflow `production.yml` berjalan saat push ke `main` atau manual, bergantung pada workflow quality, memakai concurrency tunggal. Push `main` menjalankan quality sekali melalui workflow production; branch lain dan PR tetap menjalankan CI tanpa deploy. Tidak auto-deploy source PR yang tidak dipercaya. Workflow quality menghasilkan binary/APK debug, reports, SBOM, source SHA, dan checksum. Workflow tidak mengklaim signature APK release atau hardware test.

Workflow production memiliki fallback konfigurasi non-rahasia sesuai resource production yang sudah terpasang: account `07086b4d368d0a37ebcbbf186e51eecf`, origin `https://byga-android-mcp-production.harveymoeid.workers.dev`, dan OAuth KV `48d35113c8d34ddcba4a21d234a29aa3`. GitHub production environment variables tetap dapat menggantinya; bila memindahkan akun, set ketiganya bersama. Token tetap hanya dari GitHub secret dan hash admin tetap Worker secret. Origin untuk smoke diwariskan dari konfigurasi deploy yang sama.

Migrations awal hanya membuat tabel/kelas baru. Perubahan selanjutnya harus additive/backward-compatible. Sebelum perubahan skema, export data privat melalui prosedur backup yang diuji untuk akun Anda. Tidak ada klaim backup/restore sudah diuji. Rollback kode melalui versi Worker sebelumnya bila kompatibel; jangan rollback skema dengan delete namespace/tabel. Stop dispatch terlebih dahulu saat insiden, cabut client/device, kemudian audit.

Smoke test hanya health, dashboard, auth REST, dan challenge MCP; tidak menjalankan perintah pada perangkat pengguna. Simulator production, bila digunakan, harus identity terpisah, workspace sementara, lalu direvoke.
