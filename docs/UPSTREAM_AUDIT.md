# Audit upstream — 31 Oktober 2026

Repositori di-clone read-only, default branch dan SHA diverifikasi. Tidak ada source upstream yang disalin ke implementasi BYGA; seluruh server lokal tambahan tidak dijalankan.

| Referensi | Branch / SHA | Lisensi | Temuan |
| --- | --- | --- | --- |
| [TecnicalBot/termux-mcp](https://github.com/TecnicalBot/termux-mcp) | main / `5841772c79e1a318cc3c367978bafcaace0a7867` | MIT | Go 1.25.5, mcp-go 0.57.0, stdio/HTTP/SSE, modul Termux. Shell memakai string command dengan pola regex allow/deny dan task manager. Eksekutor membatasi output, tetapi mewarisi os.Environ; buffer Write dapat mengembalikan short count saat mencapai cap. |
| [kahz12/DroidMCP](https://github.com/kahz12/DroidMCP) | main / `409fbca3d26991d300fcbf6aa1cd0943523d7181` | MIT | Go 1.26; banyak server terpisah, loopback/API key, sandbox dan argv, per-command allowlist serta perlindungan env override. Lebih luas dari kebutuhan v1; menjalankan seluruh suite memperbanyak server/port. |
| [htekdev/phone-mcp-server](https://github.com/htekdev/phone-mcp-server) | main / `f3732553b56ca32d76147b616a8b0fbd33368d98` | MIT | Node + MCP SDK + Termux:API. Banyak wrapper memakai execFile; tool shell menggunakan `sh -c`. Server listen 0.0.0.0; modul sensitif SMS/clipboard/media tidak sesuai default BYGA. |
| [shizzgar/shizuku-mcp](https://github.com/shizzgar/shizuku-mcp) | master / `1c136c0b6a26952fd23fb22dadf2a30e0c756db8` | Apache-2.0 | Python ≥3.11, MCP/Pydantic/Uvicorn, rish/Shizuku; raw shell enabled pada konfigurasi sumber yang dibaca. Menambah privilege/dependency di luar kebutuhan v1. |

Keputusan: kandidat primary tetap referensi desain local execution, tetapi BYGA memakai eksekutor Go kecil sendiri dengan command enum, argv, lingkungan terpilih, `os.Root`, dan WSS outbound. Ini menghindari local MCP server kedua, string-shell policy, dan port masuk. Tidak mengasumsikan keempat lisensi atau fitur sumber memberi izin menyalin semua materi.

Dokumentasi Cloudflare yang diverifikasi: `createMcpHandler` pada `agents/mcp/server`, MCP SDK v2; library terpasang agents 0.32.0 membutuhkan `@modelcontextprotocol/server` 2.4.0. OAuth memakai `@cloudflare/workers-oauth-provider`, consent helper/PKCE/discovery milik library. API diperiksa melalui types package dan tes protokol nyata. Tanggal compatibility dipin 2026-10-30 karena workerd terpasang menolak tanggal yang lebih baru.

Semua dependency runtime tetap membawa lisensi masing-masing di distribusi package. Artefak `sbom.cdx.json` mencatat paket yang benar-benar dipakai. Bila source upstream ditambahkan di masa depan, sertakan copyright dan teks lisensinya sebelum merge.
