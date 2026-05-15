/**
 * OpenCode Layout Extension
 *
 * Transforms pi's UI to look like OpenCode:
 * - Full-screen messages, minimal chrome
 * - Bottom-fixed input with blue left border accent
 * - Status bar embedded in editor borders (model, context, cwd, branch)
 * - Minimal working indicator (blue pulse dot)
 * - Hidden header and footer
 *
 * Commands:
 *   /opencode         - Toggle layout on/off
 *   /opencode-reset   - Restore default pi UI
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CustomEditor,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ─── OpenCode palette ───
const BLUE = "\x1b[38;2;59;130;246m"; // #3b82f6
const BLUE_MUTED = "\x1b[38;2;96;165;250m"; // #60a5fa
const SLATE = "\x1b[38;2;100;116;139m"; // #64748b
const SLATE_DIM = "\x1b[38;2;71;85;105m"; // #475569
const GREEN = "\x1b[38;2;34;197;94m"; // #22c55e

function blue(text: string) {
	return `${BLUE}${text}${RESET}`;
}
function blueMuted(text: string) {
	return `${BLUE_MUTED}${text}${RESET}`;
}
function slate(text: string) {
	return `${SLATE}${text}${RESET}`;
}
function slateDim(text: string) {
	return `${SLATE_DIM}${text}${RESET}`;
}
function green(text: string) {
	return `${GREEN}${text}${RESET}`;
}

// ─── Helpers ───
function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}

function formatTokens(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	if (!usage || usage.tokens === 0) {
		return "";
	}
	const k = usage.tokens >= 1000 ? `${(usage.tokens / 1000).toFixed(1)}k` : `${usage.tokens}`;
	const pct = usage.percent !== null ? ` (${usage.percent}%)` : "";
	return `${k}${pct}`;
}

function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2;
	const minimumGap = 3;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(0, width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText));
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

// ─── Empty footer (hides default footer) ───
class EmptyFooter {
	render(_width?: number): string[] {
		return [];
	}
	invalidate(): void {}
}

// ─── OpenCode-style Editor ───
class OpenCodeEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private pi: ExtensionAPI;
	private isWorking = false;
	private workingPhase = 0;
	private currentBranch: string | undefined;
	private activeTui: TUI | undefined;
	private refreshTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
		pi: ExtensionAPI,
	) {
		super(tui, theme, keybindings, { paddingX: 1 });
		this.ctx = ctx;
		this.pi = pi;
		this.activeTui = tui;
		this.startBranchRefresh(ctx);
	}

	/** Override border color so super.render() paints left/right borders in blue */
	borderColor(text: string): string {
		return blue(text);
	}

	setWorking(working: boolean) {
		this.isWorking = working;
	}

	setWorkingPhase(phase: number) {
		this.workingPhase = phase;
	}

	private startBranchRefresh(ctx: ExtensionContext) {
		this.refreshBranch(ctx);
		// Refresh branch every 5s in case user switches branches
		this.refreshTimer = setInterval(() => this.refreshBranch(ctx), 5000);
	}

	private async refreshBranch(ctx: ExtensionContext) {
		const result = await this.pi
			.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
			.catch(() => undefined);
		const stdout = result?.stdout?.trim();
		const newBranch = stdout && stdout.length > 0 ? stdout : undefined;
		if (newBranch !== this.currentBranch) {
			this.currentBranch = newBranch;
			this.activeTui?.requestRender();
		}
	}

	dispose() {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length < 2) return lines;

		const model = this.ctx.model;
		const modelName = model ? `${model.provider}/${model.id}` : "no model";
		const thinking = this.pi.getThinkingLevel();
		const tokens = formatTokens(this.ctx);
		const cwd = formatCwd(this.ctx.cwd);
		const branch = this.currentBranch;

		// Working dot: cycles through · • ● •
		const dotFrames = [slateDim("·"), slate("•"), blueMuted("●"), slate("•")];
		const workingDot = this.isWorking ? dotFrames[this.workingPhase % dotFrames.length] : "";

		// ─── Top border: minimal, just working dot on the left ───
		const topLeft = workingDot ? ` ${workingDot} ` : "";
		const topRight = "";
		// Use a subtle dim border for top
		const dimBorder = (text: string) => slateDim(text);
		lines[0] = fitBorder(topLeft, topRight, width, dimBorder, dimBorder);

		// ─── Bottom border: OpenCode-style status bar ───
		// Left:  Build · model · thinking
		// Right: tokens · cwd (branch)
		const buildLabel = green("Build");
		const thinkLabel = thinking === "off" ? slateDim(thinking) : blueMuted(thinking);
		const bottomLeft = ` ${buildLabel} ${slateDim("·")} ${slate(modelName)} ${slateDim("·")} ${thinkLabel} `;

		const tokenStr = tokens || slateDim("?");
		const branchStr = branch ? ` (${slateDim(branch)})` : "";
		const bottomRight = ` ${slate(tokenStr)} ${slateDim("·")} ${slate(cwd)}${branchStr} `;

		lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, dimBorder, dimBorder);

		return lines;
	}
}

// ─── Extension ───
export default function (pi: ExtensionAPI) {
	let enabled = false;
	let activeEditor: OpenCodeEditor | undefined;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let spinnerPhase = 0;

	const stopSpinner = () => {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = undefined;
		}
	};

	const startSpinner = () => {
		stopSpinner();
		spinnerTimer = setInterval(() => {
			spinnerPhase = (spinnerPhase + 1) % 4;
			if (activeEditor) {
				activeEditor.setWorkingPhase(spinnerPhase);
			}
		}, 150);
	};

	// Track agent state for working indicator
	pi.on("agent_start", () => {
		if (!enabled || !activeEditor) return;
		activeEditor.setWorking(true);
		startSpinner();
	});

	pi.on("agent_end", () => {
		if (!enabled || !activeEditor) return;
		activeEditor.setWorking(false);
		stopSpinner();
	});

	pi.on("turn_start", () => {
		if (!enabled || !activeEditor) return;
		activeEditor.setWorking(true);
		startSpinner();
	});

	pi.on("turn_end", () => {
		if (!enabled || !activeEditor) return;
		// Don't immediately stop - let agent_end handle it, or keep spinning briefly
	});

	// Apply layout on session start if enabled
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!enabled) return;
		applyLayout(ctx);
	});

	function applyLayout(ctx: ExtensionContext) {
		// Hide default header (empty component = no space taken)
		ctx.ui.setHeader(() => ({ render: () => [], invalidate: () => {} }));

		// Hide default footer (we put everything in the editor border)
		ctx.ui.setFooter(() => new EmptyFooter());

		// Hide default working indicator (we draw our own in the editor top border)
		ctx.ui.setWorkingVisible(false);

		// Set custom editor
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			activeEditor = new OpenCodeEditor(tui, theme, keybindings, ctx, pi);
			return activeEditor;
		});
	}

	function restoreDefaults(ctx: ExtensionContext) {
		// Restore header
		ctx.ui.setHeader(undefined); // pi will use default

		// Restore footer
		ctx.ui.setFooter(undefined);

		// Restore working indicator
		ctx.ui.setWorkingVisible(true);
		ctx.ui.setWorkingIndicator();

		// Restore editor
		ctx.ui.setEditorComponent(undefined);

		// Clean up
		if (activeEditor) {
			activeEditor.dispose();
			activeEditor = undefined;
		}
		stopSpinner();
	}

	// Toggle command
	pi.registerCommand("opencode", {
		description: "Toggle OpenCode layout",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				applyLayout(ctx);
				ctx.ui.notify("OpenCode layout enabled", "info");
			} else {
				restoreDefaults(ctx);
				ctx.ui.notify("OpenCode layout disabled", "info");
			}
		},
	});

	// Explicit restore command
	pi.registerCommand("opencode-reset", {
		description: "Restore default pi UI",
		handler: async (_args, ctx) => {
			enabled = false;
			restoreDefaults(ctx);
			ctx.ui.notify("Default UI restored", "info");
		},
	});
}
