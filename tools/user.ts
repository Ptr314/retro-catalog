/**
 * Admin accounts.
 *   node --disable-warning=ExperimentalWarning tools/user.ts add <login> [имя]
 *   node --disable-warning=ExperimentalWarning tools/user.ts passwd <login>
 *   node --disable-warning=ExperimentalWarning tools/user.ts list
 *
 * The password is asked interactively (not echoed), read from a pipe (two lines:
 * password, then the same again) or taken from $PASSWORD.
 */
import { hashPassword } from '../auth.ts';
import { countUsers, createUser, getUserByName, listUsers, setPasswordHash } from '../db.ts';

/** Piped input (scripts): every prompt takes the next line. Read once, hand out in order. */
let pipedLines: Promise<string[]> | null = null;
function nextPipedLine(): Promise<string> {
  pipedLines ??= new Promise((resolve) => {
    let all = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (all += chunk));
    process.stdin.on('end', () => resolve(all.split(/\r?\n/)));
  });
  return pipedLines.then((lines) => lines.shift() ?? '');
}

/**
 * Asks for a password without echoing it. Raw mode, not readline: readline in terminal
 * mode redraws the line on question() and wipes a prompt written before it — the tool
 * then looked frozen — and silencing its echo means patching a private field.
 */
function askPassword(prompt: string): Promise<string> {
  if (process.env.PASSWORD) return Promise.resolve(process.env.PASSWORD);
  const stdin = process.stdin;
  process.stdout.write(prompt);
  if (!stdin.isTTY) return nextPipedLine();

  return new Promise((resolve) => {
    let value = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      if (chunk.startsWith('\u001b')) return; // arrows and other escape sequences
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          // Ctrl+C: raw mode swallows the signal, so honour it by hand
          finish();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

const [command, login, displayName] = process.argv.slice(2);

if (command === 'list') {
  for (const user of listUsers()) {
    console.log(`${user.username}\t${user.display_name || '—'}\t${user.created_at}`);
  }
  process.exit(0);
}

if (!command || !login || (command !== 'add' && command !== 'passwd')) {
  console.log('usage: user.ts add|passwd <login> [имя]   |   user.ts list');
  process.exit(1);
}

const password = await askPassword('Пароль: ');
if (password.length < 8) {
  console.error('Пароль короче 8 символов.');
  process.exit(1);
}
const repeat = await askPassword('Ещё раз: ');
if (password !== repeat) {
  console.error('Пароли не совпадают.');
  process.exit(1);
}

const existing = getUserByName(login);
if (command === 'add') {
  if (existing) {
    console.error(`Пользователь ${login} уже есть. Смените пароль: user.ts passwd ${login}`);
    process.exit(1);
  }
  createUser(login, hashPassword(password), displayName ?? '');
  console.log(`Создан пользователь ${login}. Всего: ${countUsers()}.`);
} else {
  if (!existing) {
    console.error(`Пользователя ${login} нет.`);
    process.exit(1);
  }
  setPasswordHash(existing.id, hashPassword(password));
  console.log(`Пароль для ${login} изменён.`);
}
process.exit(0);
