// Evidence images become GitHub attachments through the installed gh-attachment skill.

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { IMAGE_TYPES } from "./model.ts";
import { EnvError, run } from "./proc.ts";
import { type Repo, repoKey } from "./ref.ts";
import type { Attachment } from "./evidence/record.ts";

const UPLOADER = join(homedir(), ".claude", "skills", "gh-attachment", "bin", "gh-attachment");

export async function uploadAttachment(repo: Repo, file: string): Promise<Attachment> {
  const contentType = IMAGE_TYPES[extname(file).toLowerCase()];
  if (contentType === undefined) throw new EnvError(`${file} 不是支持的图片类型`);
  if (!(await Bun.file(UPLOADER).exists())) throw new EnvError(`缺少 gh-attachment skill（${UPLOADER}），先安装它`);
  const r = await run([UPLOADER, repoKey(repo), file]);
  if (r.code !== 0) throw new EnvError(`上传 ${file} 失败：${r.stderr.trim()}`);
  return { source: file, url: r.stdout.trim(), contentType, bytes: (await stat(file)).size };
}
