/**
 * A small Markdown subset, rendered without dependencies.
 *
 * The security property is the ordering: the whole source is escaped ONCE, up front,
 * before a single rule runs. After that step the text physically cannot contain
 * < > & " ', so no rule can emit a tag the author wrote — every tag in the output is
 * produced here. This is the only module whose output may skip escapeHtml().
 *
 * Supported: headings, **bold**, *italic*, `code`, ``` fences ```, - and 1. lists,
 * [links](url), > quotes, --- rules, paragraphs, single newline as <br>.
 * Images are deliberately absent: pictures come from the upload fields, and
 * ![](…) would pull a third-party URL into a page served with img-src 'self'.
 */
import { escapeHtml } from './http.ts';

/** Anchored, and applied to the already-escaped text: javascript: and data: cannot pass. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)[^\s"]*$/;

const MARK = '\u0000';

type Stash = { html: string[] };

export function renderMarkdown(source: string): string {
  const normalised = String(source ?? '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll(MARK, '');
  if (!normalised.trim()) return '';

  // 1. Escape everything, once.
  let text = escapeHtml(normalised);

  // 2. Lift fenced code out of the way; its contents stay verbatim.
  const stash: Stash = { html: [] };
  text = text.replace(/```[A-Za-z0-9_-]*\n([\s\S]*?)```/g, (_match, body: string) => {
    return placeholder(stash, `<pre><code>${body.replace(/\n$/, '')}</code></pre>`);
  });

  // 3. Walk the lines.
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join('\n'), stash)}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item, stash)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${inline(quote.join('\n'), stash)}</blockquote>`);
    quote = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flushAll();
      continue;
    }

    // A stashed code block sits alone on its line.
    if (/^\u0000\d+\u0000$/.test(trimmed)) {
      flushAll();
      out.push(trimmed);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length + 1, 6); // h1 belongs to the page, not the text
      out.push(`<h${level}>${inline(heading[2], stash)}</h${level}>`);
      continue;
    }

    const quoted = /^&gt;\s?(.*)$/.exec(trimmed);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // A plain line continues whatever block is open.
    if (list) list.items[list.items.length - 1] += `\n${trimmed}`;
    else if (quote.length) quote.push(trimmed);
    else paragraph.push(trimmed);
  }
  flushAll();

  // 4. Put the code blocks back.
  return restore(out.join('\n'), stash);
}

function placeholder(stash: Stash, html: string): string {
  stash.html.push(html);
  return `${MARK}${stash.html.length - 1}${MARK}`;
}

/** Placeholders can nest — `code` inside a [link](…) — so expand until none are left. */
function restore(text: string, stash: Stash): string {
  let out = text;
  for (let pass = 0; pass < 5 && out.includes(MARK); pass += 1) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => stash.html[Number(index)] ?? '');
  }
  return out.replaceAll(MARK, '');
}

/** Inline rules, in the order that keeps them from eating each other. */
function inline(text: string, stash: Stash): string {
  let out = text;

  // Inline code first: nothing inside it should be interpreted.
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => placeholder(stash, `<code>${code}</code>`));

  out = out.replace(/\[([^\]\n]+)]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (!SAFE_URL.test(href)) return match; // rendered as plain text
    const external = /^https?:\/\//.test(href);
    const attrs = external ? ' target="_blank" rel="nofollow noopener"' : '';
    return placeholder(stash, `<a href="${href}"${attrs}>${label}</a>`);
  });

  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

  return out.replaceAll('\n', '<br>');
}

/**
 * Markdown source of the first block, up to the first blank line. A fenced code block
 * may contain blank lines of its own, so a block with an unclosed fence runs on to its end.
 */
export function firstParagraph(source: string): string {
  const blocks = String(source ?? '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .trim()
    .split(/\n[ \t]*\n/);
  let out = '';
  for (const block of blocks) {
    out = out ? `${out}\n\n${block}` : block;
    if ((out.match(/```/g) ?? []).length % 2 === 0) break;
  }
  return out;
}

/**
 * Plain-text opening of a description: markers stripped, cut on a word boundary.
 * Returns raw text — the caller escapes it like any other value.
 */
export function markdownExcerpt(source: string, limit = 220): string {
  const plain = String(source ?? '')
    .replaceAll('\r', '')
    .replaceAll(MARK, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    // The URL may carry balanced parens of its own: [x](javascript:alert(1))
    .replace(/\[([^\]]+)]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > limit * 0.6 ? space : limit).trimEnd()}…`;
}
