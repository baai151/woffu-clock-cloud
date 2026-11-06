# UI assets

- `capgemini-white.svg`: original logo downloaded from https://www.capgemini.com/wp-content/themes/capgemini2025/assets/images/capgeminiWhite.svg on 2026-11-06. Geometry and proportions preserved. The welcome symbol is a crop of this same source, not a redrawn mark.
- `feather/`: selected Feather v4.29.2 icons, https://github.com/feathericons/feather, under the included MIT license.
- `../ui-assets.js` contains these exact SVG files as strings so the existing Worker can serve them without an external CDN or additional assets binding. If an asset changes, update its corresponding string in that module.

No remote image, font or icon requests are made by the application. Typography uses the system sans-serif font stack.

## Cinematic welcome (2026-11-06)

- `intro-glass-v1.webp`: 1600 × 900 WebP, 80,322 bytes. Created with the built-in ImageGen tool, then resized/compressed with Sharp. The deployable source asset is included in this directory; the original generation is retained with the local design evidence.
- Final prompt: "Create a cinematic 3D background plate for a premium Capgemini-blue app entrance animation. Landscape 16:9. No text, no letters, no logos, no icons, no UI. A dark midnight navy studio space (#04142d), sculptural translucent cobalt blue and luminous cyan glass ribbons sweeping around the outer edges of the frame, forming a dramatic asymmetric open orbital tunnel, photoreal ray-traced glass, polished edges, elegant caustics, subtle small floating light particles, deep volumetric perspective. A large clean dark negative-space center (middle 40% of image) must stay empty and high contrast for a separate white logo overlay. The most interesting glass forms are in upper-left and lower-right, with some foreground ribbons cropped at the edges; peripheral cyan lighting, quiet navy center. Sophisticated high-end motion-design still, bold depth, sleek modern tech, clean composition, no concentric circular rings, no stars, no galaxy, no rainbow colors. This is a production background image to animate with a camera push and rotation. Wide composition that also crops beautifully to a centered portrait viewport."
- `../intro-backdrop.js` bundles this WebP as base64 for the existing Worker asset route; it is decoded only when that route is requested. Regenerate the export from `fs.readFileSync("src/assets/intro-glass-v1.webp").toString("base64")` when replacing the image.
- The client requests the backdrop only when the intro plays. The versioned URL is immutable-cached. Portrait screens rotate the abstract plate 90 degrees to retain the glass edges without stretching the image.
- `/assets/capgemini-emblem.svg` uses the original logo geometry and a `234 0 51 48` viewport. Its blue variant changes only the fill. The 3D extrusion is built from these source-image layers with CSS perspective; no brand geometry was redrawn or generated.
