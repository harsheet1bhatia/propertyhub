# v4 update  (v3 pehle apply ho chuka hona chahiye)

## Step 1: code apply
1. `propertyhub-pwa-v4` folder ko project ke root mein paste karo (jahan package.json hai).
2. Terminal: `node propertyhub-pwa-v4/apply-v4.mjs`
3. `git add .`  ->  `git commit -m "app v4"`  ->  `git push`

## Step 2: index.html ka script BADLO (iPhone)
Pehle wala script (jo v3 mein diya tha) hata ke ye paste karo. Ye `<link rel="manifest" ...>` line ke THEEK NEECHE rahe:

```html
<script>
(function(){try{var q=new URLSearchParams(location.search);if(q.get('public')!=='1'||q.get('client'))return;var ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);var l=document.querySelector('link[rel="manifest"]');if(ios){if(l)l.remove();var m=document.createElement('meta');m.name='apple-mobile-web-app-capable';m.content='yes';document.head.appendChild(m);return}if(!l){l=document.createElement('link');l.rel='manifest';document.head.appendChild(l)}l.href='/api/manifest?c='+encodeURIComponent(q.get('company')||'fnf-properties')}catch(e){}})();
</script>
```

## Step 3: iPhone par (deploy complete hone ke BAAD)
1. Settings -> Safari -> Advanced -> Website Data -> apni site ka data delete karo (purana saved page hatane ke liye).
2. Home screen ka purana icon delete karo.
3. Safari mein viewer link kholo (`?public=1&company=...`), poora load hone do.
4. Share -> Add to Home Screen -> Add.
