<div align="center">

<img src="icons/icon128.png" width="96" alt="AutoAnswer icon">

# ✨ AutoAnswer

**🖱️ Double-click a question. 🤖 AI answers it in place.**

A Chrome extension that fills in answers on Google Forms, Ofek assignments and most other quiz pages,
using **Groq (free)** or **ChatGPT** with your own API key.

👨‍💻 **Coded by Idok**

<img src="https://flagcdn.com/24x18/us.png" width="20" height="15" alt="US flag"> [English](#-english) · <img src="https://flagcdn.com/24x18/il.png" width="20" height="15" alt="Israel flag"> [עברית](#-עברית)

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Groq](https://img.shields.io/badge/AI-Groq%20(free)-F55036)
![ChatGPT](https://img.shields.io/badge/AI-ChatGPT-10A37F?logo=openai&logoColor=white)
![No build step](https://img.shields.io/badge/build-none-lightgrey)

</div>

---

## <img src="https://flagcdn.com/24x18/us.png" width="20" height="15" alt="US flag"> English

### 🚀 Features

- **Double-click to answer.** Turn it on, double-click any question, and the answer is entered for you.
- **Most question types are supported:**
  - Multiple choice (radio) and checkboxes, including Google Forms' custom widgets
  - Short and long text fields (including `contenteditable` editors)
  - Dropdowns (`<select>` and Google Forms dropdowns)
  - Drag & drop: matching, sorting into groups, ordering (HTML5 and mouse-based)
  - Image, drawing and formula questions: the extension takes a screenshot and the AI decides from the picture
  - Questions inside **iframes** (such as the Ofek player)
- **Hidden mode (on by default).** Nothing is drawn on the page: no outline, no pop-up messages, no `ON` badge. The last answer (or error) is shown in the extension popup.
- **Free AI.** Groq's free tier is enough for normal use. ChatGPT is supported too.
- **No build step, no dependencies.** Plain JavaScript, load the folder and go.

### 📥 Install

1. **Download:** click **Code → Download ZIP** on this page and extract it, or run
   ```bash
   git clone https://github.com/CodePexV1/AutoAnswer.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `AutoAnswer` folder (the one that contains `manifest.json`).
   You can also just drag the folder onto the page.
5. Pin the extension to the toolbar (puzzle icon → pin).

### 🔑 Get a free Groq key

1. Go to **[console.groq.com/keys](https://console.groq.com/keys)** and sign in.
2. Click **Create API Key** and copy it (it starts with `gsk_`).
3. Open the AutoAnswer popup, choose **Groq**, and paste the key.
   You should see **✓ המפתח תקין** ("key is valid") under the fields.

Prefer ChatGPT? Choose **ChatGPT** and paste a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (paid).

### 🎯 Use

1. Turn it on with the switch at the top of the popup, or press **`Alt+Shift+A`**.
2. Open the quiz and **double-click the text of a question**.
3. Wait a few seconds. The answer gets selected or typed in.
4. Not sure what happened? Open the popup: the **last answer** box shows the answer or the error.

Double-clicking outside any recognised question makes the extension look at the whole visible part of the page (with a screenshot).

### ⚙️ Settings

| Setting | What it does |
|---|---|
| On / off switch | Enables double-click answering (`Alt+Shift+A` toggles it too) |
| Hidden mode | On: nothing appears on the page. Off: the question gets a green outline and a small message shows the answer |
| Groq / ChatGPT | Which AI to use |
| API key | Your key, stored only in your browser |
| Model | Optional. The list fills in automatically with the models your key can use |

**Default models:** Groq uses `openai/gpt-oss-120b` for text questions and switches automatically to `qwen/qwen3.8-27b` when a screenshot is needed. ChatGPT uses `gpt-4o`.

### 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| Nothing happens on double-click | Make sure the switch is on, then refresh the page (F5). In hidden mode check the popup's last answer box |
| "Extension updated - refresh the page" | You reloaded the extension; refresh the tab |
| "Invalid key" in the popup | Copy the key again from console.groq.com/keys, without spaces |
| Screenshot questions fail on Groq | Groq's image models change often. Type another vision model from [console.groq.com/docs/vision](https://console.groq.com/docs/vision) in the Model field, or use ChatGPT |
| Rate-limit error (429) | The free tier has a per-minute limit. Wait a moment and try again |

### 🔒 Privacy

- Your API key is stored only in your browser (`chrome.storage.local`) and is sent only to the AI provider you chose.
- For each question, the extension sends the question text, the list of answer elements and, for visual questions, a screenshot of the visible tab. Nothing is sent anywhere else, and there are no analytics.

### 🛠️ How it works

```
double-click ─► find the question's container ─► collect its inputs (radio, text, dropdown, drag…)
             ─► (screenshot if the question is visual) ─► ask the AI for JSON actions
             ─► perform the actions: click / type / select / drag
```

| File | Role |
|---|---|
| `manifest.json` | Extension config (Manifest V3) |
| `background.js` | Settings, screenshots, calls to Groq / OpenAI |
| `content.js` | Double-click → detect the question → describe its inputs → apply the AI's answer |
| `popup/` | The popup: switch, hidden mode, provider, key, model, last answer |
| `test/` | Local test pages covering 11 question types |
| `tools/make-icons.js` | Generates the icons |

### 🧪 Local testing

```bash
npx http-server . -p 5577
```

- `http://localhost:5577/test/index.html` with the extension loaded: 11 question types, each shows `PASS` when answered correctly.
- `http://localhost:5577/test/index.html?mock` runs `content.js` without the extension and with a fake AI, to test detection and filling.

### ⚠️ Limitations

- Chrome only allows extensions outside the Web Store to be installed in Developer mode, so there's no one-click installer.
- The AI can be wrong. Check the answers that matter.
- Hidden mode hides the extension's on-page UI only; the extension still appears in `chrome://extensions` and its icon stays in the toolbar unless you unpin it.

---

## <img src="https://flagcdn.com/24x18/il.png" width="20" height="15" alt="Israel flag"> עברית

<div dir="rtl">

תוסף כרום שעונה על שאלות בלחיצה כפולה: Google Forms, משימות באופק, ורוב האתרים האחרים.
עובד עם **Groq (חינם)** או **ChatGPT** עם המפתח שלך.

### 📥 התקנה

1. מורידים את הקוד: **Code ← Download ZIP** בעמוד הזה, ומחלצים.
2. פותחים בכרום את `chrome://extensions`.
3. מפעילים **מצב מפתח (Developer mode)** בפינה העליונה.
4. לוחצים **טען פריט לא ארוז (Load unpacked)** ובוחרים את התיקייה `AutoAnswer` (זו שבתוכה `manifest.json`). אפשר גם פשוט לגרור את התיקייה לדף.
5. מצמידים את התוסף לסרגל.

### 🔑 מפתח חינמי של Groq

1. נכנסים ל-**[console.groq.com/keys](https://console.groq.com/keys)** ומתחברים.
2. לוחצים **Create API Key** ומעתיקים (מתחיל ב-`gsk_`).
3. פותחים את התוסף, בוחרים **Groq** ומדביקים. צריך להופיע **✓ המפתח תקין**.

### 🎯 שימוש

1. מדליקים את המתג למעלה (או `Alt+Shift+A`).
2. נכנסים למשימה ולוחצים **פעמיים על הטקסט של השאלה**.
3. מחכים כמה שניות, והתשובה מסומנת או נכתבת לבד.
4. **מצב נסתר** דלוק כברירת מחדל: שום דבר לא מופיע בדף. התשובה האחרונה (או השגיאה) מופיעה בחלון התוסף.

### 🧠 סוגי שאלות

אמריקאיות, ריבוי בחירה, שדות טקסט, רשימות נפתחות, גרירה ושחרור (התאמה, מיון, סידור), שאלות עם תמונה / ציור / נוסחה (עם צילום מסך), ושאלות בתוך iframe (כמו בנגן של אופק).

### 🩺 לא עובד?

- לא קורה כלום? בודקים שהמתג דלוק ומרעננים את הדף (F5). במצב נסתר מסתכלים בתיבה "תשובה אחרונה" בחלון התוסף.
- "המפתח לא תקין"? מעתיקים שוב את המפתח, בלי רווחים.
- שגיאה 429? הגעת למגבלה של הגרסה החינמית. מחכים דקה.

### 🔒 פרטיות

המפתח נשמר רק בדפדפן שלך. ל-AI נשלחים רק הטקסט של השאלה, רשימת רכיבי התשובה, ובשאלות ויזואליות צילום של הלשונית.

</div>
