/* 테스트용 obsidian 모듈 스텁 — 실제 플러그인 코드를 node 에서 돌리기 위함 */
import http from "http";
import https from "https";
import { URL } from "url";

export class TFolder {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}
export class TFile {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export const noticeLog: string[] = [];
export class Notice {
	constructor(msg: string) {
		noticeLog.push(msg);
	}
}

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	throw?: boolean;
}
export interface RequestUrlResponse {
	status: number;
	json: unknown;
	text: string;
}

export function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	const u = new URL(param.url);
	const lib = u.protocol === "https:" ? https : http;
	return new Promise((resolve, reject) => {
		const req = lib.request(
			u,
			{ method: param.method || "GET", headers: param.headers || {} },
			(res) => {
				let body = "";
				res.on("data", (c) => (body += c));
				res.on("end", () => {
					let json: unknown = null;
					try {
						json = JSON.parse(body);
					} catch {
						/* non-json */
					}
					resolve({ status: res.statusCode || 0, json, text: body });
				});
			}
		);
		req.on("error", (e) => reject(e));
		if (param.body !== undefined) {
			const chunk =
				typeof param.body === "string" ? Buffer.from(param.body) : Buffer.from(param.body);
			req.write(chunk);
		}
		req.end();
	});
}

// 플러그인이 타입으로만 쓰는 것들(런타임 무관) — 빈 클래스로 충분
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export type App = unknown;
