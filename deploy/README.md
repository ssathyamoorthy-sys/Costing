# Deploying to the company server (Windows, LAN-only)

This app runs as a single Node.js process that serves both the API and the
built frontend, so no reverse proxy or second server is needed. It's meant
to run on the office network only — not exposed to the public internet.

## One-time setup

1. **Install Node.js** (LTS, v20 or v22) from nodejs.org.

2. **Install Git for Windows** and clone the repo:
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
   Generate `JWT_SECRET` with `openssl rand -hex 32` or any password
   generator - it signs login sessions, so it should be unique to this
   server and kept secret.

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
   - Startup directory: `D:\CostingApp\backend`
   - Arguments: `dist\server.js`

   Then start it:
   ```
   nssm start TerryTowelCosting
   ```

7. **Open the firewall to the office network only:**
   Add a Windows Firewall inbound rule for TCP port 4000, scoped to the
   office's local subnet (not "Any address"). Other PCs on the network can
   then reach the app at `http://<this-server's-hostname-or-IP>:4000`.

## Updating after a code change

Once the above is done, every future update is just:
```
deploy\redeploy.bat
```
run from an Administrator Command Prompt inside `D:\CostingApp`. It pulls
the latest code, rebuilds both halves, applies any new database migrations,
and restarts the service. If any step fails, it stops immediately and
leaves the previous working version running - it won't restart the service
on top of a broken build.

## Troubleshooting

- **Service won't start:** check `nssm status TerryTowelCosting`, and look
  for errors by running `node dist\server.js` directly from
  `D:\CostingApp\backend` in a terminal to see the actual error.
- **Nobody else on the network can reach it:** confirm the firewall rule
  from step 7, and that they're using this server's actual hostname/IP,
  not `localhost`.
- **`git pull` fails with "local changes would be overwritten":** something
  modified a file directly on the server (most commonly `package-lock.json`
  after an `npm install`). Run `git status` to see what changed, then
  `git checkout -- <path>` to discard it if it's safe to lose (lock files
  usually are), before retrying `git pull`.
