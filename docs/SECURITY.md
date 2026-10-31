# Keamanan dan threat model

| Ancaman | Kontrol dan batas |
| --- | --- |
| Remote execution tanpa izin | Dashboard cookie HttpOnly Secure, token MCP scoped atau OAuth, credential perangkat terpisah dan di-hash |
| CSRF/XSS | Origin tepat, host tepat, SameSite Strict, consent handle sekali pakai dari library, React escaping, CSP, no framing |
| OAuth replay / code interception | Authorization Code + PKCE S256 wajib, resource audience, token TTL 15 menit, refresh TTL satu hari, grant revoke |
| Command injection | Enum executable, argv langsung, argumen hanya kosong atau `uname -a`, PATH/env terkendali, tidak ada `sh -c` |
| Path/symlink escape | Path relatif dan `os.Root` Go, regular-file checks, atomic rename, permission lokal untuk write/delete |
| Job replay | SQL unique idempotency per actor/client, journal agent, terminal-state check, tidak replay job dispatched |
| Credential perangkat dicuri | Owner confirm, revoke/stop, WSS ditutup saat stop, token berbeda per perangkat, TLS verification aktif |
| Approval oleh AI sendiri | Endpoint approval hanya cookie owner; OAuth/PAT tidak diterima untuk REST admin |
| Abuse / memory | Body byte cap 64 KiB termasuk chunked, rate limit login/OAuth/MCP/admin, queue 50, output cap, timeout |
| Android IPC lintas aplikasi | Loopback-only, token 256-bit terenkripsi Keystore, constant-time comparison, no Origin, byte cap, izin lokal one-shot |
| UI sensitif | Default allowlist kosong, aplikasi sensitif umum ditolak, lockscreen ditolak, password redacted, screenshot OFF |

Tidak ada default shared password. Kunci pemilik acak dibuat saat setup; server hanya menyimpan hash SHA-256 dari kunci 256-bit tersebut. Jangan menggantinya dengan password manusia yang lemah tanpa menerapkan password KDF.

PAT berlaku 30 hari dan dicabut dari registry secara konsisten. OAuth state memakai KV library resmi; konsistensi edge dan cache library berlaku pada pencabutan grant, jangan menganggap revocation selalu instan pada semua lokasi. Emergency stop dievaluasi pada submit/connect, menutup koneksi yang ada, dan membatalkan job.

Audit hanya menyimpan event/subject/timestamp. Argumen dan hasil job dapat mengandung data pengguna; tersimpan privat dalam SQLite selama periode retensi. Jangan memilih workspace berisi secret. Tidak ada screenshot/diagnostic upload otomatis. R2 tidak diprovisikan karena tidak ada fitur media yang diaktifkan.

Keterbatasan: satu akun owner, belum SSO/multi-user/step-up identity; cookie pemilik berumur delapan jam; tidak ada independent penetration test. Accessibility bersifat berkuasa dan dapat dipengaruhi perubahan layar. Izin lokal dan allowlist tidak dapat menjamin keamanan semua aplikasi. Jangan mengizinkan aplikasi pembayaran, autentikator, password manager, atau dialog izin.

Rotasi kunci pemilik dilakukan melalui secret `ADMIN_PASSWORD_HASH` Cloudflare; hentikan sesi pemilik lama/berikan redeploy sesuai kebutuhan. Rotasi device: stop dan revoke, unpair lokal, lalu pair ulang. Rotasi bridge melalui tombol **Putar token lokal**. Jangan mempublikasikan file akses pemilik atau konfigurasi agent.
