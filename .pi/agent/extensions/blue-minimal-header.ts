import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ─── Gradient palette (blue-minimal) ───
const DEEP_BLUE: Rgb = [22, 83, 189];
const BLUE: Rgb = [48, 129, 247];
const SKY: Rgb = [93, 171, 255];
const ICE: Rgb = [151, 205, 255];
const PALETTE: Rgb[] = [DEEP_BLUE, BLUE, SKY, ICE, SKY, BLUE];

type Rgb = [number, number, number];

const TITLE_LINES = [
	"  ██████╗  ██╗ ",
	"  ██╔══██╗ ██║ ",
	"  ██████╔╝ ██║ ",
	"  ██╔═══╝  ██║ ",
	"  ██║      ██║ ",
	"  ╚═╝      ╚═╝ ",
];

function mix(a: number, b: number, t: number) {
	return Math.round(a + (b - a) * t);
}

function sampleGradient(position: number) {
	const wrapped = ((position % 1) + 1) % 1;
	const scaled = wrapped * PALETTE.length;
	const index = Math.floor(scaled);
	const nextIndex = (index + 1) % PALETTE.length;
	const t = scaled - index;
	const a = PALETTE[index]!;
	const b = PALETTE[nextIndex]!;
	return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)] as Rgb;
}

function fg([r, g, b]: Rgb, text: string) {
	return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function gradientText(text: string, phase: number) {
	const chars = [...text];
	const span = Math.max(chars.length - 1, 1);
	return chars
		.map((char, index) => {
			if (char === " ") return char;
			return fg(sampleGradient(index / span + phase), char);
		})
		.join("");
}

function getPiLogo(phase: number): string[] {
	return TITLE_LINES.map((line, row) => gradientText(line, phase + row * 0.045));
}

// ─── Box-drawing helpers ───
function dim(s: string, theme: any) {
	return theme.fg("dim", s);
}

function boxTop(width: number, label: string, theme: any): string {
	const labelW = visibleWidth(label);
	const maxLabelW = Math.max(0, width - 8);
	const plainLabel = labelW > maxLabelW ? truncateToWidth(label, maxLabelW, "") : label;
	const plainLabelW = visibleWidth(plainLabel);
	const dashCount = Math.max(0, width - 5 - plainLabelW);
	return dim("┌─ ", theme) + plainLabel + " " + dim("─".repeat(dashCount), theme) + dim("┐", theme);
}

function boxLine(width: number, content: string, theme: any): string {
	const inner = Math.max(0, width - 2);
	const contentW = visibleWidth(content);
	if (contentW > inner) {
		content = truncateToWidth(content, inner, "");
	}
	const pad = Math.max(0, inner - visibleWidth(content));
	return dim("│", theme) + content + " ".repeat(pad) + dim("│", theme);
}

function boxBottom(width: number, theme: any): string {
	return dim("└" + "─".repeat(Math.max(0, width - 2)) + "┘", theme);
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}

function formatNum(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

function getSessionStats(ctx: ExtensionContext) {
	let input = 0, output = 0, cost = 0;
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const m = e.message as AssistantMessage;
			input += m.usage?.input ?? 0;
			output += m.usage?.output ?? 0;
			cost += m.usage?.cost?.total ?? 0;
		}
	}
	return { input, output, total: input + output, cost };
}

function getContextStr(ctx: ExtensionContext) {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!contextWindow || !usage || usage.percent === null) {
		return "ctx ?";
	}
	return `ctx ${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`;
}

// ─── Extension ───
export default function (pi: ExtensionAPI) {
	let activeTui: any;
	let currentModel = "pi";
	let currentSession = "session";
	let currentCwd = "";
	let currentBranch: string | undefined;

	const refreshBranch = async (ctx: ExtensionContext) => {
		const result = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }).catch(() => undefined);
		currentBranch = result?.stdout?.trim();
		currentCwd = formatCwd(ctx.cwd);
	};

	const makeHeader = (_tui: any, theme: any) => {
		return {
			render(width: number): string[] {
				if (width < 40) {
					return [dim("─".repeat(width), theme)];
				}

				const logoLines = getPiLogo(0);
				const logoPad = 18;
				const infoLines = [
					theme.fg("accent", `${BOLD}Welcome back!${RESET}`),
					`${theme.fg("muted", currentCwd)}${currentBranch ? theme.fg("dim", ` (${currentBranch})`) : ""}`,
					`${theme.fg("dim", currentModel)} · ${theme.fg("dim", currentSession)}`,
				];

				const topLabel = ` pi v${VERSION} · ${currentModel} `;
				const lines: string[] = [];
				lines.push(boxTop(width, topLabel, theme));
				lines.push(boxLine(width, "", theme));

				const maxRows = Math.max(logoLines.length, infoLines.length);
				for (let i = 0; i < maxRows; i++) {
					const logoRaw = logoLines[i] ?? "";
					const logoW = visibleWidth(logoRaw);
					const logoPadded = logoRaw + " ".repeat(Math.max(0, logoPad - logoW));
					const infoRaw = infoLines[i] ?? "";
					const combined = "  " + logoPadded + "  " + infoRaw;
					const combinedW = visibleWidth(combined);
					if (combinedW > width - 2) {
						const avail = Math.max(0, width - 2 - visibleWidth("  " + logoPadded + "  "));
						lines.push(boxLine(width, "  " + logoPadded + "  " + truncateToWidth(infoRaw, avail, ""), theme));
					} else {
						lines.push(boxLine(width, combined + " ".repeat(Math.max(0, width - 2 - combinedW)), theme));
					}
				}

				lines.push(boxLine(width, "", theme));
				lines.push(boxBottom(width, theme));
				return lines;
			},
				invalidate() {},
		};
	};

	// Set custom header immediately on load (if UI is available)
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			currentModel = ctx.model
				? `${ctx.model.provider}/${ctx.model.id}`
				: "pi";
			currentSession = pi.getSessionName() || "session";
			await refreshBranch(ctx);

			ctx.ui.setHeader((tui, theme) => {
				activeTui = tui;
				return makeHeader(tui, theme);
			});

			// Footer: context + tokens + cost on the left, thinking/model on the right
			ctx.ui.setFooter((tui, theme, footerData) => {
				const unsub = footerData.onBranchChange(() => tui.requestRender());
				return {
					dispose: unsub,
					invalidate() {},
					render(width: number): string[] {
						const { input, output, total, cost } = getSessionStats(ctx);
						const level = pi.getThinkingLevel();
						const dotColor =
							level === "off"
								? "dim"
								: level === "high" || level === "xhigh"
									? "accent"
											: "muted";
						const dot = theme.fg(dotColor, "●");
						const leftRaw = `${getContextStr(ctx)} · ↑${formatNum(input)} ↓${formatNum(output)} · Σ${formatNum(total)} · $${cost.toFixed(3)}`;
						const rightRaw = `${dot} ${level} · ${currentModel}`;

						const left = theme.fg("dim", leftRaw);
						const right = theme.fg("dim", rightRaw);

						const leftW = visibleWidth(left);
						const rightW = visibleWidth(right);
						const gap = Math.max(1, width - leftW - rightW);
						return [left + " ".repeat(gap) + right];
					},
				};
			});

			// Working indicator - minimal pulse dot
			ctx.ui.setWorkingIndicator({
				frames: [
					ctx.ui.theme.fg("dim", "·"),
					ctx.ui.theme.fg("muted", "•"),
					ctx.ui.theme.fg("accent", "●"),
					ctx.ui.theme.fg("muted", "•"),
				],
				intervalMs: 120,
			});
			ctx.ui.setWorkingMessage("Composing...");
		}
	});

	pi.on("model_select", async (_event, ctx) => {
		currentModel = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "pi";
		activeTui?.requestRender();
	});

	// Command to restore built-in header
	pi.registerCommand("builtin-header", {
		description: "Restore built-in header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.setFooter(undefined);
			ctx.ui.setWorkingIndicator();
			ctx.ui.setWorkingMessage();
			ctx.ui.notify("Built-in UI restored", "info");
		},
	});

	// Command to toggle minimal header back on
	pi.registerCommand("minimal-header", {
		description: "Restore minimal PI header",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				currentModel = ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: "pi";
				currentSession = pi.getSessionName() || "session";
				await refreshBranch(ctx);

				ctx.ui.setHeader((tui, theme) => {
					activeTui = tui;
					return makeHeader(tui, theme);
				});

				ctx.ui.setFooter((tui, theme, footerData) => {
					const unsub = footerData.onBranchChange(() => tui.requestRender());
					return {
						dispose: unsub,
						invalidate() {},
						render(width: number): string[] {
							const { input, output, total, cost } = getSessionStats(ctx);
							const level = pi.getThinkingLevel();
							const dotColor =
								level === "off"
									? "dim"
									: level === "high" || level === "xhigh"
										? "accent"
											: "muted";
							const dot = theme.fg(dotColor, "●");
							const leftRaw = `${getContextStr(ctx)} · ↑${formatNum(input)} ↓${formatNum(output)} · Σ${formatNum(total)} · $${cost.toFixed(3)}`;
							const rightRaw = `${dot} ${level} · ${currentModel}`;

							const left = theme.fg("dim", leftRaw);
							const right = theme.fg("dim", rightRaw);

							const leftW = visibleWidth(left);
							const rightW = visibleWidth(right);
							const gap = Math.max(1, width - leftW - rightW);
							return [left + " ".repeat(gap) + right];
						},
					};
				});

				ctx.ui.setWorkingIndicator({
					frames: [
						ctx.ui.theme.fg("dim", "·"),
						ctx.ui.theme.fg("muted", "•"),
						ctx.ui.theme.fg("accent", "●"),
						ctx.ui.theme.fg("muted", "•"),
					],
					intervalMs: 120,
				});
				ctx.ui.setWorkingMessage("Composing...");
			}
			ctx.ui.notify("Minimal header restored", "info");
		},
	});
}
