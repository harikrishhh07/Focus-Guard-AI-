# FocusGuard AI — Human Attention Preservation Platform

FocusGuard AI is structured as a **Two-Component System**:
1. **The FocusGuard Web App (`http://localhost:8000/`)** — Central hub for all user CRUD operations, goal tracking, focus sprint timer, profile preferences, RAG + Hugging Face AI insights, and analytics dashboards.
2. **The FocusGuard Chrome Extension (`chrome_extension/`)** — Lightweight telemetry collector that runs quietly in the browser, tracks visited URLs, classifies active tabs (including study vs. entertainment on YouTube), and syncs browsing data to the Web App.

---

## System Architecture

```
┌──────────────────────────────────────┐
│       🌐 Chrome Extension            │
│       (Telemetry Collector)          │
│                                      │
│  • Monitors active tab URLs          │
│  • Contextual YouTube classification │
│  • Syncs browsing time to Web App    │
└──────────────────┬───────────────────┘
                   │
                   │ POST /api/browsing/log/
                   ▼
┌───────────────────────────────────────────────────────────┐
│              🛡️ FocusGuard Web App                        │
│          (Django + DRF + SQLite/Postgres)                 │
│                                                           │
│  ┌─────────────────────────┐  ┌────────────────────────┐  │
│  │     User Operations     │  │   AI Intelligence      │  │
│  │   • Full CRUD on Goals  │  │   • ChromaDB RAG Engine│  │
│  │   • Profile & Settings  │  │   • Hugging Face LLM   │  │
│  │   • Focus Sprint Timer  │  │   • 12-Category Parser │  │
│  └─────────────────────────┘  └────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │       Interactive Glassmorphism Dashboard           │  │
│  │   • Attention allocation charts (Chart.js)          │  │
│  │   • Productive vs Distracting breakdown             │  │
│  │   • RAG-driven cognitive attention insights         │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

---

## 12-Category Classification Taxonomy

Every visited website and YouTube video is categorized into:

| Tier | Categories |
| :--- | :--- |
| **Productive** 🟢 | `PRODUCTIVE`, `DEVELOPMENT`, `EDUCATION`, `CREATIVE` |
| **Neutral** 🟡 | `COMMUNICATION`, `FINANCE`, `SYSTEM`, `NEWS_READING` |
| **Distracting** 🔴 | `ENTERTAINMENT`, `SOCIAL_MEDIA`, `GAMING`, `SHOPPING` |

*Smart YouTube Handling:* YouTube tutorials, lectures, and coding videos (e.g., *freeCodeCamp, MIT, CS50, Fireship*) are recognized as **EDUCATION / DEVELOPMENT** (`PRODUCTIVE`), while Shorts, gaming streams, and vlogs are marked as **ENTERTAINMENT** (`DISTRACTING`).

---

## How to Run

### Step 1: Start the Web App
```bash
# In the project root directory
.\venv\Scripts\python manage.py runserver
```
- Open [http://localhost:8000/](http://localhost:8000/) in your web browser.
- Log in with default credentials:
  - **Username:** `admin`
  - **Password:** `admin123`
- All features are available in the Web App:
  - **📊 Dashboard:** 12-category attention charts, productive ratio, live browsing telemetry table.
  - **⏱️ Focus Sprint:** Pomodoro-style deep work timer.
  - **🎯 Attention Goals:** Create, view progress, and delete productivity goals.
  - **⚙️ User Profile:** Update occupation and daily target focus hours.
  - **✨ Generate AI Analysis:** Uses ChromaDB RAG and Hugging Face to generate cognitive focus evaluations.

---

### Step 2: Load the Chrome Extension (Data Collector)
1. Open Google Chrome and go to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right.
3. Click **Load unpacked** and select the folder:
   ```
   info_ai_P\chrome_extension
   ```
4. Click the FocusGuard shield icon in your Chrome toolbar.
5. Click **Connect to Web App** (enters credentials once).
6. The extension now runs in the background, classifying your browsing habits and streaming data to your Web App dashboard.

---

### Step 3: Windows Desktop Agent (App & Idle Monitoring)
Tracks active desktop applications (e.g., VS Code, Word, Slack) with a 10-minute idle threshold:
```bash
python desktop_agent.py
```

---

### Step 4: AI Vision & Phone Distraction Tracker (DeepFace + OpenCV)
Eliminates **"Phantom Productivity"** (when you leave a productive IDE or article open on the screen while scrolling on your phone in your lap):
```bash
# Option A: Run standalone with HUD preview window
python vision_tracker.py

# Option B: Run silently in the background
python vision_tracker.py --headless

# Option C: Run desktop agent and vision tracker together
python desktop_agent.py --with-vision
```
* **Real-time Gaze & Head-Pose Detection**: Tracks pitch & yaw to detect when you look down at a smartphone or look away from the monitor.
* **DeepFace Cognitive Analysis**: Evaluates facial presence and fatigue/drowsiness.
* **Live Dashboard Widget**: Real-time attention score, phone distraction incident counter, and automatic focus session distraction adjustments.
* **100% Local & Private**: Video frames are processed strictly on your machine—no images or video feeds ever leave your computer.
