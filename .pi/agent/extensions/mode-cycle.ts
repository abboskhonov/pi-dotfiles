/**
 * Mode Cycle Extension
 *
 * Shift+Tab cycles through agent modes (chat, plan, build, debug).
 * Escape requires 2 presses within 500ms to abort (prevents accidental cancels).
 *
 * Commands:
 *   /mode          - Show mode selector
 *   /mode <name>   - Switch to mode directly
 *   /mode-reset    - Clear mode, restore defaults
 *
 * Keys:
 *   Shift+Tab      - cycle to next mode
 *   Escape x2      - abort (within 500ms)
 *
 * Config: ~/.pi/agent/modes.json (optional, merges with defaults)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

// ─── Mode Configuration ───

interface Mode {
	/** Thinking level for this mode */
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	/** Tools to enable (replaces default set) */
	tools?: string[];
	/** Instructions appended to system prompt */
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

export default function modeCycleExtension(pi: ExtensionAPI) {
	let modes: ModesConfig = {};
	let activeModeName: string | undefined;
	let activeMode: Mode | undefined;
	let originalState: OriginalState | undefined;

	// ─── Double-escape tracking ───
	let lastEscapeTime = 0;
	const ESCAPE_WINDOW_MS = 500;
	let escapeHintTimer: ReturnType<typeof setTimeout> | undefined;

	function clearEscapeHint() {
		if (escapeHintTimer) {
			clearTimeout(escapeHintTimer);
			escapeHintTimer = undefined;
		}
	}

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

	// ─── Shift+Tab cycles modes ───
	pi.registerShortcut("shift+tab", {
		description: "Cycle agent mode",
		handler: async (ctx) => {
			await cycleMode(ctx);
		},
	});

	// ─── Escape requires 2 presses to abort ───
	pi.registerShortcut("escape", {
		description: "Double-escape to abort",
		handler: async (ctx) => {
			const now = Date.now();
			if (now - lastEscapeTime < ESCAPE_WINDOW_MS) {
				// Double press — abort
				lastEscapeTime = 0;
				clearEscapeHint();
				ctx.abort();
			} else {
				// First press — arm the abort and show hint
				lastEscapeTime = now;
				clearEscapeHint();
				escapeHintTimer = setTimeout(() => {
					lastEscapeTime = 0;
				}, ESCAPE_WINDOW_MS);
				// Only show hint if agent is active (something to abort)
				if (!ctx.isIdle()) {
					ctx.ui.notify("Press Escape again to abort", "warning");
				}
			}
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

			// Show selector
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
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Select Mode"))));

				const list = new SelectList(items, Math.min(items.length, 8), {
					selectedPrefix: (s) => theme.fg("accent", s),
					selectedText: (s) => theme.fg("accent", s),
					description: (s) => theme.fg("muted", s),
					scrollInfo: (s) => theme.fg("dim", s),
					noMatch: (s) => theme.fg("warning", s),
				});
				list.onSelect = (item) => done(item.value);
				list.onCancel = () => done(null);
				container.addChild(list);
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
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
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		clearEscapeHint();
	});
}
