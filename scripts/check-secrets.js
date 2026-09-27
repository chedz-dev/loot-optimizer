import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sensitiveKeys = ['WARCRAFTLOGS_CLIENT_ID', 'WARCRAFTLOGS_CLIENT_SECRET'];

// Lee las credenciales locales para detectar copias en archivos publicables.
const secrets = ['.env', '.env.local'].flatMap((filename) => {
  const fullPath = path.join(root, filename);

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const env = parse(fs.readFileSync(fullPath));
  return sensitiveKeys.map((key) => env[key]).filter(Boolean);
});
const failures = new Set();
const containsSecret = (data) => secrets.some((secret) => data.includes(Buffer.from(secret)));
const example = parse(fs.readFileSync(path.join(root, '.env.example')));

if (sensitiveKeys.some((key) => example[key])) {
  failures.add('.env.example must contain empty credential placeholders');
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

for (const filename of files) {
  if (/^\.env(?:\.local)?$/.test(filename)) {
    failures.add(`Private environment tracked: ${filename}`);
  }

  const fullPath = path.join(root, filename);

  if (fs.existsSync(fullPath) && containsSecret(fs.readFileSync(fullPath))) {
    failures.add(`Credential in tracked file: ${filename}`);
  }
}

const staged = execFileSync('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

if (containsSecret(staged)) {
  failures.add('Staged changes contain a local credential');
}

// Revisa también las salidas generadas, aunque no estén versionadas.
for (const directory of ['dist', 'public', '.ci/release']) {
  const inspect = (folder) => {
    if (!fs.existsSync(folder)) {
      return;
    }

    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        inspect(fullPath);
      } else if (entry.isFile() && containsSecret(fs.readFileSync(fullPath))) {
        failures.add(`Credential in web asset: ${path.relative(root, fullPath)}`);
      }
    }
  };

  inspect(path.join(root, directory));
}

if (failures.size) {
  console.error([...failures].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Secret check passed: template, tracked files, staged changes and web assets.');
}
