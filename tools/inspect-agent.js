const fs = require('fs');
const path = require('path');

const home = process.env.USERPROFILE || process.env.HOME;
const claudeDir = path.join(home, '.claude', 'projects');

function findSession(dir, sid) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findSession(full, sid);
      if (found) return found;
    } else if (e.name.includes(sid)) {
      return full;
    }
  }
  return null;
}

const target = process.argv[2] || '3d-fluid';
const filePath = findSession(claudeDir, target);
if (!filePath) {
  console.log('Not found for target:', target);
  process.exit(1);
}

console.log('File:', filePath);
const st = fs.statSync(filePath);
const readSize = Math.min(st.size, 4 * 1024 * 1024);
const fd = fs.openSync(filePath, 'r');
const buf = Buffer.alloc(readSize);
fs.readSync(fd, buf, 0, readSize, st.size - readSize);
fs.closeSync(fd);

const text = buf.toString('utf8');
const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

const msgs = [];
for (let i = rawLines.length - 1; i >= 0; i--) {
  try {
    const o = JSON.parse(rawLines[i]);
    if (o.type === 'assistant' || o.type === 'user') {
      msgs.unshift(o);
      if (msgs.length >= 6) break;
    }
  } catch (e) {}
}

msgs.forEach(o => {
  console.log('=== ' + o.type.toUpperCase() + ' (stop: ' + (o.message?.stop_reason || 'none') + ') ===');
  if (o.message && o.message.content) {
    if (typeof o.message.content === 'string') {
      console.log('  ' + o.message.content.slice(0, 200));
    } else if (Array.isArray(o.message.content)) {
      o.message.content.forEach(c => {
        if (c.type === 'tool_use') console.log('  TOOL_USE: ' + c.name + ' -> ' + JSON.stringify(c.input).slice(0, 150));
        else if (c.type === 'tool_result') console.log('  TOOL_RES: ' + (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 150));
        else if (c.type === 'text') console.log('  TEXT: ' + c.text.slice(0, 200));
      });
    }
  }
});

const lastAsst = msgs.slice().reverse().find(o => o.type === 'assistant');
if (lastAsst && lastAsst.message?.content) {
  console.log('\n--- LATEST ASSISTANT DETAIL ---');
  lastAsst.message.content.forEach(c => {
    if (c.type === 'text') console.log('FULL TEXT:\n' + c.text);
    if (c.type === 'tool_use') console.log('CALLING TOOL:\n' + c.name + ': ' + JSON.stringify(c.input));
  });
}

