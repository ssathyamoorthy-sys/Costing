# Deploying to the company server (Windows, LAN-only)

This app runs as a single Node.js process that serves both the API and the
built frontend, so no reverse proxy or second server is needed. It's meant
to run on the office network only — not exposed to the public internet.

## One-time setup

1. **Install Node.js** (LTS, v20 or v22) from nodejs.org.

2. **Install Git for Windows** and clone the repo. The path below is just an
   example — clone it anywhere (e.g. `Documents\GitHub\Costing` works fine
   too); `deploy\redeploy.bat` and `deploy\rollback.bat` figure out their
   own location automatically, so there's no path to hardcode:
   ```
   git clone https://github.com/ssathyamoorthy-sys/Costing.git D:\CostingApp
   cd D:\CostingApp
   ```

3. **Install dependencies and build both halves:**
   ```
   cd backend
   npm install
   npm run build
   cd ..\frontend
   npm install
   npm run build
   ```

4. **Create `backend\.env`** (not committed to git):
   ```
   DATABASE_URL="file:./prod.db"
   JWT_SECRET="<a long random string - do not reuse the dev default>"
   PORT=4000
   ```
   Generate `JWT_SECRET` with `openssl rand -hex 32`, or:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   It signs login sessions, so it should be unique to this server and kept
   secret.

5. **Set up the production database:**
   ```
   cd backend
   npx prisma migrate deploy
   npx prisma generate
   npx tsx prisma/seed.ts
   ```
   This creates the initial accounts, including an `admin` login - change
   its password immediately after first login (Change password page), and
   from then on create new users from the **User Rights** panel in the app.

6. **Install NSSM** (nssm.cc) and register the app as a Windows Service so
   it survives reboots and restarts automatically if it crashes:
   ```
   nssm install TerryTowelCosting
   ```
   In the dialog that opens:
   - Path: full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`)
   - Startup directory: full path to wherever you cloned it, plus `\backend`
   - Arguments: `dist\server.js`

   Then start it:
   ```
   nssm start TerryTowelCosting
   ```
   If `nssm` isn't on the system PATH, use its full path instead (e.g.
   `C:\nssm\win64\nssm.exe install TerryTowelCosting`) - and edit the
   `NSSM_PATH` line near the top of both `redeploy.bat` and `rollback.bat`
   to match, so they can find it too.

7. **Open the firewall to the office network only:**
   Add a Windows Firewall inbound rule for TCP port 4000, scoped to the
   office's local subnet (not "Any address"). Other PCs on the network can
   then reach the app at `http://<this-server's-hostname-or-IP>:4000`.

## Updating after a code change

Every future update is one command, from an Administrator Command Prompt,
run from inside the repo (anywhere inside it — it finds its own root):
```
deploy\redeploy.bat
```
It pulls the latest code, rebuilds both halves, applies any new database
migrations, and restarts the service.

**What this does and doesn't touch:**
- Your data — quotes, customers, raw material rates, users, everything in
  the database — is **never affected** by an update. The database file
  (`backend\prod.db`) and the `.env` file are both excluded from git, so
  `git pull` can't overwrite or reset them; they only ever exist on this
  server. Every schema migration in this project is additive (adds new
  optional fields) and never removes or changes existing ones, so older
  data always keeps working after an update.
- If any step fails partway (a build error, a bad migration), the script
  stops immediately and does **not** restart the service - the previous
  working version keeps running untouched. Nothing live breaks from a
  failed update attempt.
- Before pulling anything, it automatically records the exact version that
  was running, so it can be undone (see below).

## Rolling back a bad update

If an update causes a problem, run:
```
deploy\rollback.bat
```
It asks for confirmation, then moves the code back to exactly the version
that was running immediately before the last `redeploy.bat` run, rebuilds,
and restarts the service. Like updating, this never touches your data —
only the application code moves backward.

Don't run `redeploy.bat` again right after a rollback until the problem has
actually been fixed on GitHub - otherwise it just pulls the same broken
version straight back.

Rollback only goes back one step (to before the *last* update) — it's meant
for "that last update broke something, undo it," not a general-purpose time
machine. If you need to go back further, say so and I'll walk through it.

## Troubleshooting

- **Service won't start:** check `nssm status TerryTowelCosting`, and look
  for errors by running `node dist\server.js` directly from the `backend`
  folder in a terminal to see the actual error.
- **Nobody else on the network can reach it:** confirm the firewall rule
  from step 7, and that they're using this server's actual hostname/IP,
  not `localhost`.
- **`git pull` fails with "local changes would be overwritten":** `redeploy.bat`
  already auto-discards local `package-lock.json` drift before pulling (the
  most common cause - npm regenerates it slightly on every install). If it's
  some other file, run `git status` to see what changed, then
  `git checkout -- <path>` to discard it if it's safe to lose, before
  retrying `git pull`.
