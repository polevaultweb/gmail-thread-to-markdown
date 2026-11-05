const statusEl = document.getElementById('status');
const stripEl = document.getElementById('strip');
const buttons = [...document.querySelectorAll('button')];

stripEl.checked = localStorage.getItem('stripQuotes') !== 'false';
stripEl.addEventListener('change', () => localStorage.setItem('stripQuotes', stripEl.checked));

document.getElementById('copy').addEventListener('click', () => run('copy'));
document.getElementById('download').addEventListener('click', () => run('download'));

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : '';
}

async function run(mode) {
  buttons.forEach(b => (b.disabled = true));
  setStatus('Reading thread…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://mail.google.com/')) {
      throw new Error('Open a Gmail thread first.');
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractThread,
      args: [{ stripQuotes: stripEl.checked }],
    });
    if (!result || result.error) throw new Error(result?.error || 'Nothing extracted.');

    if (mode === 'copy') {
      await navigator.clipboard.writeText(result.markdown);
      setStatus(`Copied ${result.count} message${result.count === 1 ? '' : 's'}.`);
    } else {
      const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: result.filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus(`Downloaded ${result.filename}`);
    }
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    buttons.forEach(b => (b.disabled = false));
  }
}

// Runs inside the Gmail tab. Must be self-contained: no references to outer scope.
async function extractThread({ stripQuotes }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const main = document.querySelector('div[role="main"]') || document.body;
  const subjectEl = main.querySelector('h2.hP');
  if (!subjectEl) return { error: 'No open thread found. Open a conversation first.' };
  const subject = subjectEl.textContent.trim();

  // 1. Expand every message so bodies are in the DOM.
  const press = el => {
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  };
  const expandAll = document.querySelector('[aria-label="Expand all"], [data-tooltip="Expand all"]');
  if (expandAll) press(expandAll);
  else main.querySelectorAll('.h7 .kv, .adx').forEach(press); // non-English UI fallback

  const allExpanded = () =>
    [...main.querySelectorAll('div.adn')].every(m => m.querySelector('.a3s')) &&
    !main.querySelector('.h7 .kv');
  for (let i = 0; i < 25 && !allExpanded(); i++) await sleep(200);

  // 2. HTML -> Markdown. \u0001 marks indentation that must survive whitespace tidying.
  const IND = '\u0001';
  const emph = (mark, s) => {
    if (!s.trim()) return s;
    const [, a, b, c] = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return a + mark + b + mark + c;
  };
  const kids = (node, ctx) => [...node.childNodes].map(c => conv(c, ctx)).join('');
  const list = (node, ctx, ordered) => {
    let n = 1;
    const items = [...node.children].filter(c => c.tagName === 'LI').map(li => {
      const marker = ordered ? `${n++}. ` : '- ';
      const inner = kids(li, ctx).replace(/\n{2,}/g, '\n').trim();
      return marker + inner.split('\n').join('\n' + IND.repeat(marker.length));
    });
    return '\n\n' + items.join('\n') + '\n\n';
  };
  function conv(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue.replace(/\u00A0/g, ' ');
      return ctx.pre ? t.replace(/ /g, IND) : t.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    if (['STYLE', 'SCRIPT', 'HEAD', 'META', 'TITLE'].includes(tag)) return '';
    if (node.style?.display === 'none') return '';
    switch (tag) {
      case 'BR': return '\n';
      case 'HR': return '\n\n';
      case 'P': return '\n\n' + kids(node, ctx) + '\n\n';
      case 'B': case 'STRONG': return emph('**', kids(node, ctx));
      case 'I': case 'EM': return emph('_', kids(node, ctx));
      case 'S': case 'STRIKE': case 'DEL': return emph('~~', kids(node, ctx));
      case 'CODE': return ctx.pre ? kids(node, ctx) : '`' + kids(node, ctx) + '`';
      case 'PRE': return '\n\n```\n' + kids(node, { ...ctx, pre: true }) + '\n```\n\n';
      case 'UL': return list(node, ctx, false);
      case 'OL': return list(node, ctx, true);
      case 'BLOCKQUOTE': {
        const inner = kids(node, ctx).replace(/\n{3,}/g, '\n\n').trim();
        return '\n\n' + inner.split('\n').map(l => '> ' + l.trim()).join('\n') + '\n\n';
      }
      case 'A': {
        const href = node.getAttribute('href') || '';
        const text = kids(node, ctx).trim();
        if (!text) return '';
        if (!href || href.startsWith('#') || href.replace(/^mailto:/, '') === text) return text;
        if (text === href) return `<${href}>`;
        return `[${text}](${href})`;
      }
      case 'IMG': {
        const alt = (node.getAttribute('alt') || '').trim();
        return alt ? `[image: ${alt}]` : '';
      }
      case 'TD': case 'TH': return kids(node, ctx) + ' ';
      case 'TR': return '\n' + kids(node, ctx) + '\n';
      default: {
        const h = tag.match(/^H([1-6])$/);
        if (h) return '\n\n' + '#'.repeat(Math.min(6, +h[1] + 2)) + ' ' + kids(node, ctx).trim() + '\n\n';
        const block = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'CENTER', 'ADDRESS'].includes(tag);
        return block ? '\n' + kids(node, ctx) + '\n' : kids(node, ctx);
      }
    }
  }
  const tidy = s =>
    s.replace(/^[ \t]+|[ \t]+$/gm, '')
      .replace(new RegExp(IND, 'g'), ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // 3. Walk the messages.
  const person = el => {
    const name = el.getAttribute('name') || el.textContent.trim();
    const email = el.getAttribute('email');
    return email && email !== name ? `${name} <${email}>` : name;
  };
  const messages = [...main.querySelectorAll('div.adn')];
  if (!messages.length) return { error: 'Could not find any messages in this thread.' };

  const parts = messages.map((m, i) => {
    const fromEl = m.querySelector('.gD');
    const from = fromEl ? person(fromEl) : 'Unknown sender';
    const fromName = fromEl?.getAttribute('name') || from;
    const dateEl = m.querySelector('.g3');
    const date = dateEl?.getAttribute('title') || dateEl?.textContent.trim() || '';
    const to = [...new Set([...m.querySelectorAll('.hb .g2')].map(person))];
    const attachments = [...new Set([...m.querySelectorAll('.aV3')].map(a => a.textContent.trim()))];

    let body = '';
    const bodyEl = m.querySelector('.ii.gt .a3s') || m.querySelector('.a3s');
    if (bodyEl) {
      const clone = bodyEl.cloneNode(true);
      if (stripQuotes) {
        clone.querySelectorAll(
          '.gmail_quote, .gmail_extra, blockquote[type="cite"], .moz-cite-prefix, .yj6qo, .adL'
        ).forEach(el => el.remove());
        // Outlook-style replies: drop the "From: ... Sent: ..." block and everything after it.
        const ol = clone.querySelector('#divRplyFwdMsg, #appendonsend');
        if (ol) {
          let n = ol;
          while (n && n !== clone) {
            while (n.nextSibling) n.nextSibling.remove();
            n = n.parentNode;
          }
          ol.remove();
        }
      }
      body = tidy(conv(clone, {}));
    }

    const meta = [`- **From:** ${from}`];
    if (to.length) meta.push(`- **To:** ${to.join(', ')}`);
    if (date) meta.push(`- **Date:** ${date}`);
    if (attachments.length) meta.push(`- **Attachments:** ${attachments.join(', ')}`);
    return `## ${i + 1}. ${fromName}${date ? `, ${date}` : ''}\n\n${meta.join('\n')}\n\n${body || '_(no body)_'}`;
  });

  const markdown = `# ${subject}\n\n${parts.join('\n\n')}\n`;
  const today = new Date().toISOString().slice(0, 10);
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'gmail-thread';
  return { markdown, filename: `${today}-${slug}.md`, count: messages.length };
}
