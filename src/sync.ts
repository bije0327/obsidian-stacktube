/*
 * 동기화 오케스트레이션.
 * lastSyncedAt(since)으로 새 노트만 받아 파일로 쓰고, 성공한 노트의
 * 최대 frozen_at 으로 lastSyncedAt 을 전진시킨다(부분 실패 시 되감기 방지).
 */
import { App, Notice } from "obsidian";
import type StackTubePlugin from "./main";
import { StackTubeApi, StackTubeApiError, StackTubeNote } from "./api";
import { writeNote } from "./writer";

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

	/** 수동/자동 공통 진입점. 사용자에게 Notice 로 결과를 알린다. */
	async sync(opts: { silent?: boolean } = {}): Promise<void> {
		const { silent } = opts;
		if (this.running) {
			if (!silent) new Notice("이미 동기화가 진행 중입니다.");
			return;
		}
		const { apiKey, baseUrl, folder, lastSyncedAt } = this.plugin.settings;
		if (!apiKey) {
			if (!silent) new Notice("API 키를 먼저 설정하세요.");
			return;
		}

		this.running = true;
		let added = 0;
		let skipped = 0;
		let maxFrozen = lastSyncedAt;

		try {
			const api = new StackTubeApi(baseUrl, apiKey);
			await api.iterateAll(lastSyncedAt || undefined, async (notes: StackTubeNote[]) => {
				for (const note of notes) {
					if (!note.video_id) continue;
					try {
						const res = await writeNote(this.app, folder, note);
						if (res.written) added++;
						else skipped++;
						// 처리에 성공한 노트만 워터마크 전진 대상
						if (!maxFrozen || (note.frozen_at && note.frozen_at > maxFrozen)) {
							maxFrozen = note.frozen_at;
						}
					} catch (e) {
						console.error("[StackTube] note write failed", note.video_id, (e as Error).message);
					}
				}
				// 페이지 단위로 워터마크 저장(중간 중단에도 진행 보존)
				if (maxFrozen && maxFrozen !== this.plugin.settings.lastSyncedAt) {
					this.plugin.settings.lastSyncedAt = maxFrozen;
					await this.plugin.saveSettings();
				}
			});

			if (!silent || added > 0) {
				new Notice(
					added > 0
						? `StackTube: 노트 ${added}개 추가됨${skipped ? ` (${skipped}개 건너뜀)` : ""}`
						: "StackTube: 새 노트 없음"
				);
			}
		} catch (e) {
			const msg = e instanceof StackTubeApiError ? e.message : "동기화 중 오류가 발생했습니다.";
			new Notice(`StackTube: ${msg}`);
		} finally {
			this.running = false;
		}
	}
}
