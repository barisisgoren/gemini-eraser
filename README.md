# gemini-eraser

A client-side tool that removes visible watermarks from Gemini AI-generated images using **Reverse Alpha Blending** — no AI inpainting, no server uploads, mathematically exact pixel recovery.

## Features

- 100% client-side — images never leave your browser
- Mathematical precision via reverse alpha blending formula
- Auto-detects 48×48 and 96×96 watermark variants
- Works in all modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)

## Installation & Usage

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Local preview (offline-capable after build)
npm run serve
```

Open `http://localhost:4173` in your browser after running `npm run serve`.  
Do **not** open `index.html` directly via `file://`.

> **Note:** Disable canvas fingerprint defender extensions (e.g. Canvas Fingerprint Defender) to avoid processing errors.

## Project Structure

```
gemini-eraser/
├── public/
│   ├── index.html
│   └── terms.html
├── src/
│   ├── core/
│   │   ├── alphaMap.js          # Alpha channel calculation
│   │   ├── blendModes.js        # Reverse alpha blending logic
│   │   └── watermarkEngine.js   # Main engine coordinator
│   ├── assets/
│   │   ├── bg_48.png            # 48×48 watermark reference
│   │   └── bg_96.png            # 96×96 watermark reference
│   ├── i18n/                    # Localization files
│   ├── userscript/              # Tampermonkey userscript
│   ├── app.js
│   └── i18n.js
├── dist/
├── build.js
└── package.json
```

## Testing

```bash
npm test
```

## Limitations

- Removes only Gemini's **visible** watermark (semi-transparent logo, bottom-right)
- Does **not** remove invisible/steganographic watermarks (SynthID)

## Legal Disclaimer

This tool is provided for **personal and educational use only**.

Removing watermarks may have legal implications depending on your jurisdiction and intended use. Users are solely responsible for compliance with applicable laws, terms of service, and intellectual property rights.

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. THE AUTHOR SHALL NOT BE LIABLE FOR ANY CLAIM OR DAMAGES ARISING FROM ITS USE.**

## Credits

© 2025 [barisisgoren](https://github.com/barisisgoren) — JavaScript port of [GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool) by [@allenk](https://github.com/allenk).  
Reverse Alpha Blending method © 2024 AllenK (Kwyshell) — MIT License.

## License

[MIT](./LICENSE)
