# AutoAnswer ✓

תוסף כרום שעונה על שאלות בלחיצה כפולה - Google Forms, משימות באופק, ובכל אתר אחר.
מבוסס AI: **Grok (xAI)** או **ChatGPT (OpenAI)** עם המפתח שלך.

## איך זה עובד

1. מפעילים את התוסף (מתג בחלון התוסף, או `Alt+Shift+A`). על האייקון יופיע `ON`.
2. נכנסים למשימה ולוחצים **פעמיים** על השאלה (או מסמנים את הטקסט שלה ולוחצים פעמיים).
3. התוסף מזהה את גבולות השאלה ואת כל רכיבי התשובה בה, שולח ל-AI ומבצע את התשובה לבד:
   - **אמריקאיות** (radio) ו-**ריבוי בחירה** (checkbox) - כולל הרכיבים של Google Forms
   - **שדות טקסט** ותיבות טקסט ארוכות (גם contenteditable)
   - **רשימות נפתחות** (`select` ו-dropdown של Google Forms)
   - **גרירה ושחרור** - התאמה, מיון לקבוצות, סידור (HTML5 drag & drop וגם גרירה מבוססת עכבר)
   - **שאלות עם תמונה / ציור / נוסחה** ו-**בחירת תמונה** - התוסף מצלם את המסך, מסמן כל רכיב במספר, וה-AI מחליט לפי התמונה מה לעשות
   - שאלות בתוך **iframe** (כמו בנגן של אופק)
4. בתחתית המסך מופיעה הודעה קטנה עם התשובה.

אם הלחיצה הכפולה לא נמצאת בתוך שאלה מזוהה, התוסף מנתח את כל החלק הנראה של הדף עם צילום מסך.

## התקנה

1. מורידים את הקוד (`Code → Download ZIP` וחילוץ, או `git clone`).
2. פותחים בכרום את `chrome://extensions`.
3. מפעילים **Developer mode** (מצב מפתח) בפינה העליונה.
4. לוחצים **Load unpacked** (טען פריט לא ארוז) ובוחרים את התיקייה של הפרויקט (זו שבה נמצא `manifest.json`).
5. מצמידים את התוסף לסרגל, פותחים אותו, בוחרים Grok או ChatGPT ומדביקים מפתח API:
   - Grok: https://console.x.ai → API Keys
   - ChatGPT: https://platform.openai.com/api-keys
6. אפשר לשנות מודל (שדה "מודל" - נטען אוטומטית רשימת המודלים שזמינים למפתח שלך). ברירת מחדל: `grok-4` / `gpt-4o`. לשאלות עם תמונה/גרירה צריך מודל שתומך בתמונות.

## פרטיות

- המפתחות נשמרים רק אצלך בדפדפן (`chrome.storage.local`).
- נשלחים ל-AI רק: הטקסט של השאלה, רשימת רכיבי התשובה, ובשאלות ויזואליות - צילום של החלק הנראה בלשונית.

## בדיקה מקומית

```bash
npx http-server . -p 5577
```

- `http://localhost:5577/test/index.html` - 11 סוגי שאלות (עם התוסף מותקן). כל שאלה מראה `PASS` כשהיא נענתה נכון.
- `http://localhost:5577/test/index.html?mock` - מריץ את `content.js` בלי התוסף ובלי AI, עם "AI מדומה", לבדיקת הזיהוי והמילוי.

## מבנה

| קובץ | תפקיד |
|---|---|
| `manifest.json` | הגדרות התוסף (Manifest V3) |
| `background.js` | קריאות ל-Grok / OpenAI, צילום מסך, מתג ON |
| `content.js` | לחיצה כפולה → זיהוי שאלה → סימון רכיבים → ביצוע התשובה |
| `popup/` | הממשק המינימלי: מתג, ספק, מפתח, מודל |
| `test/` | דפי בדיקה |

---

**English:** Chrome extension (MV3). Turn it on, double-click a question, and Grok or ChatGPT answers it in place. It handles radios, checkboxes, text fields, dropdowns, drag & drop, and image-based questions (screenshot plus numbered marks), on Google Forms, Ofek and generic sites, including iframes.
