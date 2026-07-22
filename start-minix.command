#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  MiniX — הפעלה בדאבל-קליק. בלי טרמינל, בלי פקודות.
#  עושה לבד: משיכת עדכונים ← התקנות ← תעודה לאייפד ← הפעלה ←
#  פותח את הדפדפן במק ומראה את הכתובת לאייפד.
# ══════════════════════════════════════════════════════════════════
cd "$(dirname "$0")"
clear
echo ""
echo "  🔥 מיניX — מתחילים. דקה אחת..."
echo ""

# 1. עדכונים אחרונים מהריפו (אם יש אינטרנט; אם אין — ממשיכים עם מה שיש)
git pull --ff-only 2>/dev/null && echo "  ✔ עודכן לגרסה האחרונה" || echo "  • ממשיך עם הגרסה הקיימת"

# 2. התקנות (רק אם חסר)
if [ ! -d node_modules ]; then
  echo "  • מתקין רכיבים (פעם ראשונה בלבד — כמה דקות)..."
  npm install --no-audit --no-fund >/dev/null 2>&1 && echo "  ✔ הותקן"
fi

# 3. תעודה לאייפד (רק אם אין, או אם ה-IP של המק השתנה)
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$IP" ]; then
  if [ ! -f certs/server.crt ] || ! openssl x509 -in certs/server.crt -noout -text 2>/dev/null | grep -q "$IP"; then
    mkdir -p certs
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
      -keyout certs/server.key -out certs/server.crt \
      -subj "/CN=MiniX Local" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${IP}" 2>/dev/null
    echo "  ✔ תעודת אייפד מוכנה"
  fi
fi

# 4. מפתח (חד-פעמי — אם אין .env, מבקשים פעם אחת בחלון)
if [ ! -f .env ]; then
  echo ""
  echo "  ⚠ חסר מפתח Gemini (פעם ראשונה בלבד)."
  read -p "  הדבק כאן את המפתח ולחץ Enter: " KEY
  echo "GEMINI_API_KEY=${KEY}" > .env
  echo "  ✔ נשמר. לא תישאל שוב."
fi

# 5. הפעלה
echo ""
echo "  ════════════════════════════════════════════"
if [ -n "$IP" ] && [ -f certs/server.crt ]; then
  echo "  📱 באייפד (ספארי):   https://${IP}:8080"
  echo "     (פעם ראשונה: Show Details ← Visit Website)"
  echo ""
  echo "  💻 במק — נפתח לבד עוד רגע."
  ( sleep 3; open "https://localhost:8080" ) &
else
  echo "  💻 במק — נפתח לבד עוד רגע."
  ( sleep 3; open "http://localhost:8080" ) &
fi
echo "  ════════════════════════════════════════════"
echo ""
echo "  (לסגירה: פשוט לסגור את החלון הזה)"
echo ""
node server.js
