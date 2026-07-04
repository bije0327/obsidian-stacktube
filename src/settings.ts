/*
 * Settings model + settings tab UI.
 * The API key lives only in data.json and must never be logged.
 * UI strings are English-first (community directory standard); ko/ja later.
 */
import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type StackTubePlugin from "./main";
import { StackTubeApi, StackTubeApiError } from "./api";

export type InitialRange = "all" | "30" | "90";

export interface StackTubeSettings {
	apiKey: string;
	baseUrl: string;
	folder: string;
	syncIntervalMin: number; // 0 = manual only
	syncOnStartup: boolean;
	initialRange: InitialRange; // used only before the first successful sync
	lastSyncedAt: string; // ISO8601 watermark (max created_at received)
	captureEnabled: boolean; // Phase 3b — show 📷 Capture buttons in reading view
}

export const DEFAULT_SETTINGS: StackTubeSettings = {
	apiKey: "",
	baseUrl: "https://stacktube.io",
	folder: "StackTube",
	syncIntervalMin: 30,
	syncOnStartup: true,
	initialRange: "all",
	lastSyncedAt: "",
	captureEnabled: true,
};

export class StackTubeSettingTab extends PluginSettingTab {
	plugin: StackTubePlugin;

	constructor(app: App, plugin: StackTubePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Paste the key from StackTube web → Settings → Obsidian.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("st_live_...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("StackTube server address. Usually leave as is.")
			.addText((text) =>
				text
					.setPlaceholder("https://stacktube.io")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim() || DEFAULT_SETTINGS.baseUrl;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Notes folder")
			.setDesc("Vault folder where synced notes are written.")
			.addText((text) =>
				text
					.setPlaceholder("StackTube")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value.trim() || DEFAULT_SETTINGS.folder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sync interval (minutes)")
			.setDesc("Automatic sync period. Set 0 for manual sync only.")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.syncIntervalMin))
					.onChange(async (value) => {
						const n = Math.max(0, Math.floor(Number(value) || 0));
						this.plugin.settings.syncIntervalMin = n;
						await this.plugin.saveSettings();
						this.plugin.reschedulePolling();
					})
			);

		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Run a sync shortly after Obsidian starts.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Initial sync range")
			.setDesc("Used only for the very first sync, before any sync has completed.")
			.addDropdown((dd) =>
				dd
					.addOption("all", "All notes")
					.addOption("90", "Last 90 days")
					.addOption("30", "Last 30 days")
					.setValue(this.plugin.settings.initialRange)
					.onChange(async (value) => {
						this.plugin.settings.initialRange = (value as InitialRange) || "all";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Frame capture")
			.setDesc("Show a 📷 Capture button on frame slots in reading view.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.captureEnabled).onChange(async (value) => {
					this.plugin.settings.captureEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify your API key and server address.")
			.addButton((btn) =>
				btn
					.setButtonText("Test connection")
					.setCta()
					.onClick(async () => {
						const { apiKey, baseUrl } = this.plugin.settings;
						if (!apiKey) {
							new Notice("Enter your API key first.");
							return;
						}
						btn.setDisabled(true);
						btn.setButtonText("Testing...");
						try {
							const api = new StackTubeApi(baseUrl, apiKey);
							const res = await api.health();
							if (res.ok) {
								new Notice(`Connected${res.plan ? ` · plan: ${res.plan}` : ""}`);
							} else {
								new Notice("Connection failed: unexpected response.");
							}
						} catch (e) {
							const msg = e instanceof StackTubeApiError ? e.message : "Connection failed.";
							new Notice(msg);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Test connection");
						}
					})
			);

		const last = this.plugin.settings.lastSyncedAt;
		const info = containerEl.createEl("p", { cls: "stacktube-setting-info" });
		info.setText(last ? `Last sync: ${new Date(last).toLocaleString()}` : "Never synced yet.");
	}
}
