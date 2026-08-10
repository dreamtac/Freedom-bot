import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

const sourcePath = resolve(".data", "freedom-bot.sqlite");
const backupDirectory = resolve(".data", "backups");
const retentionDays = 30;

if (!existsSync(sourcePath)) {
  console.error(`백업할 SQLite 파일이 없습니다: ${sourcePath}`);
  process.exitCode = 1;
} else {
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const destinationPath = resolve(backupDirectory, `freedom-bot-${timestamp}.sqlite`);
  const database = new Database(sourcePath, { readonly: true });
  try {
    await database.backup(destinationPath);
  } finally {
    database.close();
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const fileName of await readdir(backupDirectory)) {
    if (!/^freedom-bot-.*\.sqlite$/.test(fileName)) {
      continue;
    }
    const filePath = resolve(backupDirectory, fileName);
    if ((await stat(filePath)).mtimeMs < cutoff) {
      await rm(filePath, { force: true });
    }
  }
  console.log(`SQLite 백업 완료: ${destinationPath}`);
}
