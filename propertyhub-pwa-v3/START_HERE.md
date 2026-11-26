# v3 update

## Step 1: code apply karo
1. `propertyhub-pwa-v3` folder ko project ke root mein paste karo (jahan package.json hai).
2. Terminal mein: `node propertyhub-pwa-v3/apply-v3.mjs`
3. `git add .`  ->  `git commit -m "app v3"`  ->  `git push`

## Step 2: iPhone ke liye (index.html mein 1 chhota change)
`index.html` kholo. Jahan `<link rel="manifest" ...>` line hai, uske THEEK NEECHE ye paste karo:

```html
<script>
(function(){try{var p=new URLSearchParams(location.search),l=document.querySelector('link[rel="manifest"]');if(p.get('public')==='1'&&!p.get('client')){if(!l){l=document.createElement('link');l.rel='manifest';document.head.appendChild(l)}l.href='/api/manifest?c='+encodeURIComponent(p.get('company')||'fnf-properties')}}catch(e){}})();
</script>
```

Phir iPhone par:
1. Purana home-screen icon DELETE karo.
2. Safari mein viewer link kholo (jo `?public=1&company=...` wala ho), Share -> Add to Home Screen.

## Step 3 (optional): admin ke liye 6-digit code login
Supabase Dashboard -> Authentication -> Email Templates -> "Magic Link" mein
`{{ .Token }}` add karo, jaise: `Your login code: {{ .Token }}`
Isse iPhone home-screen app ke andar hi code type karke login ho jata hai.
