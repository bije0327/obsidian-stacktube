/*
 * StackTube Obsidian 플러그인 — 진입점.
 * 서버가 만든 분석 노트를 vault 로 당겨오는 얇은 동기화 클라이언트.
 */
import { Plugin } from "obsidian";
import { StackTubeSettings, DEFAULT_SETTINGS, StackTubeSettingTab } from "./settings";
import { SyncEngine } from "./sync";

export default class StackTubePlugin extends Plugin {
	settings!: StackTubeSettings;
	sync!: SyncEngine;
	private pollHandle: number | null = null;

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

		// 시작 직후 1회 + 주기 폴링
		this.reschedulePolling();
	}

	onunload(): void {
		this.clearPolling();
	}

	private clearPolling(): void {
		if (this.pollHandle !== null) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = null;
		}
	}

	/** 설정의 주기에 맞춰 폴링 타이머를 재설정한다. */
	reschedulePolling(): void {
		this.clearPolling();
		const min = this.settings.syncIntervalMin;
		if (min > 0) {
			const ms = min * 60 * 1000;
			this.pollHandle = window.setInterval(() => {
				void this.sync.sync({ silent: true });
			}, ms);
			// Obsidian 이 언로드 시 자동 정리하도록 등록
			this.registerInterval(this.pollHandle);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
