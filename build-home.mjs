import {
  cpSync,
  existsSync,
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
if (existsSync("googled0ff232d179376b7.html")) {
  cpSync("googled0ff232d179376b7.html", join(outputDirectory, "googled0ff232d179376b7.html"));
}

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
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://goodbooks.cc/</loc></url>\n'
    + readdirSync(postsDirectory).filter(name => name.endsWith('.html'))
      .map(name => `  <url><loc>https://goodbooks.cc/posts/${name.slice(0, -5)}</loc></url>`).join('\n')
    + '\n</urlset>\n',
);
const sitemapDomains = [
  "goodbooks.cc", "geo.goodbooks.cc", "atlas.goodbooks.cc", "blocks.goodbooks.cc",
  "fieldnotes.goodbooks.cc", "gallery.goodbooks.cc", "signal.goodbooks.cc", "ledger.goodbooks.cc",
  "blog.goodbooks.cc", "journal.goodbooks.cc", "archive.goodbooks.cc", "folio.goodbooks.cc",
  "studio.goodbooks.cc", "type.goodbooks.cc", "terminal.goodbooks.cc",
];
writeFileSync(
  join(outputDirectory, "sitemap-index.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + sitemapDomains.map(domain => `  <sitemap><loc>https://${domain}/sitemap.xml</loc></sitemap>`).join("\n")
    + '\n</sitemapindex>\n',
);
writeFileSync(
  join(outputDirectory, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://goodbooks.cc/sitemap.xml\nSitemap: https://goodbooks.cc/sitemap-index.xml\n",
);
