# Matriks pengujian

Hasil aktual sesi build dicatat pada artefak `RELEASE_REPORT.md`. Perintah dan cakupan:

| Gate | Bukti |
| --- | --- |
| Dashboard dan Worker bundle | `npm run build` / Vite + Wrangler dry-run |
| Typecheck | `npm run types && npm run typecheck` |
| Policy/security | Vitest menolak shell/argv berbahaya, traversal, origin, oversize, credential forged |
| Go sandbox dan lifecycle | `go test -race ./...`, `go vet ./...`; symlink read/write escape, output cap, journal, HTTPS |
| Integrasi nyata | Miniflare Worker/DO + binary Go, offline queue → WSS → ACK → hasil |
| MCP | Initialize, filtered tool list, tool call, scope denial, PAT revoke |
| OAuth | DCR, PKCE S256, consent handle, verifier salah, grant revoke |
| Approval dan workflow | Write tertahan sampai owner approval; file bytes benar; workflow berurutan |
| Reconnect/idempotency | Duplicate request/result, no replay ambiguous dispatch, expired/cancelled terminal |
| Browser | Chromium login/pairing/navigation, viewport desktop/mobile, no root horizontal overflow, no pageerror |
| Android JVM | OneShotGate single-use, expiry, emergency stop, concurrent consumer |
| Android compile/lint | APK debug + test APK; lint errors harus nol |
| Android instrumentation/fisik | NOT_TESTED tanpa emulator/perangkat; test APK tidak sama dengan tes dijalankan |

Uji manual wajib sebelum penggunaan perangkat nyata: install pada Samsung A06, verifikasi ABI, Termux:API battery permission, pair/revoke ulang, screen-off/network handoff/reboot, foreground/background process kill, Accessibility local approval satu kali, UI password redaction, package allowlist, key rotation, emergency stop, file symlink sandbox. Jangan menyetujui operasi sensitif dengan tujuan tes pada akun produksi nyata.
