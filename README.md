# RadioMix Web Player

Versão web do console RadioMix (visual inspirado no app Android / RadioBOSS).

## Site público

https://orion292.github.io/RadioMixWeb/

## O que é

- Player HTTP para streams Icecast / SHOUTcast / qualquer áudio HTTP(S)
- Interface dark com accent laranja
- Abas: Player, DSP (referência), Stream (info), MTA (gera `client.lua`), Info
- VU meters e EQ visual (simulado)
- Gerador de script MTA com cópia rápida

## O que **não** faz

O encoding AAC, o cliente SOURCE e o DSP real continuam no **app Android**.  
O navegador só consome a URL pública do mount.

## Como usar

1. Abra o site (ou `index.html` local)
2. Na aba **PLAYER**, cole a URL do seu mount (ex: `https://servidor:8000/live`)
3. Clique em **CARREGAR** ou Play
4. Na aba **MTA**, ajuste a URL e copie o `client.lua`

## Relação com o app Android

```
Playlist + DSP + AAC SOURCE  →  Icecast/SHOUTcast  →  URL pública
                                                      ↙            ↘
                                              RadioMix Web      resource MTA
                                              (este site)       (client.lua)
```

---

RadioMix Broadcast Engine v2 · Web
