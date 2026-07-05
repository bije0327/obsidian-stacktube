/*
 * StackTube capture modal.
 *
 * User-driven capture: we do NOT try to auto-detect the ad. The user watches
 * the video in a real interactive <webview>, skips ads / seeks / pauses as they
 * would on YouTube, then clicks "Capture this frame". Ad detection here is a
 * soft label only ("Ad is playing") — never a gate on the button.
 *
 * Fixes carried over from spike v1–v3:
 *   - Sizing bug: giving <webview> only percentage sizes let its render height
 *     collapse to ~150px. The wrapper uses fixed 960×540 px + flex + min-height:0
 *     and the webview inherits with flex:1 1 auto so its real render box is 540px.
 *   - Embed URL is dead — youtube-nocookie /embed shows an error page. We load
 *     the full watch page and let the user drive.
 *
 * capturePage() returns a NativeImage in device pixels (2× on Retina). We crop
 * to #movie_player's CSS-px bounding rect scaled by the DPR factor, then JPEG.
 */
import { App, Modal, Notice } from "obsidian";

const W = 960;
const H = 540;

type WebviewEl = HTMLElement & {
	capturePage(): Promise<NativeImageLike>;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	addEventListener(type: string, listener: (ev: unknown) => void): void;
	removeEventListener(type: string, listener: (ev: unknown) => void): void;
	setAttribute(name: string, value: string): void;
	style: CSSStyleDeclaration;
};

interface NativeImageLike {
	toJPEG(quality: number): Uint8Array | { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
	crop(rect: { x: number; y: number; width: number; height: number }): NativeImageLike;
	resize(opts: { width?: number; height?: number; quality?: "good" | "better" | "best" }): NativeImageLike;
	getSize(): { width: number; height: number };
	isEmpty(): boolean;
}

export interface CaptureModalOpts {
	videoId: string;
	seconds: number;
	onCaptured: (jpeg: ArrayBuffer, seconds: number) => void | Promise<void>;
}

interface PlayerState {
	ad: boolean;
	hasPlayer: boolean;
}

const PLAYER_STATE_JS = `(function(){
  try {
    var p=document.querySelector('.html5-video-player');
    return {
      ad: !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))),
      hasPlayer: !!p
    };
  } catch (e) { return { ad:false, hasPlayer:false }; }
})()`;

// Prefer the <video> element's rect — YouTube sizes it to the actual content
// area, so it naturally excludes the grey letterbox that surrounds a
// non-16:9 video inside #movie_player. Fall back to #movie_player only if the
// <video> element isn't in the DOM yet.
const PLAYER_RECT_JS = `(function(){
  var v=document.querySelector('video');
  var el=(v && v.getBoundingClientRect().width>0) ? v : document.querySelector('#movie_player');
  if(!el) return null;
  var r=el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`;

// One-shot CSS injection that hides YouTube's transient controls/overlays so
// they don't end up in the capture. The stylesheet is idempotent (guarded by
// its id) and stays for the lifetime of the guest page — that's fine, the
// webview is thrown away when the modal closes.
const HIDE_YT_UI_JS = `(function(){
  var id='stacktube-hide-ui'; if(document.getElementById(id)) return;
  var s=document.createElement('style'); s.id=id;
  s.textContent='.ytp-chrome-bottom,.ytp-gradient-bottom,.ytp-chrome-top,.ytp-gradient-top,'+
    '.ytp-ce-element,.ytp-pause-overlay,.ytp-cards-teaser,.ytp-scrubber-container,'+
    '.iv-branding,.annotation,.ytp-watermark{opacity:0!important;visibility:hidden!important;}';
  document.documentElement.appendChild(s);
})()`;

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
	const ab = new ArrayBuffer(u8.byteLength);
	new Uint8Array(ab).set(u8);
	return ab;
}

function normaliseJpegBytes(
	raw: Uint8Array | { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }
): Uint8Array {
	if (raw instanceof Uint8Array) return raw;
	return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** Downsample a decoded image and check whether the average brightness is near zero. */
async function isMostlyBlack(jpeg: ArrayBuffer): Promise<boolean> {
	try {
		const blob = new Blob([jpeg], { type: "image/jpeg" });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		await new Promise<void>((res, rej) => {
			img.onload = () => res();
			img.onerror = () => rej(new Error("decode failed"));
			img.src = url;
		});
		const canvas = activeDocument.createElement("canvas");
		canvas.width = 32;
		canvas.height = 18;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			URL.revokeObjectURL(url);
			return false;
		}
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		URL.revokeObjectURL(url);
		let sum = 0;
		let n = 0;
		for (let i = 0; i < data.length; i += 4) {
			sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
			n++;
		}
		const avg = sum / n;
		return avg < 4; // near-black across the whole downsampled image
	} catch {
		return false;
	}
}

export class CaptureModal extends Modal {
	private opts: CaptureModalOpts;
	private wv: WebviewEl | null = null;
	private adPollHandle: number | null = null;
	private adLabel: HTMLElement | null = null;
	private captureBtn: HTMLButtonElement | null = null;
	private stageEl: HTMLElement | null = null;
	private previewObjectUrl: string | null = null;

	constructor(app: App, opts: CaptureModalOpts) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		// Sizing lives in styles.css (.stacktube-capture-modal = W + 48px).
		this.modalEl.addClass("stacktube-capture-modal");
		this.contentEl.empty();
		this.titleEl.setText("Capture frame");
		this.buildStage();
	}

	onClose(): void {
		this.stopAdPolling();
		if (this.previewObjectUrl) {
			URL.revokeObjectURL(this.previewObjectUrl);
			this.previewObjectUrl = null;
		}
		this.contentEl.empty();
	}

	private buildStage(): void {
		const stage = this.contentEl.createDiv({ cls: "stacktube-capture-stage" });
		this.stageEl = stage;

		stage.createEl("p", {
			cls: "stacktube-capture-hint",
			text:
				"Free YouTube may show an ad first. Skip the ad and pause on the frame you want, then press Capture.",
		});

		// Stage sizing (W×H) lives in styles.css (.stacktube-webview-wrap).
		const wrap = stage.createDiv({ cls: "stacktube-webview-wrap" });

		const wv = activeDocument.createElement("webview") as unknown as WebviewEl;
		wv.setAttribute("src", `https://www.youtube.com/watch?v=${this.opts.videoId}&t=${this.opts.seconds}s`);
		wv.setAttribute("allowpopups", "false");
		// Explicit fill via .stacktube-capture-webview — do NOT rely on 100% alone
		// (webview render height collapsed to ~150px in spike v1–v3 when only
		// percent sizing was used).
		wv.setAttribute("class", "stacktube-capture-webview");
		wrap.appendChild(wv);
		this.wv = wv;

		const controls = stage.createDiv({ cls: "stacktube-capture-controls" });

		const adLabel = controls.createEl("span", { cls: "stacktube-ad-label", text: "Ad is playing" });
		this.adLabel = adLabel;

		const captureBtn = controls.createEl("button", { text: "Capture this frame" });
		captureBtn.addClass("mod-cta");
		captureBtn.setAttribute("type", "button");
		captureBtn.onclick = () => void this.doCapture();
		this.captureBtn = captureBtn;

		wv.addEventListener("dom-ready", () => this.startAdPolling());
	}

	private startAdPolling(): void {
		this.stopAdPolling();
		const wv = this.wv;
		const label = this.adLabel;
		if (!wv || !label) return;
		this.adPollHandle = window.setInterval(async () => {
			try {
				const s = (await wv.executeJavaScript(PLAYER_STATE_JS, false)) as PlayerState;
				if (s && s.hasPlayer) {
					label.toggleClass("stacktube-visible", s.ad);
				}
			} catch {
				// non-fatal — label stays as-is
			}
		}, 500);
	}

	private stopAdPolling(): void {
		if (this.adPollHandle !== null) {
			window.clearInterval(this.adPollHandle);
			this.adPollHandle = null;
		}
	}

	private async doCapture(): Promise<void> {
		const wv = this.wv;
		if (!wv || !this.captureBtn) return;
		this.captureBtn.disabled = true;
		this.captureBtn.setText("Capturing…");
		try {
			// 1. Hide YouTube's controls/overlays before capture. Give the DOM a
			//    short beat to reflect the CSS. Baked-in channel watermarks are
			//    part of the video content and can't be removed here — that's
			//    expected.
			try {
				await wv.executeJavaScript(HIDE_YT_UI_JS, false);
			} catch {
				// non-fatal — worst case, some chrome appears in the capture
			}
			await new Promise((r) => window.setTimeout(r, 150));

			// 2. Read the actual content rect (prefer <video>, fall back to
			//    #movie_player). Using <video> excludes grey letterboxing.
			let rect: { x: number; y: number; w: number; h: number } | null = null;
			try {
				rect = (await wv.executeJavaScript(PLAYER_RECT_JS, false)) as {
					x: number;
					y: number;
					w: number;
					h: number;
				} | null;
			} catch {
				rect = null;
			}

			const img = await wv.capturePage();
			if (!img || img.isEmpty()) {
				new Notice("StackTube: capture came back empty. Try again once the video is playing.");
				this.resetButton();
				return;
			}
			const imgSize = img.getSize();
			const dprX = imgSize.width / W;
			const dprY = imgSize.height / H;

			let cropped: NativeImageLike = img;
			if (rect && rect.w > 0 && rect.h > 0) {
				const cropRect = {
					x: Math.max(0, Math.round(rect.x * dprX)),
					y: Math.max(0, Math.round(rect.y * dprY)),
					width: Math.min(imgSize.width, Math.round(rect.w * dprX)),
					height: Math.min(imgSize.height, Math.round(rect.h * dprY)),
				};
				try {
					cropped = img.crop(cropRect);
				} catch {
					cropped = img;
				}
			}

			// 3. Fit-to-1920×1080 (preserve aspect, never upscale). Legibility
			//    matters more than filesize for a knowledge tool; a Retina 960
			//    capture (~1920×1080 physical) stays native, only 3×-DPR or
			//    oversized captures get shrunk.
			try {
				const sz = cropped.getSize();
				const scale = Math.min(1, 1920 / sz.width, 1080 / sz.height);
				if (scale < 1) {
					cropped = cropped.resize({
						width: Math.max(1, Math.round(sz.width * scale)),
						height: Math.max(1, Math.round(sz.height * scale)),
						quality: "best",
					});
				}
			} catch {
				// non-fatal — fall through with the un-resized image
			}

			const rawJpeg = cropped.toJPEG(85);
			const bytes = normaliseJpegBytes(rawJpeg);
			const jpeg = toArrayBuffer(bytes);

			if (await isMostlyBlack(jpeg)) {
				new Notice("This video looks protected — the captured frame is blank.");
				this.resetButton();
				return;
			}

			this.showPreview(jpeg);
		} catch (e) {
			new Notice(`StackTube: capture failed — ${(e as Error).message}`);
			this.resetButton();
		}
	}

	private resetButton(): void {
		if (!this.captureBtn) return;
		this.captureBtn.disabled = false;
		this.captureBtn.setText("Capture this frame");
	}

	private showPreview(jpeg: ArrayBuffer): void {
		this.stopAdPolling();
		this.contentEl.empty();
		this.titleEl.setText("Confirm frame");
		this.stageEl = this.contentEl.createDiv();

		const blob = new Blob([jpeg], { type: "image/jpeg" });
		if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
		this.previewObjectUrl = URL.createObjectURL(blob);

		const preview = this.stageEl.createEl("img", { cls: "stacktube-capture-preview" });
		preview.src = this.previewObjectUrl;

		this.stageEl.createEl("p", { cls: "stacktube-capture-question", text: "Save this frame?" });

		const row = this.stageEl.createDiv({ cls: "stacktube-capture-row" });

		const redo = row.createEl("button", { text: "Retake" });
		redo.onclick = () => {
			this.contentEl.empty();
			this.titleEl.setText("Capture frame");
			this.buildStage();
		};

		const save = row.createEl("button", { text: "Save" });
		save.addClass("mod-cta");
		save.onclick = async () => {
			save.disabled = true;
			redo.disabled = true;
			save.setText("Saving…");
			try {
				await this.opts.onCaptured(jpeg, this.opts.seconds);
			} finally {
				this.close();
			}
		};
	}
}
