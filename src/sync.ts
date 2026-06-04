/*
 * Sync orchestration.
 * Fetches only new notes (since = lastSyncedAt watermark), writes them to the
 * vault, and advances the watermark to the max frozen_at received per page
 * (so an interrupted sync resumes without rewinding).
 */
import { App, Notice } from "obsidian";
import type StackTubePlugin from "./main";
import { StackTubeApi, StackTubeApiError, StackTubeNote } from "./api";
import { writeNote } from "./writer";

function initialSince(range: string): string | undefined {
	if (range === "30" || range === "90") {
		const d = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000);
		return d.toISOString();
	}
	return undefined; // "all"
}

export class SyncEngine {
	private plugin: StackTubePlugin;
	private app: App;
	private running = false;

	constructor(plugin: StackTubePlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	get isRunning(): boolean {
		return this.running;
	}

	/** Manual/automatic entry point. Reports results via Notice + status bar. */
	async sync(opts: { silent?: boolean } = {}): Promise<void> {
		const { silent } = opts;
		if (this.running) {
			if (!silent) new Notice("StackTube: sync already in progress.");
			return;
		}
		const { apiKey, baseUrl, folder, lastSyncedAt, initialRange } = this.plugin.settings;
		if (!apiKey) {
			if (!silent) new Notice("StackTube: set your API key in settings first.");
			return;
		}

		this.running = true;
		let added = 0;
		let skipped = 0;
		let maxFrozen = lastSyncedAt;
		this.plugin.setStatus?.("StackTube: syncing…");

		try {
			const api = new StackTubeApi(baseUrl, apiKey);
			// First-ever sync may be range-limited (settings: initialRange)
			const since = lastSyncedAt || initialSince(initialRange);
			await api.iterateAll(since, async (notes: StackTubeNote[]) => {
				for (const note of notes) {
					if (!note.video_id) continue;
					try {
						const res = await writeNote(this.app, folder, note);
						if (res.written) added++;
						else skipped++;
						// Only successfully processed notes advance the watermark
						if (!maxFrozen || (note.frozen_at && note.frozen_at > maxFrozen)) {
							maxFrozen = note.frozen_at;
						}
					} catch (e) {
						console.error("[StackTube] note write failed", note.video_id, (e as Error).message);
					}
				}
				// Persist watermark per page (progress survives interruption)
				if (maxFrozen && maxFrozen !== this.plugin.settings.lastSyncedAt) {
					this.plugin.settings.lastSyncedAt = maxFrozen;
					await this.plugin.saveSettings();
				}
				// Running-count progress (large first syncs)
				this.plugin.setStatus?.(`StackTube: syncing… ${added + skipped}`);
			});

			if (!silent || added > 0) {
				new Notice(
					added > 0
						? `StackTube: ${added} note${added === 1 ? "" : "s"} added${skipped ? ` (${skipped} skipped)` : ""}`
						: "StackTube: no new notes"
				);
			}
			this.plugin.setStatus?.(
				`StackTube: last sync ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
			);
		} catch (e) {
			const msg = e instanceof StackTubeApiError ? e.message : "Sync failed.";
			new Notice(`StackTube: ${msg}`);
			this.plugin.setStatus?.("StackTube: sync failed");
		} finally {
			this.running = false;
		}
	}
}
