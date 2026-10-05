# Deploying the study site on a VPS

One small server runs the study site (AEGIS in monitor mode) behind Caddy,
which gets an HTTPS certificate automatically. Running the study itself (codes,
export, withdrawal, bots) is described in [`study/README.md`](../../study/README.md).

## 1. Server

- **Size:** Ubuntu 22.04 or 24.04, 2 GB RAM, 1–2 vCPU, 25 GB disk.
  - The image includes the ML model.
  - The study database stays small: estimated well under 5 MB per participant with raw events (gzip-compressed batches). Check this after the pilot.
- **Region:** where the ethics approval says the data may be stored (see the
  protocol, §7). Decide this **before** submitting to the ethics committee.
- **Domain:** create an A record (e.g. `study.example.com`) pointing to the server's IP.
- **Firewall:** open ports 22, 80 and 443 only.

## 2. Install Docker and get the code

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/dipro20debnath/AEGIS-BOT-SHIELD.git && cd AEGIS-BOT-SHIELD
```

## 3. Fill in the information sheets

`docs/thesis/irb/consent_en.md` and `consent_bn.md` are shown to participants
exactly as written (up to their "Consent" section). Replace every
`[placeholder]` with the approved text: contacts, retention period,
withdrawal period, ethics committee. Until then, the site shows a "DRAFT"
warning on the consent page.

## 4. Configure and start

```bash
cd deploy/study
cp .env.example .env
python3 -c "import secrets; print(secrets.token_hex(32))"   # paste as AEGIS_SECRET_KEY in .env
nano .env                                                  # set STUDY_DOMAIN
docker compose up -d --build                               # first build ~5-10 min
docker compose exec study python -m aegis_study check      # must print OK
```

Open `https://STUDY_DOMAIN` and walk through the study once with a test code (step 5).

## 5. Codes

```bash
docker compose exec study python -m aegis_study codes --kind human --count 50 > human-codes.txt
```

- Give each participant one code.
- Write the name ↔ code list on paper or in an encrypted file, **never on the server**.

Pilot first:
1. Run 2–3 sessions with test codes yourself.
2. Export, and check the data in `sessions.csv` and `telemetry.csv`.
3. Withdraw the test codes: `python -m aegis_study withdraw <code> --yes`.

## 6. Backups (daily)

```bash
crontab -e
# 03:15 every night: consistent copy into the data volume, keep 14 days
15 3 * * * cd ~/AEGIS-BOT-SHIELD/deploy/study && docker compose exec -T study sh -c 'python -m aegis_study backup --out /data/backup-$(date +\%F).db && find /data -name "backup-*.db" -mtime +14 -delete'
```

Copy a backup off the server now and then, then store it encrypted:

```bash
docker compose cp study:/data/backup-2026-11-15.db .
```

## 7. Export and shut down

```bash
docker compose exec study python -m aegis_study export --out /data/dataset
docker compose cp study:/data/dataset ./dataset
```

1. Encrypt `dataset/` (e.g. a 7-Zip AES-256 archive) before it leaves the server.
2. When the study is over, delete the server, including its volumes (`docker compose down -v`).
3. Keep only the encrypted export, for the retention period in the protocol.

## Notes

- **Logging:**
  - Caddy writes no access log here, so IP addresses are not logged anywhere.
  - The app stores no IP addresses either.
- **One worker:** `uvicorn` runs with a single worker, because the shop keeps carts in memory and SQLite wants one writer. That is plenty for one participant at a time, or a classroom.
- **Security:**
  - No admin web page: everything is a command on the server.
  - Keep the server updated (`sudo apt upgrade`) and do not share `.env`.
