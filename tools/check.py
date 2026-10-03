#!/usr/bin/env python
"""Проверка статики сайта: разметка, ссылки, якоря и согласованность с CSS.

Ловит то, что не видно глазом: классы в HTML без правил в стилях, забытые
токены тёмной темы, битую вложенность тегов, якоря в никуда.

Запуск:  python tools/check.py
"""

import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("index.html", "privacy.html")
CSS_FILE = ROOT / "assets" / "site.css"

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
# Внутри этих тегов не может быть блочных элементов
PHRASING = {"span", "strong", "small", "b", "i", "em", "a", "time", "code", "u"}
BLOCK = {"p", "div", "ul", "ol", "li", "section", "article", "header", "footer",
         "nav", "main", "h1", "h2", "h3", "h4", "h5", "h6", "details", "table", "form"}
# Классы, которые появляются только во время работы скриптов
JS_ONLY_CLASSES = {"js"}

problems: list[str] = []
warnings: list[str] = []
used_classes: set[str] = set()


class Markup(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.ids: Counter[str] = Counter()
        self.refs: list[tuple[str, str, int]] = []
        self.anchors: list[tuple[str, int]] = []
        self.tags: Counter[str] = Counter()
        self.page = ""

    def handle_starttag(self, tag, attrs):
        line = self.getpos()[0]
        attrs = dict(attrs)
        self.tags[tag] += 1

        if "id" in attrs:
            self.ids[attrs["id"]] += 1
        for name in (attrs.get("class") or "").split():
            used_classes.add(name)

        for key in ("href", "src"):
            if attrs.get(key):
                self.refs.append((key, attrs[key], line))
        if attrs.get("property") in {"og:image", "og:url"} or attrs.get("name") == "twitter:image":
            self.refs.append(("content", attrs.get("content", ""), line))
        if tag == "a" and attrs.get("href", "").startswith("#"):
            self.anchors.append((attrs["href"][1:], line))

        if tag in BLOCK:
            for open_tag, open_line in self.stack:
                if open_tag in PHRASING:
                    problems.append(
                        f"{self.page}, строка {line}: <{tag}> внутри строчного "
                        f"<{open_tag}> (открыт на строке {open_line})"
                    )
                    break
        if tag not in VOID:
            self.stack.append((tag, line))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            problems.append(f"{self.page}, строка {self.getpos()[0]}: лишний </{tag}>")
            return
        open_tag, open_line = self.stack.pop()
        if open_tag != tag:
            problems.append(
                f"{self.page}, строка {self.getpos()[0]}: </{tag}> закрывает <{open_tag}>, "
                f"открытый на строке {open_line}"
            )


def check_page(name: str) -> str:
    html = (ROOT / name).read_text(encoding="utf-8")
    parser = Markup()
    parser.page = name
    parser.feed(html)

    for tag, line in parser.stack:
        problems.append(f"{name}: не закрыт <{tag}> (строка {line})")
    for id_, count in parser.ids.items():
        if count > 1:
            problems.append(f'{name}: дублирующийся id="{id_}" ({count} раза)')
    for anchor, line in parser.anchors:
        if anchor and anchor not in parser.ids:
            problems.append(f"{name}, строка {line}: якорь #{anchor} никуда не ведёт")
    for _, value, line in parser.refs:
        if value.startswith(("http://", "https://", "mailto:", "tel:", "#", "data:")):
            continue
        if not (ROOT / value.lstrip("/")).exists():
            problems.append(f"{name}, строка {line}: не найден файл {value}")
    if "<style>" in html:
        problems.append(f"{name}: остался инлайн <style>")

    print(f"{name}: h1={parser.tags['h1']} h2={parser.tags['h2']} h3={parser.tags['h3']} "
          f"ссылок={len(parser.refs)} id={len(parser.ids)}")
    return html


def check_css() -> None:
    raw = CSS_FILE.read_text(encoding="utf-8")
    css = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)  # без комментариев

    if css.count("{") != css.count("}"):
        problems.append("site.css: несбалансированные фигурные скобки")

    defined = set(re.findall(r"(--[a-z0-9-]+)\s*:", css))
    used = set(re.findall(r"var\((--[a-z0-9-]+)", css))
    for var in sorted(used - defined):
        problems.append(f"site.css: не определена переменная {var}")
    for var in sorted(defined - used):
        warnings.append(f"site.css: {var} определена, но не используется")

    css_classes = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
    for name in sorted(used_classes - css_classes):
        problems.append(f"в HTML есть класс .{name}, но правил для него нет в site.css")
    for name in sorted(css_classes - used_classes - JS_ONLY_CLASSES):
        warnings.append(f"site.css: класс .{name} не используется в разметке")

    # Токены тёмной темы заданы дважды: для системной настройки и для явного
    # выбора. Списки должны совпадать, иначе темы разъедутся.
    media = re.search(
        r'@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{(.*?)\n  \}',
        css, re.S)
    attr = re.search(r':root\[data-theme="dark"\] \{(.*?)\n\}', css, re.S)
    if not media or not attr:
        problems.append("site.css: не найдены блоки тёмной темы")
    else:
        media_tokens = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", media.group(1)))
        attr_tokens = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", attr.group(1)))
        only_media = set(media_tokens) - set(attr_tokens)
        only_attr = set(attr_tokens) - set(media_tokens)
        if only_media or only_attr:
            problems.append(
                "site.css: списки токенов тёмной темы различаются — "
                f"только в медиазапросе: {sorted(only_media) or '—'}, "
                f"только в явном выборе: {sorted(only_attr) or '—'}"
            )
        diff = {k for k in media_tokens if k in attr_tokens and media_tokens[k] != attr_tokens[k]}
        if diff:
            problems.append(f"site.css: значения токенов тёмной темы различаются: {sorted(diff)}")
        print(f"site.css: классов={len(css_classes)} переменных={len(defined)} "
              f"токенов тёмной темы={len(media_tokens)}")

    if ":root.js .theme-toggle" not in css:
        problems.append("site.css: кнопка темы не скрыта при выключенном JavaScript")


def check_scripts() -> None:
    theme = ROOT / "assets" / "theme.js"
    if not theme.exists():
        problems.append("не найден assets/theme.js")
        return
    source = theme.read_text(encoding="utf-8")
    normalized = " ".join(source.split())
    for fragment in ('MODES = [null, "light", "dark"]', "localStorage.setItem", "DOMContentLoaded"):
        if fragment not in normalized:
            problems.append(f"theme.js: не найдено «{fragment}» — проверьте логику переключения")


def main() -> int:
    for page in PAGES:
        check_page(page)
    check_css()
    check_scripts()

    print()
    if warnings:
        print("ПРЕДУПРЕЖДЕНИЯ:")
        for text in warnings:
            print("  -", text)
        print()
    if problems:
        print(f"ПРОБЛЕМЫ ({len(problems)}):")
        for text in problems:
            print("  -", text)
        return 1
    print("Разметка, ссылки и стили — без замечаний.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
