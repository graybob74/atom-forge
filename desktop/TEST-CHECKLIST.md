# Atom Forge desktop — Windows test checklist

Build: GitHub → Actions → "Desktop app" → the run's artifact `atom-forge-windows` holds `Atom Forge_0.23.0_x64_en-US.msi`
and `Atom Forge_0.23.0_x64-setup.exe` (NSIS). Either installs the same app; the first launch may fetch the WebView2 runtime
if Windows lacks it (Windows 11 has it).

1. **Install and launch.** The window opens on the Primordial soup at 60 fps; the corner badge reads `60 fps · N threads`
   once a big world is loaded (small worlds stay on one thread by design).
2. **Isolation.** Settings → the Threads row should say `16 threads of 32` (auto) — not "this page is not cross-origin
   isolated". If it says the latter, the headers were not applied: tell me (it is a one-line fix in `tauri.conf.json`).
3. **Benchmark.** Settings → Run benchmark. Expected on the 7950X3D: 12,000 atoms of water well under 1.5 ms a step
   (V22 in Chrome: about 4 ms), Flash memory under 1 ms. Please send me the three lines it prints, once with Threads
   = Auto and once with Threads = 1.
4. **Determinism.** Settings → Threads = 8; load "Hydrogen + oxygen", press R (reload) twice and spark the same spot
   each time: the two runs should look the same for a good while. (Different thread counts give different rounding,
   so Auto vs 8 may diverge after a few hundred femtoseconds — that is expected.)
5. **Big worlds.** Performance mode on, Empty chamber, box 560 × 360, Place tool with 100 at a click, fill with water
   to the 12,000 limit: the speed readout should be about 2–3× what the browser gives on the same machine.
6. **Everything else behaves as in the browser:** presets, tools, builder, Lab › Chips (write a byte in the flash
   preset), the Elements and Molecules dialogs, dark/light theme, window resize.
7. **Fonts.** With no internet the app falls back to system fonts (Google Fonts are blocked by the isolation headers
   unless fetched with CORS, which the page now does) — looks slightly different, works the same.

If anything fails, the app's console is reachable with F12 in debug builds; in release builds just describe what you saw.
