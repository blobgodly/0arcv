# 📱 0arc iOS App & MongoDB Cloud Sync Guide

This guide details how your app is built into an **unsigned iOS `.ipa`** via **GitHub Actions** and connected to **MongoDB** to prevent any data loss.

---

## 🏗️ 1. How the GitHub Flow Works

A complete GitHub Actions CI/CD pipeline has been configured in:
[`.github/workflows/build-ios-ipa.yml`](file:///.github/workflows/build-ios-ipa.yml)

### What it does automatically on macOS runners:
1. **Checks out the codebase** and installs dependencies.
2. **Builds the web bundle** (`npm run build`).
3. **Initializes & syncs the native iOS platform** via Capacitor (`@capacitor/ios`).
4. **Configures iOS App Transport Security (ATS)** so network connections to your backend/MongoDB server work without restriction.
5. **Compiles the native Xcode project** without code signing (`CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY=""`).
6. **Packages the compiled `.app` bundle** into the standard iOS `.ipa` format (`Payload/App.app`).
7. **Uploads the artifact** named `0arc-unsigned-ipa` directly to GitHub Actions (available for 30 days).

---

## 🚀 2. Building & Downloading Your `.ipa` from GitHub

### Step A: Push to GitHub
Commit and push your repository to GitHub:
```bash
git add .
git commit -m "feat: setup iOS unsigned ipa workflow and MongoDB endpoint"
git push origin main
```

### Step B: Trigger the Workflow
- Go to your repository on GitHub.
- Click the **Actions** tab.
- Click **Build Unsigned iOS IPA** in the left sidebar.
- Click **Run workflow** -> **Run workflow** (or simply push any commit to `main`).
- *(Optional)* In the `backend_url` field, you can pre-fill your hosted server URL.

### Step C: Download Your `.ipa`
- Once the workflow completes (~4 to 8 minutes on a macOS runner), click on the run.
- Scroll down to the **Artifacts** section at the bottom.
- Click **0arc-unsigned-ipa** to download the zip file.
- Unzip it to get your `0arc-unsigned.ipa`!

---

## 📲 3. Installing the Unsigned `.ipa` on iOS

Because the IPA is unsigned, you can install it using any of the following standard methods:

| Method | Requirements | Expiration |
|---|---|---|
| **TrollStore** | iOS 14.0 – 16.6.1 / 17.0 | **Permanent (never expires)** |
| **AltStore / SideStore** | Any iOS version + Free Apple ID | 7-day refresh (auto-refreshes over Wi-Fi) |
| **Sideloadly** | PC / Mac + Lightning/USB-C cable | 7-day refresh |
| **Scarlet / GBox** | Device browser | Dependent on active certificate |

**To install with TrollStore**:
Share `0arc-unsigned.ipa` to your iPhone via AirDrop or iCloud Drive, tap it in the Files app, and choose **Open in TrollStore** -> **Install**.

**To install with Sideloadly**:
1. Connect iPhone to PC/Mac.
2. Open Sideloadly and drag `0arc-unsigned.ipa` into the window.
3. Enter your Apple ID and click **Start**.

---

## 🍃 4. MongoDB Server Setup (Zero Data Loss)

To ensure your notes, tools, watchlist, images, and files are permanently saved in the cloud and synced across devices:

### Step A: Create a Free MongoDB Atlas Database
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and sign up for free.
2. Create a free **M0 (Free forever)** cluster.
3. In **Database Access**, create a user (e.g. `zeroarc_user`) with a strong password.
4. In **Network Access**, add IP `0.0.0.0/0` (allow access from anywhere).
5. Click **Connect** -> **Drivers** and copy your connection string:
   ```
   mongodb+srv://zeroarc_user:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
   ```

### Step B: Deploy Your 0arc Backend Server (Free & Instant)
You can deploy using the included [Dockerfile](file:///Dockerfile) to **Railway**, **Render**, or **Fly.io**:

1. Link your GitHub repository to [Railway.app](https://railway.app) (or Render).
2. Set Environment Variables:
   - `MONGODB_URI`: Your MongoDB Atlas connection string from Step A.
   - `APP_ACCESS_PASSWORD`: (Optional) Your private password to lock the archive.
   - `PORT`: `3000`
3. Railway will automatically build and give you a public URL, for example:
   `https://0arc-production.up.railway.app`

### Step C: Connect the iOS App to Your Server
You have two easy ways:

- **Inside the iOS App**:
  1. Open the app on your iPhone.
  2. Tap **Settings** (gear icon) in the navigation.
  3. Scroll to **Cloud Sync & Database** -> **Cloud Backend / MongoDB Server Endpoint**.
  4. Paste your server URL (e.g., `https://0arc-production.up.railway.app`) and tap **Save & Connect**.
  5. The app will immediately reload and connect with 0ms sync!

- **Or at Build Time in GitHub Actions**:
  - In GitHub repository **Settings** -> **Secrets and variables** -> **Actions**, add a repository secret named `VITE_API_URL` with your server URL.
  - The iOS app build will be pre-configured out-of-the-box!
