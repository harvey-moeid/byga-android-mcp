# MCP client

Endpoint: `https://SERVER-PRODUCTION/mcp`. Gunakan OAuth Authorization Code + PKCE S256 dan discovery resource/authorization metadata. Owner login dan consent berlangsung melalui browser. Scope yang tersedia: `device:read`, `terminal:run`, `files:read`, `files:write`, `android:read`, `android:control`, `workflow:run`.

Client yang mendukung Authorization header dapat memakai PAT yang dibuat pada dashboard. Token hanya muncul sekali; jangan ditaruh pada URL. Dashboard menerbitkan token awal dengan device read, file read, dan safe terminal. Token lainnya dapat dibuat melalui endpoint admin dengan subset scope yang didukung.

Tool discovery memfilter scope dan capability perangkat terkonfirmasi. `terminal_run`, file tools, dan UI tools mengembalikan job asinkron. Panggil `terminal_job_status` sampai terminal. `idempotency_key` wajib; gunakan key yang sama hanya untuk retry operasi yang sama. Menyetujui job hanya dapat dilakukan pemilik pada dashboard, bukan MCP tool.

Contoh argumen terminal:

```json
{"device_id":"UUID-PERANGKAT","arguments":{"command":"uname","args":["-a"]},"reason":"Periksa versi kernel perangkat","idempotency_key":"ID-UNIK-PER-OPERASI"}
```

Diuji: HTTP initialize/discovery/tool call melalui library MCP SDK server, client test HTTP, OAuth browser consent dan PKCE; legacy stateless protocol `2025-03-26` diterima oleh handler SDK. Belum diuji: pemasangan connector melalui antarmuka ChatGPT, Claude, atau Codex tertentu. Ketersediaan OAuth/MCP pada aplikasi tersebut tergantung fitur akun/client masing-masing.
