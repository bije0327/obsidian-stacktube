/*
 * StackTube Obsidian plugin — entry point.
 * A thin sync client that pulls server-generated analysis notes into the vault.
 */
import { Plugin } from "obsidian";
import { StackTubeSettings, DEFAULT_SETTINGS, StackTubeSettingTab } from "./settings";
import { SyncEngine } from "./sync";

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
}
