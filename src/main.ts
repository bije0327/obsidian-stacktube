/*
 * StackTube Obsidian plugin — entry point.
 * A thin sync client that pulls server-generated analysis notes into the vault.
 */
import { MarkdownPostProcessorContext, Notice, Plugin } from "obsidian";
import { StackTubeSettings, DEFAULT_SETTINGS, StackTubeSettingTab } from "./settings";
import { SyncEngine } from "./sync";
// [Option B seam] server sync client for captured frames. Re-enable together with
// the api.uploadFrame(...) call in openCaptureFlow below.
// import { StackTubeApi, StackTubeApiError } from "./api";
import { CaptureModal } from "./capture-modal";
import { writeCapturedFrame } from "./writer";

const STARTUP_SYNC_DELAY_MS = 10_000;

export default class StackTubePlugin extends Plugin {
	settings!: StackTubeSettings;
	sync!: SyncEngine;
	private pollHandle: number | null = null;
	private statusBarEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.sync = new SyncEngine(this);

		this.addSettingTab(new StackTubeSettingTab(this.app, this));

		this.addCommand({
			id: "sync-new-notes",
			name: "Sync new notes",
			callback: () => {
				void this.sync.sync();
			},
		});

		// Reading-view enhancement — inject a "📷 Capture" button into 📷 slot callouts.
		this.registerMarkdownPostProcessor((el, ctx) => this.processCameraSlots(el, ctx));

		// Ribbon icon — one-click manual sync
		this.addRibbonIcon("refresh-cw", "StackTube: Sync new notes", () => {
			void this.sync.sync();
		});

		// Status bar — last sync time / progress
		this.statusBarEl = this.addStatusBarItem();
		const last = this.settings.lastSyncedAt;
		this.setStatus(
			last
				? `StackTube: last sync ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
				: "StackTube: never synced"
		);

		// Optional sync shortly after startup
		if (this.settings.syncOnStartup && this.settings.apiKey) {
			const t = window.setTimeout(() => {
				void this.sync.sync({ silent: true });
			}, STARTUP_SYNC_DELAY_MS);
			this.register(() => window.clearTimeout(t));
		}

		// Interval polling
		this.reschedulePolling();
	}

	onunload(): void {
		this.clearPolling();
	}

	/** Update the status bar text (no secrets ever). */
	setStatus(text: string): void {
		this.statusBarEl?.setText(text);
	}

	private clearPolling(): void {
		if (this.pollHandle !== null) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = null;
		}
	}

	/** (Re)apply the polling timer from settings. */
	reschedulePolling(): void {
		this.clearPolling();
		const min = this.settings.syncIntervalMin;
		if (min > 0) {
			const ms = min * 60 * 1000;
			this.pollHandle = window.setInterval(() => {
				void this.sync.sync({ silent: true });
			}, ms);
			// Let Obsidian clear it automatically on unload as well
			this.registerInterval(this.pollHandle);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Markdown post-processor — find 📷 slot callouts and inject a Capture button
	 * next to the deeplink. Reading view only. No slot → no button (never dead).
	 */
	private processCameraSlots(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (!this.settings.captureEnabled) return;
		const sourcePath = ctx.sourcePath;
		if (!sourcePath) return;
		const cache = this.app.metadataCache.getCache(sourcePath);
		const videoId = cache?.frontmatter?.["video_id"] as string | undefined;
		if (!videoId) return;

		const blocks = el.querySelectorAll("blockquote, .callout");
		blocks.forEach((bq) => {
			const text = bq.textContent || "";
			if (!text.includes("📷")) return;
			if (bq.querySelector(".stacktube-capture-btn")) return;
			const link = bq.querySelector<HTMLAnchorElement>("a[href*='t=']");
			if (!link) return;
			const m = /[?&]t=(\d+)s?\b/.exec(link.getAttribute("href") || "");
			if (!m) return;
			const seconds = Number(m[1]);
			const btn = document.createElement("button");
			btn.className = "stacktube-capture-btn";
			btn.setAttribute("type", "button");
			btn.textContent = "📷 Capture";
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				this.openCaptureFlow(videoId, seconds, sourcePath);
			});
			link.parentElement?.insertBefore(btn, link.nextSibling);
		});
	}

	private openCaptureFlow(videoId: string, seconds: number, notePath: string): void {
		new CaptureModal(this.app, {
			videoId,
			seconds,
			onCaptured: async (jpeg) => {
				const { folder } = this.settings;
				try {
					await writeCapturedFrame(this.app, { folder, notePath, videoId, seconds, jpeg });
				} catch (e) {
					new Notice(`StackTube: local embed failed — ${(e as Error).message}`);
					return;
				}
				// Option A (vault-only): the captured frame lives only in your vault
				// (local attachment + note embed). We never upload it. Privacy-first
				// default until Option B server sync ships.
				new Notice(
					"StackTube: saved to your vault only — we never upload it. (내 보관함에만 저장 · 업로드하지 않습니다)"
				);

				// [Option B] 서버 동기화는 CSAM/DMCA + FRAME_UPLOAD_ENABLED 준비 후 재활성 (회원 100~500명 재평가)
				// const { apiKey, baseUrl } = this.settings;
				// if (apiKey) {
				// 	try {
				// 		const api = new StackTubeApi(baseUrl, apiKey);
				// 		await api.uploadFrame(videoId, jpeg, seconds);
				// 		new Notice("StackTube: saved to this note and the web copy.");
				// 	} catch (e) {
				// 		const msg = e instanceof StackTubeApiError ? e.message : (e as Error).message;
				// 		new Notice(`StackTube: saved locally; web sync failed — ${msg}`);
				// 	}
				// }
			},
		}).open();
	}
}
