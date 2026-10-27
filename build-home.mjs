import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const outputDirectory = resolve(process.env.GOODBOOKS_OUTPUT_DIR ?? "dist-home");
const postsDirectory = join(outputDirectory, "posts");

mkdirSync(postsDirectory, { recursive: true });

const homePage = readFileSync("index.html", "utf8")
  .replace('href="https://geo.goodbooks.cc/"', 'href="https://goodbooks.cc/"')
  .replace("<title>GEO Lab —", "<title>Goodbooks —")
  .replaceAll("GEO <em>Lab</em>", "Good<em>Books</em>")
  .replaceAll("GEO Lab &nbsp;", "Goodbooks &nbsp;");

writeFileSync(join(outputDirectory, "index.html"), homePage);

for (const fileName of readdirSync("posts").filter((name) => name.endsWith(".html"))) {
  const article = readFileSync(join("posts", fileName), "utf8")
    .replaceAll("GEO <em>Lab</em>", "Good<em>Books</em>")
    .replaceAll("GEO Lab &nbsp;", "Goodbooks &nbsp;");
  writeFileSync(join(postsDirectory, fileName), article);
}

const baseStyle = readFileSync("style.css", "utf8");
const homeStyle = readFileSync("themes/home.css", "utf8");
writeFileSync(join(outputDirectory, "style.css"), baseStyle + "\n" + homeStyle);

writeFileSync(
  join(outputDirectory, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://goodbooks.cc/</loc></url>\n</urlset>\n',
);
writeFileSync(
  join(outputDirectory, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://goodbooks.cc/sitemap.xml\n",
);
