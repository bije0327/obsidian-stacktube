/* E2E 하니스 — 실제 api/writer/sync 를 목 서버 + 가짜 vault 로 검증 */
import http from "http";
import { AddressInfo } from "net";
import { TFolder } from "./obsidian-stub";
import { SyncEngine } from "../src/sync";
import { buildFrontmatter, safeFileName } from "../src/writer";
import { StackTubeApi } from "../src/api";
import type { StackTubeNote } from "../src/api";

const VALID_KEY = "st_live_testkey";

interface Row extends StackTubeNote {
	id: string;
	created_at: string;
}

// ── 목 데이터셋 (응답 스키마 + 정렬키 id/created_at)
function makeDataset(n: number): Row[] {
	const rows: Row[] = [];
	for (let i = 0; i < n; i++) {
		const created = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
		rows.push({
			id: `id-${String(i).padStart(4, "0")}`,
			created_at: created,
			video_id: `vid${i}`,
			channel: i % 2 === 0 ? "Lex Fridman" : "Ali / Abdaal: Tips?",
			title: i === 7 ? 'Why 90% fail: notes/ideas? "really"' : `Episode ${i}`,
			video_url: `https://youtube.com/watch?v=vid${i}`,
			published_at: created,
			frozen_at: created,
			language: i % 2 === 0 ? "en" : "ko",
			markdown: `# Episode ${i}\n\n## 핵심 요약\n- point a\n- point b\n`,
			tags: ["stacktube", "ai", i % 2 === 0 ? "longform" : "tips"],
		});
	}
	return rows;
}

let DATA = makeDataset(250);

// ── 목 서버 (실제 /api/v1/notes 라우트의 keyset 페이지네이션 미러)
function startServer(): Promise<{ url: string; close: () => void }> {
	const server = http.createServer((req, res) => {
		const auth = req.headers["authorization"] || "";
		const token = /^Bearer\s+(.+)$/i.exec(String(auth))?.[1];
		if (token !== VALID_KEY) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "invalid key" }));
			return;
		}
		const u = new URL(req.url || "", "http://x");
		if (u.pathname === "/api/v1/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, plan: "pro" }));
			return;
		}
		if (u.pathname === "/api/v1/notes") {
			const since = u.searchParams.get("since") || "";
			const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit")) || 50));
			const cursorRaw = u.searchParams.get("cursor") || "";
			let cursor: { c: string; i: string } | null = null;
			if (cursorRaw) {
				try {
					cursor = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8"));
				} catch {
					cursor = null;
				}
			}
			let rows = [...DATA].sort((a, b) =>
				a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)
			);
			if (since) rows = rows.filter((r) => r.created_at >= since);
			if (cursor) {
				const c = cursor;
				rows = rows.filter((r) => r.created_at > c.c || (r.created_at === c.c && r.id > c.i));
			}
			const hasMore = rows.length > limit;
			const page = rows.slice(0, limit);
			const notes = page.map((r) => ({
				video_id: r.video_id,
				channel: r.channel,
				title: r.title,
				video_url: r.video_url,
				published_at: r.published_at,
				frozen_at: r.frozen_at,
				language: r.language,
				markdown: r.markdown,
				tags: r.tags,
			}));
			let next_cursor: string | null = null;
			if (hasMore && page.length) {
				const last = page[page.length - 1];
				next_cursor = Buffer.from(JSON.stringify({ c: last.created_at, i: last.id }), "utf8").toString("base64url");
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ notes, next_cursor, has_more: hasMore }));
			return;
		}
		res.writeHead(404);
		res.end();
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
		});
	});
}

// ── 가짜 vault
class FakeVault {
	files = new Map<string, string>();
	folders = new Set<string>();
	getAbstractFileByPath(p: string): unknown {
		if (this.files.has(p)) return { path: p };
		if (this.folders.has(p)) return new TFolder(p);
		return null;
	}
	async createFolder(p: string): Promise<void> {
		this.folders.add(p);
	}
	async create(p: string, content: string): Promise<void> {
		if (this.files.has(p)) throw new Error("exists");
		this.files.set(p, content);
	}
}

function makePlugin(baseUrl: string, vault: FakeVault, initialRange: "all" | "30" | "90" = "all") {
	const settings = {
		apiKey: VALID_KEY,
		baseUrl,
		folder: "StackTube",
		syncIntervalMin: 0,
		syncOnStartup: false,
		initialRange,
		lastSyncedAt: "",
	};
	const saved: number[] = [];
	const plugin = {
		app: { vault },
		settings,
		saveSettings: async () => {
			saved.push(1);
		},
	};
	return { plugin, settings, saved };
}

// ── assert
let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, label: string) {
	if (cond) pass++;
	else fails.push(label);
}

async function main() {
	const srv = await startServer();

	// 1. health
	const api = new StackTubeApi(srv.url, VALID_KEY);
	const h = await api.health();
	ok(h.ok === true && h.plan === "pro", "health ok+plan");

	// 1b. bad key → 401 친화 메시지
	let badMsg = "";
	try {
		await new StackTubeApi(srv.url, "wrong").health();
	} catch (e) {
		badMsg = (e as Error).message;
	}
	ok(/Invalid API key/.test(badMsg), "bad key → 401 friendly");

	// 2. full sync (페이지네이션 250 = 3 pages)
	const vault = new FakeVault();
	const { plugin, settings } = makePlugin(srv.url, vault);
	const engine = new SyncEngine(plugin as never);
	await engine.sync();
	ok(vault.files.size === 250, `full sync wrote 250 (got ${vault.files.size})`);
	ok(!!settings.lastSyncedAt, "watermark advanced");
	const maxCreated = [...DATA].map((d) => d.created_at).sort().slice(-1)[0];
	ok(settings.lastSyncedAt === maxCreated, "watermark == max frozen_at");

	// 3. frontmatter 정확성 (한 파일 파싱)
	const anyContent = [...vault.files.values()][0];
	ok(/^---\n/.test(anyContent), "frontmatter starts");
	ok(/video_id: "vid/.test(anyContent), "fm video_id");
	ok(/source: stacktube/.test(anyContent), "fm source");
	ok(/tags: \[.*"stacktube".*\]/.test(anyContent), "fm tags incl stacktube");
	ok(/# Episode/.test(anyContent), "body present");

	// 3b. 파일명 안전화 (불온문자 제목 → 경로에 금지문자 없음)
	const unsafePath = [...vault.files.keys()].find((p) => p.includes("really"));
	ok(!!unsafePath, "unsafe-title file created");
	ok(!!unsafePath && !/[\\:*?"<>|]/.test(unsafePath.replace(/^[^/]*/, "")), "no forbidden chars in name");

	// 4. 재동기화 → 중복 0 (dedup)
	const before = vault.files.size;
	await engine.sync();
	ok(vault.files.size === before, "re-sync adds 0 (dedup)");

	// 5. 신규 노트 추가분만 반영
	const extra = makeDataset(252).slice(250); // vid250, vid251 (later created_at)
	DATA = DATA.concat(extra);
	await engine.sync();
	ok(vault.files.size === before + 2, `incremental adds only new 2 (got ${vault.files.size - before})`);

	// 6. 이어받기(watermark 영속) — 새 엔진이 같은 settings 로 시작하면 0 추가
	const engine2 = new SyncEngine(plugin as never);
	const sz = vault.files.size;
	await engine2.sync();
	ok(vault.files.size === sz, "resume from watermark → 0 new");

	// 7. initial sync range — 데이터(2026-01-01경)는 30일 범위 밖 → 0건
	const vault30 = new FakeVault();
	const { plugin: p30 } = makePlugin(srv.url, vault30, "30");
	await new SyncEngine(p30 as never).sync();
	ok(vault30.files.size === 0, `initialRange=30d skips old notes (got ${vault30.files.size})`);

	srv.close();

	console.log(`\n  PASS ${pass} / ${pass + fails.length}`);
	if (fails.length) {
		console.log("  FAILED:");
		fails.forEach((f) => console.log("   ✗ " + f));
		process.exit(1);
	}
	console.log("  ✅ ALL E2E SCENARIOS PASS");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
