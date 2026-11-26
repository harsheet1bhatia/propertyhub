# PropertyHub app — sirf 4 kaam

1. Ye poora `propertyhub-pwa` folder apne project ke root mein rakho (jahan `package.json` hai).
2. Terminal mein project root se ye ek command chalao:
   ```
   node propertyhub-pwa/apply-pwa.mjs
   ```
   (Ye `App.jsx` + `index.html` khud badal deti hai, files khud copy karti hai, aur purani files ka `.bak` backup banati hai. Kuch gadbad lage to usi pal rok deti hai aur kuch change nahi karti.)
3. Supabase → SQL Editor mein ye ek line run karo:
   ```sql
   alter publication supabase_realtime add table properties, property_tours;
   ```
4. `git add . && git commit -m "app" && git push` — Vercel deploy kar dega.

Phir phone par site kholo → top-right **Install App**.

Neeche `INSTALL_GUIDE.md` sirf jaankari ke liye hai (script jo changes karti hai uski list). Aapko wo haath se nahi karna.
