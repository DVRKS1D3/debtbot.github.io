#!/usr/bin/env node
/**
 * Сборка статики сайта debtbot.
 *
 * Источники данных:
 *   releases.json — релизы бота
 *   faq.json      — вопросы и ответы
 *   site.json     — базовый адрес сайта
 *
 * Что генерируется:
 *   index.html    — блоки между маркерами <!-- build:имя:start --> ... :end -->
 *                   (releases, count, updated, latest, index, faq, jsonld)
 *   feed.xml      — RSS-лента обновлений
 *   sitemap.xml   — карта сайта
 *   robots.txt    — правила обхода
 *
 *   node tools/build.mjs           пересобрать
 *   node tools/build.mjs --check   проверить, что всё собрано (для CI)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const F = {
  site: resolve(ROOT, "site.json"),
  releases: resolve(ROOT, "releases.json"),
  faq: resolve(ROOT, "faq.json"),
  page: resolve(ROOT, "index.html"),
  privacy: resolve(ROOT, "privacy.html"),
  feed: resolve(ROOT, "feed.xml"),
  sitemap: resolve(ROOT, "sitemap.xml"),
  robots: resolve(ROOT, "robots.txt"),
};

const KIND_TITLES = { add: "Новое", fix: "Исправлено", change: "Изменения" };
const KIND_ORDER = ["add", "fix", "change"];

/** Домены, ссылки на которые допустимы в статике помимо baseUrl */
const ALLOWED_HOSTS = new Set([
  "t.me",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "yoomoney.ru",
  "docs.google.com",
  "schema.org",
  "www.w3.org",
]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const checkOnly = process.argv.includes("--check");

// ---------------------------------------------------------------- утилиты ---

// BOM не должен ломать разбор: редакторы на Windows его иногда добавляют
const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** '2026-10-03' -> '03.10.2026' */
function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) throw new Error(`Некорректная дата: ${iso}`);
  return `${d}.${m}.${y}`;
}

/** '2026-10-03' -> 'Sat, 03 Oct 2026 00:00:00 +0300' */
function formatRfc822(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAYS[date.getUTCDay()];
  return `${weekday}, ${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y} 00:00:00 +0300`;
}

/** '0.7a' -> { base: [0, 7], suffix: 'a' } */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)([a-z]*)$/i.exec(version);
  if (!match) throw new Error(`Некорректная версия: ${version}`);
  return { base: [Number(match[1]), Number(match[2])], suffix: match[3].toLowerCase() };
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.base[0] !== vb.base[0]) return vb.base[0] - va.base[0];
  if (va.base[1] !== vb.base[1]) return vb.base[1] - va.base[1];
  return vb.suffix.localeCompare(va.suffix);
}

function pluralReleases(n) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "обновлений";
  if (mod10 === 1) return "обновление";
  if (mod10 >= 2 && mod10 <= 4) return "обновления";
  return "обновлений";
}

const anchorId = (version) => `v${version.replaceAll(".", "-")}`;
const orderedGroups = (groups) =>
  [...groups].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const applyEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));

// ------------------------------------------------------------ генераторы ---

function renderGroups(groups) {
  return orderedGroups(groups)
    .map((group) => {
      const title = KIND_TITLES[group.kind];
      if (!title) throw new Error(`Неизвестный тип изменений: ${group.kind}`);
      const items = group.items
        .map((item) => `                  <li>${escapeHtml(item)}</li>`)
        .join("\n");
      return [
        `              <div class="release-group release-group-${group.kind}">`,
        `                <h4 class="group-title">${title}</h4>`,
        `                <ul class="release-list">`,
        items,
        `                </ul>`,
        `              </div>`,
      ].join("\n");
    })
    .join("\n");
}

function renderRelease(release, isLatest) {
  const id = anchorId(release.version);
  const verClass = isLatest ? "ver latest" : "ver";
  const tagRow = isLatest ? `\n              <span class="tag">Последнее</span>` : "";

  return [
    `        <li class="timeline-item" id="${id}">`,
    `          <div class="timeline-dot" aria-hidden="true"></div>`,
    `          <article class="timeline-card">`,
    `            <div class="timeline-top">`,
    `              <h3 class="release-heading">`,
    `                <a class="${verClass}" href="#${id}" title="Ссылка на это обновление">v${escapeHtml(release.version)}</a>`,
    `              </h3>`,
    `              <time class="date" datetime="${release.date}">${formatDate(release.date)}</time>${tagRow}`,
    `            </div>`,
    `            <p class="release-title">${escapeHtml(release.title)}</p>`,
    `            <div class="release-groups">`,
    renderGroups(release.groups),
    `            </div>`,
    `          </article>`,
    `        </li>`,
  ].join("\n");
}

function renderLatest(release) {
  const id = anchorId(release.version);
  return [
    `        <a class="latest" href="#${id}">`,
    `          <span class="latest-label">Последнее обновление</span>`,
    `          <span class="latest-title"><b>v${escapeHtml(release.version)}</b> — ${escapeHtml(release.title)}</span>`,
    `          <time class="latest-date" datetime="${release.date}">${formatDate(release.date)}</time>`,
    `        </a>`,
  ].join("\n");
}

function renderVersionIndex(releases) {
  const chips = releases
    .map((r) => `            <a class="chip" href="#${anchorId(r.version)}">v${escapeHtml(r.version)}</a>`)
    .join("\n");
  return [
    `          <nav class="version-index" aria-label="Перейти к версии">`,
    chips,
    `          </nav>`,
  ].join("\n");
}

function renderFaq(questions) {
  return questions
    .map((item) =>
      [
        `        <details class="faq-item">`,
        `          <summary>${escapeHtml(item.q)}</summary>`,
        `          <p>${escapeHtml(item.a)}</p>`,
        `        </details>`,
      ].join("\n"),
    )
    .join("\n");
}

function renderJsonLd(site, questions) {
  const graph = [
    {
      "@type": "SoftwareApplication",
      name: "@debts_newbot",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Telegram",
      inLanguage: "ru",
      url: site.baseUrl,
      description:
        "Telegram-бот для учёта долгов: частичное погашение, сроки возврата, напоминания и статистика.",
      sameAs: ["https://t.me/debts_newbot"],
      offers: { "@type": "Offer", price: "0", priceCurrency: "RUB" },
    },
    {
      "@type": "FAQPage",
      mainEntity: questions.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)
    .replaceAll("</", "<\\/");

  return [
    `  <script type="application/ld+json">`,
    ...json.split("\n").map((line) => `  ${line}`),
    `  </script>`,
  ].join("\n");
}

function buildFeed(site, releases) {
  const latestDate = releases[0].date;
  const items = releases
    .map((release) => {
      const id = anchorId(release.version);
      const url = `${site.baseUrl}#${id}`;
      const description = orderedGroups(release.groups)
        .map((group) => `${KIND_TITLES[group.kind]}: ${group.items.join(" ")}`)
        .join(" ");
      return [
        `    <item>`,
        `      <title>v${escapeXml(release.version)} — ${escapeXml(release.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${formatRfc822(release.date)}</pubDate>`,
        `      <description>${escapeXml(description)}</description>`,
        `    </item>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    `    <title>Обновления бота @debts_newbot</title>`,
    `    <link>${escapeXml(site.baseUrl)}</link>`,
    `    <description>Что нового в Telegram-боте @debts_newbot: учёт долгов, напоминания, статистика.</description>`,
    `    <language>ru</language>`,
    `    <lastBuildDate>${formatRfc822(latestDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(site.baseUrl)}feed.xml" rel="self" type="application/rss+xml" />`,
    items,
    `  </channel>`,
    `</rss>`,
    ``,
  ].join("\n");
}

function buildSitemap(site, latestDate) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url>`,
    `    <loc>${escapeXml(site.baseUrl)}</loc>`,
    `    <lastmod>${latestDate}</lastmod>`,
    `    <changefreq>weekly</changefreq>`,
    `    <priority>1.0</priority>`,
    `  </url>`,
    `  <url>`,
    `    <loc>${escapeXml(site.baseUrl)}privacy.html</loc>`,
    `    <lastmod>${latestDate}</lastmod>`,
    `    <changefreq>yearly</changefreq>`,
    `    <priority>0.3</priority>`,
    `  </url>`,
    `</urlset>`,
    ``,
  ].join("\n");
}

function buildRobots(site) {
  return [
    `User-agent: *`,
    `Allow: /`,
    ``,
    `# Служебные файлы сборки`,
    `Disallow: /tools/`,
    `Disallow: /releases.json`,
    `Disallow: /faq.json`,
    `Disallow: /site.json`,
    ``,
    `Sitemap: ${site.baseUrl}sitemap.xml`,
    ``,
  ].join("\n");
}

// ------------------------------------------------------- подстановка в HTML ---

function replaceBetween(source, name, replacement, label) {
  const pattern = new RegExp(
    `(<!-- build:${name}:start -->)[\\s\\S]*?(<!-- build:${name}:end -->)`,
  );
  if (!pattern.test(source)) {
    throw new Error(`В ${label} не найден маркер build:${name}`);
  }
  return source.replace(pattern, `$1${replacement}$2`);
}

function fill(source, name, block, indent, label) {
  return replaceBetween(source, name, `\n${block}\n${indent}`, label);
}

/**
 * Страховка от рассинхрона: все абсолютные ссылки в статике должны вести либо
 * на site.baseUrl, либо на домены из ALLOWED_HOSTS.
 */
function checkUrls(source, site, label) {
  const urls = source.match(/https?:\/\/[^\s"'<>()]+/g) ?? [];
  const unexpected = new Set();

  for (const url of urls) {
    if (url.startsWith(site.baseUrl)) continue;
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      unexpected.add(url);
      continue;
    }
    if (!ALLOWED_HOSTS.has(host)) unexpected.add(url);
  }

  if (unexpected.size > 0) {
    throw new Error(
      `${label}: адреса не совпадают с site.json (baseUrl = ${site.baseUrl}):\n` +
        [...unexpected].map((u) => `  ${u}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------- сборка ---

function build() {
  const site = readJson(F.site);
  if (!site.baseUrl || !site.baseUrl.endsWith("/")) {
    throw new Error("site.json: baseUrl должен заканчиваться на «/»");
  }

  const releases = [...readJson(F.releases).releases].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return compareVersions(a.version, b.version);
  });
  if (releases.length === 0) throw new Error("releases.json не содержит ни одного релиза");

  const questions = readJson(F.faq).questions;
  if (questions.length === 0) throw new Error("faq.json не содержит ни одного вопроса");

  const latestDate = releases.reduce((acc, r) => (r.date > acc ? r.date : acc), releases[0].date);
  const count = `${releases.length} ${pluralReleases(releases.length)}`;

  // --- index.html ---
  // Работаем с LF, а переводы строк файла восстанавливаются в конце — иначе на
  // файле с CRLF получалось бы \r\r\n
  const L = "index.html";
  let html = readFileSync(F.page, "utf8").replaceAll("\r\n", "\n");

  html = fill(html, "latest", renderLatest(releases[0]), "        ", L);
  html = fill(html, "index", renderVersionIndex(releases), "          ", L);
  html = replaceBetween(html, "count", count, L);
  html = fill(html, "releases", releases.map((r, i) => renderRelease(r, i === 0)).join("\n"), "        ", L);
  html = fill(html, "faq", renderFaq(questions), "        ", L);
  html = fill(html, "jsonld", renderJsonLd(site, questions), "  ", L);
  html = replaceBetween(
    html,
    "updated",
    `<time id="last-updated" datetime="${latestDate}">${formatDate(latestDate)}</time>`,
    L,
  );
  checkUrls(html, site, L);

  // --- privacy.html ---
  const privacyRaw = readFileSync(F.privacy, "utf8");
  checkUrls(privacyRaw, site, "privacy.html");

  const outputs = [
    { file: F.page, label: L, content: html },
    { file: F.feed, label: "feed.xml", content: buildFeed(site, releases) },
    { file: F.sitemap, label: "sitemap.xml", content: buildSitemap(site, latestDate) },
    { file: F.robots, label: "robots.txt", content: buildRobots(site) },
  ];

  const stale = [];
  for (const output of outputs) {
    const current = existsSync(output.file) ? readFileSync(output.file, "utf8") : null;
    const desired = applyEol(output.content, current ? eolOf(current) : "\n");
    if (current !== desired) {
      stale.push(output.label);
      if (!checkOnly) writeFileSync(output.file, desired, "utf8");
    }
  }

  const summary = `${releases.length} релизов (${count}), актуальный — v${releases[0].version} от ${formatDate(latestDate)}`;

  if (stale.length === 0) {
    console.log(`Всё собрано: ${summary}`);
    return true;
  }

  if (checkOnly) {
    console.error(
      `Не собрано из исходных данных: ${stale.join(", ")}.\n` + "Запустите: node tools/build.mjs",
    );
    return false;
  }

  console.log(`Обновлено: ${stale.join(", ")} — ${summary}`);
  return true;
}

process.exit(build() ? 0 : 1);
