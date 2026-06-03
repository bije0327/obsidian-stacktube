/*
 * 설정 모델 + 설정 탭 UI.
 * 비밀값(apiKey)은 data.json 에만 저장하고 로그/콘솔에 출력하지 않는다.
 */
import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type StackTubePlugin from "./main";
import { StackTubeApi, StackTubeApiError } from "./api";

export interface StackTubeSettings {
	apiKey: string;
	baseUrl: string;
	folder: string;
	syncIntervalMin: number; // 0 = 수동만
	lastSyncedAt: string; // ISO8601, 마지막으로 받은 노트의 최대 created_at
}

export const DEFAULT_SETTINGS: StackTubeSettings = {
	apiKey: "",
	baseUrl: "https://stacktube.io",
	folder: "StackTube",
	syncIntervalMin: 30,
	lastSyncedAt: "",
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
			.setDesc("StackTube 웹 설정 > Obsidian 에서 발급한 키를 붙여넣으세요.")
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
			.setDesc("StackTube 서버 주소. 보통 그대로 둡니다.")
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
			.setDesc("노트를 저장할 vault 내 폴더 경로.")
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
			.setDesc("자동 동기화 주기. 0 이면 수동 동기화만 합니다.")
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
			.setName("Test connection")
			.setDesc("키와 서버 주소가 올바른지 확인합니다.")
			.addButton((btn) =>
				btn
					.setButtonText("연결 테스트")
					.setCta()
					.onClick(async () => {
						const { apiKey, baseUrl } = this.plugin.settings;
						if (!apiKey) {
							new Notice("API 키를 먼저 입력하세요.");
							return;
						}
						btn.setDisabled(true);
						btn.setButtonText("확인 중...");
						try {
							const api = new StackTubeApi(baseUrl, apiKey);
							const res = await api.health();
							if (res.ok) {
								new Notice(`연결 성공${res.plan ? ` · 플랜: ${res.plan}` : ""}`);
							} else {
								new Notice("연결 실패: 응답이 올바르지 않습니다.");
							}
						} catch (e) {
							const msg = e instanceof StackTubeApiError ? e.message : "연결 실패";
							new Notice(msg);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("연결 테스트");
						}
					})
			);

		const last = this.plugin.settings.lastSyncedAt;
		const info = containerEl.createEl("p", { cls: "stacktube-setting-info" });
		info.setText(
			last ? `마지막 동기화: ${new Date(last).toLocaleString()}` : "아직 동기화한 적 없음"
		);
	}
}
