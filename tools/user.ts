/**
 * Admin accounts.
 *   node --disable-warning=ExperimentalWarning tools/user.ts add <login>
 *   node --disable-warning=ExperimentalWarning tools/user.ts passwd <login>
 *   node --disable-warning=ExperimentalWarning tools/user.ts list
 *
 * The password is asked interactively (not echoed) or taken from $PASSWORD.
 */
import { createInterface } from 'node:readline';
import { hashPassword } from '../auth.ts';
import { countUsers, createUser, getUserByName, listUsers, setPasswordHash } from '../db.ts';

function askPassword(prompt: string): Promise<string> {
  if (process.env.PASSWORD) return Promise.resolve(process.env.PASSWORD);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    // readline echoes every keystroke through _writeToOutput; silence it while the password is typed.
    const muted = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = muted._writeToOutput;
    muted._writeToOutput = () => {};
    rl.question('', (answer) => {
      muted._writeToOutput = original;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
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
