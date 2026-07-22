# Deploy — Monthly & Turnover (rekapan.site)

Panduan menjalankan aplikasi di server produksi dengan **nginx** sebagai reverse
proxy + TLS di depan **Next.js**.

## Arsitektur

```
Internet ──▶ nginx (:80 → :443, TLS)  ──▶  Next.js app  (127.0.0.1:7564, UI + API)
                                                │
                                                ├─▶ PostgreSQL
                                                ├─▶ Redis (antrean BullMQ: ekspor/impor/ZIP)
                                                └─▶ S3 / MinIO (penyimpanan gambar)
```

Aplikasi ini **satu server Next.js** — frontend dan API di port yang sama
(**7564**). nginx yang menghadap publik (80/443); port 7564 tetap internal.

Isi folder:

| File                                                 | Fungsi                                           |
| ---------------------------------------------------- | ------------------------------------------------ |
| [`nginx/rekapan.site.conf`](nginx/rekapan.site.conf) | Reverse proxy nginx (HTTP→HTTPS, proxy ke :7564) |
| [`systemd/rekapan.service`](systemd/rekapan.service) | Menjalankan app sebagai service di :7564         |

---

## 1. Siapkan aplikasi

```bash
# di server, sebagai user aplikasi
git clone <repo> /opt/rekapan && cd /opt/rekapan
npm ci

# konfigurasi produksi — JANGAN commit file ini
cp .env.example .env
#   isi: DATABASE_URL, REDIS_URL, S3_*, ACCOUNT_CENTER_*, SESSION_SECRET,
#        ENCRYPTION_KEY, APP_URL=https://rekapan.site

npx prisma migrate deploy          # terapkan migrasi ke database produksi
npm run build                      # build Next.js
```

## 2. Jalankan sebagai service (systemd)

```bash
sudo cp deploy/systemd/rekapan.service /etc/systemd/system/rekapan.service
# sesuaikan WorkingDirectory, User/Group, dan path npm di dalamnya
sudo systemctl daemon-reload
sudo systemctl enable --now rekapan
sudo systemctl status rekapan       # pastikan aktif di :7564
```

> Alternatif tanpa systemd: `pm2 start npm --name rekapan -- run start`.

## 3. Pasang nginx

```bash
sudo cp deploy/nginx/rekapan.site.conf /etc/nginx/sites-available/rekapan.site.conf
sudo ln -s /etc/nginx/sites-available/rekapan.site.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot            # untuk tantangan ACME
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Sertifikat TLS (Let's Encrypt)

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/certbot -d rekapan.site -d www.rekapan.site
sudo systemctl reload nginx
```

Perpanjangan otomatis sudah dipasang certbot (`systemctl status certbot.timer`).
Setelah reload, buka `https://rekapan.site`.

## 5. Firewall

Buka hanya 80/443 ke publik; biarkan 7564 internal.

```bash
sudo ufw allow 'Nginx Full'      # 80 + 443
sudo ufw enable
# JANGAN buka 7564 ke publik — nginx menjangkaunya via 127.0.0.1.
```

Untuk penguncian lebih ketat, jalankan app hanya di localhost dengan mengganti
`start` di `package.json` menjadi `next start -H 127.0.0.1 -p 7564`.

---

## ⚠️ Penting: X-Forwarded-For & Pembatasan IP

Fitur **Pembatasan IP** (Admin → Pembatasan IP) menentukan IP klien dari header
`X-Forwarded-For` — nilai **paling kiri**. Konfigurasi nginx di sini sudah:

- **menimpa** (bukan menambah) `X-Forwarded-For` dengan `$remote_addr`, agar klien
  tidak bisa memalsukan IP yang di-allowlist dan menembus pembatasan;
- meneruskan `X-Real-IP` dan `X-Forwarded-Proto`.

**Jika nginx berada di belakang CDN/proxy lain (mis. Cloudflare):** `$remote_addr`
adalah IP CDN, bukan pengunjung. Hapus baris `proxy_set_header X-Forwarded-For`
pada conf, lalu percayakan CDN dengan modul `real_ip` di blok `server` HTTPS:

```nginx
# hanya percayai rentang milik CDN Anda (contoh: Cloudflare)
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... (daftar lengkap: https://www.cloudflare.com/ips/)
real_ip_header   CF-Connecting-IP;   # atau X-Forwarded-For
real_ip_recursive on;
```

Dengan itu `$remote_addr` menjadi IP asli pengunjung dan pembatasan IP bekerja
benar. **Salah setel di sini bisa mengunci semua orang** begitu allowlist aktif —
uji dari IP Anda sendiri dulu (tombol "Gunakan IP saya" di halaman itu).

---

## Update / redeploy

```bash
cd /opt/rekapan
git pull
npm ci
npx prisma migrate deploy
npm run build
sudo systemctl restart rekapan
```
