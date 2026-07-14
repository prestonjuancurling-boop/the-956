// Instagram/Facebook's publishing APIs require images to be fetched from a
// public HTTPS URL — neither accepts raw local files. This copies the chosen
// PNGs from a local social/output/<date>/ folder into the public site
// (assets/social-posts/<slug>/), commits, pushes, and waits for the Pages
// deploy so the URLs are actually live before the publish scripts use them.

import { readFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = join(import.meta.dirname, "..", "..");

export async function hostImages(sourceDir, filenames, slug) {
  const destDir = join(repoRoot, "assets", "social-posts", slug);
  mkdirSync(destDir, { recursive: true });

  for (const name of filenames) {
    const src = join(sourceDir, name);
    if (!existsSync(src)) throw new Error(`Missing file: ${src}`);
    copyFileSync(src, join(destDir, basename(name)));
  }

  const relDir = `assets/social-posts/${slug}`;
  execSync(`git add ${relDir}`, { cwd: repoRoot, stdio: "inherit" });
  const staged = execSync("git diff --cached --name-only", { cwd: repoRoot }).toString().trim();
  if (staged) {
    execSync(
      `git commit -m "Host images for social post (${slug})" --quiet`,
      { cwd: repoRoot, stdio: "inherit" }
    );
    execSync("git push origin main", { cwd: repoRoot, stdio: "inherit" });
  }

  const urls = filenames.map((n) => `https://the956.com/${relDir}/${basename(n)}`);

  // Wait for the Pages deploy so the URLs are actually reachable.
  console.log("Waiting for Pages deploy...");
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(urls[0], { cache: "no-store" });
      if (res.ok) { console.log("Deploy live."); break; }
    } catch {}
    if (i === 23) throw new Error("Timed out waiting for hosted images to go live.");
  }

  return urls;
}
