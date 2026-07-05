/*
 * StackTube API 클라이언트 — GET /api/v1/notes, /api/v1/health
 * Obsidian requestUrl 사용(CORS 회피, fetch 금지). 비밀값은 로그에 출력하지 않는다.
 */
import { requestUrl, RequestUrlResponse } from "obsidian";

export interface StackTubeNote {
	video_id: string;
	channel: string;
	title: string;
	video_url: string;
	published_at: string;
	frozen_at: string;
	language: string;
	markdown: string;
	tags: string[];
}

export interface NotesPage {
	notes: StackTubeNote[];
	next_cursor: string | null;
	has_more: boolean;
}

export class StackTubeApiError extends Error {
	status: number;
	constructor(message: string, status = 0) {
		super(message);
		this.name = "StackTubeApiError";
		this.status = status;
	}
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function friendlyError(status: number): string {
	if (status === 401) return "Invalid API key. Check your key in the StackTube settings.";
	if (status === 429) return "Too many requests. Try again in a moment.";
	if (status >= 500) return `Server error (${status}).`;
	if (status === 0) return "Network request failed.";
	return `Request failed (${status}).`;
}

function uploadFriendlyError(status: number, code?: string): string {
	if (status === 401) return "Invalid API key. Check your key in the StackTube settings.";
	if (status === 403 && code === "plan_required") return "Frame capture is available on Pro or higher.";
	if (status === 403) return "This action is not allowed on your plan.";
	if (status === 404) return "Sync this note first — the server doesn't have it yet.";
	if (status === 413) return "Image too large. Try again with lower quality.";
	if (status === 415) return "Unsupported image type.";
	if (status === 429 && code === "quota_exceeded") return "You've hit this note's capture limit.";
	if (status === 429) return "Too many requests. Try again in a moment.";
	if (status >= 500) return `Server error (${status}).`;
	if (status === 0) return "Network request failed.";
	return `Upload failed (${status}).`;
}

/**
 * Build a minimal multipart/form-data body containing `image` (JPEG bytes) and
 * `seconds` (string). Returns the concatenated ArrayBuffer + boundary token.
 */
function buildFramesMultipart(jpeg: ArrayBuffer, seconds: number): { boundary: string; body: ArrayBuffer } {
	const boundary = "----stacktube" + Math.random().toString(36).slice(2) + Date.now().toString(36);
	const enc = new TextEncoder();
	const CRLF = "\r\n";
	const imagePart = enc.encode(
		`--${boundary}${CRLF}` +
			`Content-Disposition: form-data; name="image"; filename="frame.jpg"${CRLF}` +
			`Content-Type: image/jpeg${CRLF}${CRLF}`
	);
	const secondsPart = enc.encode(
		`${CRLF}--${boundary}${CRLF}` +
			`Content-Disposition: form-data; name="seconds"${CRLF}${CRLF}` +
			`${seconds}${CRLF}` +
			`--${boundary}--${CRLF}`
	);
	const jpegBytes = new Uint8Array(jpeg);
	const total = imagePart.byteLength + jpegBytes.byteLength + secondsPart.byteLength;
	const buf = new Uint8Array(total);
	let off = 0;
	buf.set(imagePart, off);
	off += imagePart.byteLength;
	buf.set(jpegBytes, off);
	off += jpegBytes.byteLength;
	buf.set(secondsPart, off);
	return { boundary, body: buf.buffer };
}

export class StackTubeApi {
	private baseUrl: string;
	private apiKey: string;

	constructor(baseUrl: string, apiKey: string) {
		this.baseUrl = normalizeBaseUrl(baseUrl);
		this.apiKey = apiKey;
	}

	private async request(path: string): Promise<RequestUrlResponse> {
		let res: RequestUrlResponse;
		try {
			res = await requestUrl({
				url: `${this.baseUrl}${path}`,
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: "application/json",
				},
				throw: false,
			});
		} catch {
			// 네트워크/타임아웃 — 메시지에 키가 들어가지 않도록 status 0 으로 일반화
			throw new StackTubeApiError(friendlyError(0), 0);
		}
		if (res.status < 200 || res.status >= 300) {
			throw new StackTubeApiError(friendlyError(res.status), res.status);
		}
		return res;
	}

	/** 키 유효성 확인 — { ok, plan } */
	async health(): Promise<{ ok: boolean; plan?: string }> {
		const res = await this.request("/api/v1/health");
		return res.json as { ok: boolean; plan?: string };
	}

	/** 노트 한 페이지 조회 */
	async fetchPage(opts: { since?: string; cursor?: string; limit?: number }): Promise<NotesPage> {
		const params = new URLSearchParams();
		if (opts.since) params.set("since", opts.since);
		if (opts.cursor) params.set("cursor", opts.cursor);
		params.set("limit", String(opts.limit ?? 100));
		const res = await this.request(`/api/v1/notes?${params.toString()}`);
		const data = res.json as Partial<NotesPage>;
		return {
			notes: Array.isArray(data.notes) ? data.notes : [],
			next_cursor: data.next_cursor ?? null,
			has_more: Boolean(data.has_more),
		};
	}

	/**
	 * since 이후 모든 노트를 페이지네이션 끝까지 순회.
	 * 페이지 단위로 콜백 호출(메모리·중간 진행 표시에 유리).
	 */
	async iterateAll(
		since: string | undefined,
		onPage: (notes: StackTubeNote[]) => Promise<void>
	): Promise<void> {
		let cursor: string | undefined = undefined;
		// 무한루프 방지 가드(최대 1000 페이지)
		for (let i = 0; i < 1000; i++) {
			const page: NotesPage = await this.fetchPage({ since, cursor, limit: 100 });
			if (page.notes.length > 0) await onPage(page.notes);
			if (!page.has_more || !page.next_cursor) return;
			cursor = page.next_cursor;
		}
	}

	/**
	 * Upload a captured frame (JPEG bytes) for a video note.
	 * POST /api/v1/notes/{video_id}/frames as multipart/form-data.
	 * Returns { frame_id, url }. Throws StackTubeApiError with a friendly message.
	 */
	async uploadFrame(
		videoId: string,
		jpeg: ArrayBuffer,
		seconds: number
	): Promise<{ frame_id: string; url: string; seconds: number }> {
		if (!videoId) throw new StackTubeApiError(uploadFriendlyError(400), 400);
		const { boundary, body } = buildFramesMultipart(jpeg, seconds);
		let res: RequestUrlResponse;
		try {
			res = await requestUrl({
				url: `${this.baseUrl}/api/v1/notes/${encodeURIComponent(videoId)}/frames`,
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: "application/json",
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body,
				throw: false,
			});
		} catch {
			// Network/timeout — generalise to status 0 (never leak key material via error string).
			throw new StackTubeApiError(uploadFriendlyError(0), 0);
		}
		if (res.status === 201) {
			const j = (res.json ?? {}) as { frame_id?: string; url?: string; seconds?: number };
			if (!j.frame_id || !j.url) {
				throw new StackTubeApiError("Upload succeeded but response was malformed.", res.status);
			}
			return { frame_id: j.frame_id, url: j.url, seconds: typeof j.seconds === "number" ? j.seconds : seconds };
		}
		const errCode =
			res.json && typeof res.json === "object"
				? ((res.json as { code?: string; error?: string }).code ??
					(res.json as { code?: string; error?: string }).error)
				: undefined;
		throw new StackTubeApiError(uploadFriendlyError(res.status, errCode), res.status);
	}
}
