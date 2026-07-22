#!/bin/bash
# MiniX — יצירת תעודה מקומית לאייפד (פעם אחת). דאבל-קליק ← ואז node server.js
# אותו דפוס כמו iAYA: המצלמה והמיקרופון בספארי דורשים HTTPS גם ברשת הביתית.
cd "$(dirname "$0")"
mkdir -p certs

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "192.168.1.1")

openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=MiniX Local" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${IP}" 2>/dev/null

if [ -f certs/server.key ] && [ -f certs/server.crt ]; then
  echo ""
  echo "✔ התעודה נוצרה (certs/)."
  echo ""
  echo "עכשיו:"
  echo "  1. node server.js"
  echo "  2. באייפד, ספארי:  https://${IP}:8080"
  echo "  3. ספארי יזהיר על התעודה — Show Details ← Visit Website"
  echo "  4. לאשר מצלמה ומיקרופון — וזהו."
  echo ""
  echo "(אם ה-IP של המק משתנה — להריץ את הקובץ הזה שוב.)"
else
  echo "✖ יצירת התעודה נכשלה — צלם את המסך הזה ושלח לקלוד."
fi
read -p "אפשר לסגור את החלון (Enter)…"
