/**
 * Mode Cycle Extension
 *
 * Ctrl+Shift+M cycles through agent modes (chat, plan, build, debug).
 * Escape requires 2 presses within 500ms to abort (prevents accidental cancels).
 *
 * Commands:
 *   /mode          - Show mode selector
 *   /mode <name>   - Switch to mode directly
 *   /mode-reset    - Clear mode, restore defaults
 *
 * Keys:
 *   Ctrl+Shift+M   - cycle to next mode
 *   Escape x2      - abort (within 500ms, only when agent is working)
 *
 * Config: ~/.pi/agent/modes.json (optional, merges with defaults)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CustomEditor,
	getAgentDir,
	Key,
	matchesKey,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme } from "@earendil-works/pi-tui";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";

// ─── Mode Configuration ───

interface Mode {
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	tools?: string[];
	instructions?: string;
}

interface ModesConfig {
	[name: string]: Mode;
}

const DEFAULT_MODES: ModesConfig = {
	chat: {
		thinkingLevel: "off",
		tools: [],
		instructions:
			"You are in CHAT MODE. Be concise and conversational. Do not use tools unless explicitly asked.",
	},
	plan: {
		thinkingLevel: "high",
		tools: ["read", "grep", "find", "ls"],
		instructions:
			"You are in PLAN MODE. Your job is to deeply understand the problem and create a detailed implementation plan.\n\nRules:\n- DO NOT make any file changes. You cannot edit or write files.\n- Read files IN FULL to get complete context.\n- Explore thoroughly: grep for related code, understand architecture.\n- Ask clarifying questions if requirements are ambiguous.\n- Identify risks, edge cases, and dependencies.\n\nOutput:\n- Create a structured plan with numbered steps.\n- For each step: what to change, why, and potential risks.\n- List files that will be modified.",
	},
	build: {
		thinkingLevel: "medium",
		tools: ["read", "bash", "edit", "write", "find", "grep", "ls"],
		instructions:
			"You are in BUILD MODE. Your job is to make focused, correct changes.\n\nRules:\n- Keep scope tight. Do exactly what was asked.\n- Read files before editing to understand current state.\n- Make surgical edits. Prefer edit over write for existing files.\n- Run tests or type checks after changes if available.\n- If unexpected complexity arises, STOP and explain.",
	},
	debug: {
		thinkingLevel: "high",
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		instructions:
			"You are in DEBUG MODE. Your job is to find and fix bugs.\n\nRules:\n- Reproduce the issue first if possible.\n- Trace through code paths carefully.\n- Add logging or tests to verify your fix.\n- Explain the root cause before the fix.",
	},
};

function loadModes(cwd: string): ModesConfig {
	const globalPath = join(getAgentDir(), "modes.json");
	const projectPath = join(cwd, ".pi", "modes.json");

	let modes: ModesConfig = { ...DEFAULT_MODES };

	if (existsSync(globalPath)) {
		try {
			const content = readFileSync(globalPath, "utf-8");
			modes = { ...modes, ...JSON.parse(content) };
		} catch {}
	}
	if (existsSync(projectPath)) {
		try {
			const content = readFileSync(projectPath, "utf-8");
			modes = { ...modes, ...JSON.parse(content) };
		} catch {}
	}

	return modes;
}

interface OriginalState {
	thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>;
	tools: string[];
}

// ─── Custom Editor with double-escape abort ───

class ModeCycleEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private escapeFirstTime = 0;
	private escapeTimer?: ReturnType<typeof setTimeout>;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
	) {
		super(tui, theme, keybindings);
		this.ctx = ctx;
	}

	handleInput(data: string): void {
		// Intercept Escape for double-press abort (only when agent is working)
		if (matchesKey(data, Key.escape)) {
			if (this.ctx.isIdle()) {
				// Agent idle — pass through (preserves double-escape -> /tree, etc.)
				super.handleInput(data);
				return;
			}

			const now = Date.now();
			if (now - this.escapeFirstTime < 500) {
				// Double press within 500ms — abort
				clearTimeout(this.escapeTimer);
				this.escapeFirstTime = 0;
				this.ctx.abort();
				return;
			}

			// First press — arm the abort and show hint
			this.escapeFirstTime = now;
			this.escapeTimer = setTimeout(() => {
				this.escapeFirstTime = 0;
			}, 500);
			this.ctx.ui.notify("Press Escape again to abort", "warning");
			return;
		}

		// Any other key resets the escape timer
		if (this.escapeFirstTime > 0) {
			clearTimeout(this.escapeTimer);
			this.escapeFirstTime = 0;
		}

		super.handleInput(data);
	}

	dispose(): void {
		if (this.escapeTimer) {
			clearTimeout(this.escapeTimer);
			this.escapeTimer = undefined;
		}
	}
}

export default function modeCycleExtension(pi: ExtensionAPI) {
	let modes: ModesConfig = {};
	let activeModeName: string | undefined;
	let activeMode: Mode | undefined;
	let originalState: OriginalState | undefined;

	async function applyMode(name: string, mode: Mode, ctx: ExtensionContext): Promise<void> {
		if (activeModeName === undefined) {
			originalState = {
				thinkingLevel: pi.getThinkingLevel(),
				tools: pi.getActiveTools(),
			};
		}

		if (mode.thinkingLevel) {
			pi.setThinkingLevel(mode.thinkingLevel);
		}

		if (mode.tools) {
			const all = pi.getAllTools().map((t) => t.name);
			const valid = mode.tools.filter((t) => all.includes(t));
			const invalid = mode.tools.filter((t) => !all.includes(t));
			if (invalid.length > 0) {
				ctx.ui.notify(`Mode "${name}": unknown tools ${invalid.join(", ")}`, "warning");
			}
			if (valid.length > 0) {
				pi.setActiveTools(valid);
			}
		}

		activeModeName = name;
		activeMode = mode;
		updateStatus(ctx);
	}

	function updateStatus(ctx: ExtensionContext) {
		if (activeModeName) {
			ctx.ui.setStatus("mode", ctx.ui.theme.fg("accent", `mode:${activeModeName}`));
		} else {
			ctx.ui.setStatus("mode", undefined);
		}
	}

	function getModeOrder(): string[] {
		return Object.keys(modes).sort();
	}

	async function cycleMode(ctx: ExtensionContext): Promise<void> {
		const names = getModeOrder();
		if (names.length === 0) return;

		const cycleList = ["(none)", ...names];
		const current = activeModeName ?? "(none)";
		const idx = cycleList.indexOf(current);
		const nextIdx = idx === -1 ? 0 : (idx + 1) % cycleList.length;
		const next = cycleList[nextIdx];

		if (next === "(none)") {
			activeModeName = undefined;
			activeMode = undefined;
			if (originalState) {
				pi.setThinkingLevel(originalState.thinkingLevel);
				pi.setActiveTools(originalState.tools);
			} else {
				pi.setActiveTools(["read", "bash", "edit", "write", "grep", "find", "ls"]);
			}
			ctx.ui.notify("Mode cleared", "info");
			updateStatus(ctx);
			return;
		}

		const mode = modes[next];
		if (!mode) return;
		await applyMode(next, mode, ctx);
		ctx.ui.notify(`Mode: ${next}`, "info");
	}

	// ─── Ctrl+Shift+M cycles modes (no built-in conflict) ───
	pi.registerShortcut("ctrl+shift+m", {
		description: "Cycle agent mode",
		handler: async (ctx) => {
			await cycleMode(ctx);
		},
	});

	// ─── Commands ───
	pi.registerCommand("mode", {
		description: "Switch agent mode",
		handler: async (args, ctx) => {
			if (args?.trim()) {
				const name = args.trim();
				const mode = modes[name];
				if (!mode) {
					ctx.ui.notify(`Unknown mode "${name}". Available: ${Object.keys(modes).join(", ")}`, "error");
					return;
				}
				await applyMode(name, mode, ctx);
				ctx.ui.notify(`Mode: ${name}`, "info");
				return;
			}

			const names = Object.keys(modes);
			if (names.length === 0) {
				ctx.ui.notify("No modes defined", "warning");
				return;
			}

			const items: SelectItem[] = names.map((name) => ({
				value: name,
				label: name === activeModeName ? `${name} (active)` : name,
				description: modes[name].thinkingLevel
					? `thinking:${modes[name].thinkingLevel}`
					: undefined,
			}));
			items.push({ value: "(none)", label: "(none)", description: "Clear mode" });

			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Select Mode"))));

				const list = new SelectList(items, Math.min(items.length, 8), {
					selectedPrefix: (s: string) => theme.fg("accent", s),
					selectedText: (s: string) => theme.fg("accent", s),
					description: (s: string) => theme.fg("muted", s),
					scrollInfo: (s: string) => theme.fg("dim", s),
					noMatch: (s: string) => theme.fg("warning", s),
				});
				list.onSelect = (item) => done(item.value);
				list.onCancel = () => done(null);
				container.addChild(list);
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						list.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!result || result === "(none)") {
				activeModeName = undefined;
				activeMode = undefined;
				if (originalState) {
					pi.setThinkingLevel(originalState.thinkingLevel);
					pi.setActiveTools(originalState.tools);
				}
				ctx.ui.notify("Mode cleared", "info");
				updateStatus(ctx);
				return;
			}

			const mode = modes[result];
			if (mode) {
				await applyMode(result, mode, ctx);
				ctx.ui.notify(`Mode: ${result}`, "info");
			}
		},
	});

	pi.registerCommand("mode-reset", {
		description: "Clear active mode",
		handler: async (_args, ctx) => {
			activeModeName = undefined;
			activeMode = undefined;
			if (originalState) {
				pi.setThinkingLevel(originalState.thinkingLevel);
				pi.setActiveTools(originalState.tools);
			}
			ctx.ui.notify("Mode cleared", "info");
			updateStatus(ctx);
		},
	});

	// ─── Inject mode instructions into system prompt ───
	pi.on("before_agent_start", async (event) => {
		if (activeMode?.instructions) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${activeMode.instructions}`,
			};
		}
	});

	// ─── Initialize ───
	pi.on("session_start", async (_event, ctx) => {
		modes = loadModes(ctx.cwd);
		updateStatus(ctx);

		// Install custom editor for double-escape abort (only when editor is available)
		if (ctx.hasUI) {
			ctx.ui.setEditorComponent((tui, theme, keybindings) =>
				new ModeCycleEditor(tui, theme, keybindings, ctx)
			);
		}
	});
}
